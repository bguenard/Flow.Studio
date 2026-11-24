import {GENESYS_API_ORIGIN} from './genesys-direct.js';
import {PARTICIPANT_CATALOGUE,participantCatalogueDefinition,validateParticipantCatalogueTable,validateParticipantDefinitions,validateParticipantDefinitionChange,catalogueNeedsUpgrade} from './participant-catalogue.js';
import {participantIdentity,participantAssignments} from './participant-names.js';
import {stable,validatePublicationRow} from './publication.js';
/** Writes are restricted to this owned catalogue; runtime WOLF tables are read-only here. */
export function createParticipantCatalogueClient(token,{organizationId,fetchImpl=globalThis.fetch,signal}={}){
 if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token)||!organizationId)throw Error('Une session Genesys vérifiée est nécessaire.');
 let busy=false;const plans=new WeakMap();
 async function request(path,{method='GET',body}={}){
  let response;try{response=await fetchImpl(GENESYS_API_ORIGIN+'/api/v2'+path,{method,headers:{Accept:'application/json',Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});}catch{throw Object.assign(Error(method==='GET'?'Lecture du catalogue interrompue.':'Réponse de création non reçue. Rechargez le catalogue pour vérifier le résultat.'),{uncertain:method!=='GET'});}
  if(!response.ok)throw Object.assign(Error(response.status===401?'Session Genesys expirée.':response.status===403?'Accès au catalogue refusé. Vérifiez les droits Architect Data Tables.':`Catalogue Genesys : HTTP ${response.status}.`),{status:response.status,uncertain:method!=='GET'&&response.status>=500});
  try{return await response.json();}catch{throw Object.assign(Error('Réponse du catalogue illisible. Rechargez pour vérifier.'),{uncertain:method!=='GET'});}
 }
 async function identity(){const user=await request('/users/me?expand=organization');const org=user?.organization?.id?user.organization:await request('/organizations/me');if(!user?.id||org?.id!==organizationId)throw Error('La session et l’organisation du catalogue ne correspondent pas.');}
 async function collect(path,query=''){
  const rows=[],ids=new Set();for(let page=1;page<=1000;page++){
   const data=await request(`${path}?pageSize=100&pageNumber=${page}${query}`);
   if(!Array.isArray(data.entities)||data.pageNumber!=null&&Number(data.pageNumber)!==page)throw Error('Pagination du catalogue invalide.');
   for(const row of data.entities){const id=row.id??row.key;if(typeof id!=='string'||!id||ids.has(id))throw Error('Identité du catalogue invalide ou dupliquée.');ids.add(id);rows.push(row);}
   let done;if(data.pageCount!=null){const n=Number(data.pageCount);if(!Number.isInteger(n)||n<0||n>1000)throw Error('Pagination du catalogue invalide.');done=page>=n;}
   else if(data.total!=null){if(!Number.isInteger(data.total)||data.total<0)throw Error('Total du catalogue invalide.');done=rows.length>=data.total;}
   else done=!data.nextUri&&data.entities.length<100;
   if(done)return rows;if(!data.entities.length)throw Error('Lecture du catalogue incomplète.');
  }throw Error('Limite de pagination du catalogue atteinte.');
 }
 async function find(){const tables=await collect('/flows/datatables','&sortBy=id&sortOrder=ascending');const matches=tables.filter(t=>t.name?.toUpperCase()===PARTICIPANT_CATALOGUE);if(matches.length>1)throw Error('Plusieurs tables correspondent au catalogue.');if(!matches.length)return null;const table=validateParticipantCatalogueTable(await request(`/flows/datatables/${encodeURIComponent(matches[0].id)}?expand=schema`));if(table.id!==matches[0].id)throw Error('Identité de table incohérente.');return table;}
 async function load(){await identity();const table=await find();if(!table)return {status:'missing',table:null};const rows=validateParticipantDefinitions(await collect(`/flows/datatables/${encodeURIComponent(table.id)}/rows`,'&showbrief=false'));return {status:'ready',table:{...table,rows}};}
 async function initialize(divisionId){
  if(busy)throw Error('Création du catalogue en cours.');busy=true;
  try{const definition=participantCatalogueDefinition(divisionId);await identity();if(await find())throw Error('Le catalogue existe déjà. Rechargez-le.');const division=await request('/authorization/divisions/'+encodeURIComponent(divisionId));if(division.id!==divisionId)throw Error('Division Genesys non vérifiable.');await identity();if(await find())throw Error('Le catalogue vient d’être créé. Rechargez-le.');const created=await request('/flows/datatables',{method:'POST',body:definition});if(!created.id||created.name!==PARTICIPANT_CATALOGUE)throw Object.assign(Error('Création non confirmée. Rechargez le catalogue.'),{uncertain:true});const table=validateParticipantCatalogueTable(await request(`/flows/datatables/${encodeURIComponent(created.id)}?expand=schema`));if(table.id!==created.id||table.division?.id!==divisionId)throw Object.assign(Error('Division de la table créée non confirmée.'),{uncertain:true});return {status:'ready',table:{...table,rows:[]}};}finally{busy=false;}
 }
 async function upgrade(){
  if(busy)throw Error('Une opération du catalogue est en cours.');busy=true;
  try{
   const before=await load();if(!before.table)throw Error('Créez le catalogue avant de l’activer.');
   if(!catalogueNeedsUpgrade(before.table))return before;
   const table=before.table,newField=participantCatalogueDefinition(table.division.id).schema.properties.ALLOWED_VALUES;
   const schema={...structuredClone(table.schema),properties:{...structuredClone(table.schema.properties),ALLOWED_VALUES:newField}};
   await identity();const current=await find();if(current.id!==table.id||stable(current.schema)!==stable(table.schema)||current.division?.id!==table.division?.id)throw Error('Le catalogue a changé. Rechargez-le.');
   await request(`/flows/datatables/${encodeURIComponent(table.id)}`,{method:'PUT',body:{name:table.name,description:table.description,division:{id:table.division.id},schema}});
   const result=await load();if(result.table?.id!==table.id||catalogueNeedsUpgrade(result.table)||Object.keys(table.schema.properties).some(k=>stable(result.table.schema.properties[k])!==stable(table.schema.properties[k])))throw Error('Extension du catalogue non confirmée. Rechargez avant de poursuivre.');
   for(const row of before.table.rows){const actual=result.table.rows.find(r=>r.key===row.key);if(!actual||Object.keys(row).some(k=>stable(actual[k])!==stable(row[k])))throw Error('Une donnée du catalogue a changé pendant l’activation. Rechargez-la.');}
   return result;
  }finally{busy=false;}
 }
 async function runtimeSnapshot(){
  const tables=await collect('/flows/datatables','&sortBy=id&sortOrder=ascending'),result=[];
  for(const name of ['W_PARTICIPANT_DATA_V5','W_DECISION_V5']){
   const matches=tables.filter(t=>t.name?.toUpperCase()===name);if(matches.length!==1)throw Error('La lecture complète des données et conditions V5 est nécessaire au contrôle du catalogue.');
   const table=matches[0];result.push({...table,rows:await collect(`/flows/datatables/${encodeURIComponent(table.id)}/rows`,'&showbrief=false')});
  }
  return {tables:result};
 }
 async function checkDefinition(after,expected,table){
  validatePublicationRow(after,table.schema);validateParticipantDefinitions([after]);
  const found=table.rows.find(r=>participantIdentity(r.key)===participantIdentity(after.key));
  const canonical=r=>r?{...r,ALLOWED_VALUES:r.ALLOWED_VALUES||''}:null;
  if(expected){if(!found||found.key!==expected.key||stable(canonical(found))!==stable(canonical(expected)))throw Error('Cette définition a changé dans Genesys. Rechargez-la avant de modifier.');}
  else if(found)throw Error(`Le nom « ${after.key} » existe déjà dans le catalogue.`);
  const division=await request('/authorization/divisions/'+encodeURIComponent(after.DIVISION_ID));if(division.id!==after.DIVISION_ID||division.name!==after.DIVISION)throw Error('La division de la définition a changé.');
  const snapshot=await runtimeSnapshot();
  if(!expected){
   const names=snapshot.tables.flatMap(t=>t.name.toUpperCase()==='W_DECISION_V5'?t.rows.map(r=>r.PARTICIPANT_DATA_TO_CHECK).filter(Boolean):t.rows.flatMap(r=>participantAssignments(r).map(a=>a.name)));
   if(names.some(name=>participantIdentity(name)===participantIdentity(after.key)&&name!==after.key))throw Error('Un attribut existe déjà avec une autre casse dans les configurations WOLF.');
  }
  const dynamic=validateParticipantDefinitionChange(expected,after,snapshot);
  return {snapshot,dynamic};
 }
 async function prepareDefinition(after,expected=null){
  const result=await load();if(!result.table||catalogueNeedsUpgrade(result.table))throw Error('Activez les types et les listes du catalogue avant de modifier les définitions.');
  const {dynamic}=await checkDefinition(after,expected,result.table);
  const plan={after:structuredClone(after),before:expected?structuredClone(expected):null,tableId:result.table.id,dynamic:dynamic.length,expiresAt:Date.now()+300000};
  plans.set(plan,{...structuredClone(plan),schema:stable(result.table.schema)});return plan;
 }
 async function saveDefinition(plan){
  const held=plans.get(plan);if(!held||Date.now()>held.expiresAt)throw Error('Relancez le contrôle de cette définition.');
  if(busy)throw Error('Une opération du catalogue est en cours.');busy=true;
  try{
   const state=await load();if(state.table?.id!==held.tableId||stable(state.table.schema)!==held.schema)throw Error('Le schéma du catalogue a changé. Rechargez-le.');
   await checkDefinition(held.after,held.before,state.table);await identity();plans.delete(plan);
   await request(`/flows/datatables/${encodeURIComponent(held.tableId)}/rows${held.before?'/'+encodeURIComponent(held.after.key):''}`,{method:held.before?'PUT':'POST',body:held.after});
   const observed=await request(`/flows/datatables/${encodeURIComponent(held.tableId)}/rows/${encodeURIComponent(held.after.key)}?showbrief=false`);
   if(Object.keys(held.after).some(k=>stable(observed[k])!==stable(held.after[k])))throw Object.assign(Error('La relecture ne correspond pas à la définition envoyée. Rechargez le catalogue.'),{uncertain:true});
   return await load();
  }finally{busy=false;}
 }
 return {load,initialize,upgrade,prepareDefinition,saveDefinition};
}
