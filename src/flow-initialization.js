/** Dedicated entry initialization. This module never edits legacy routing or runtime groups. */
import {PARTICIPANT_CATALOGUE,validateParticipantCatalogueTable,validateParticipantDefinitions,catalogueDefinition,validateParticipantValue} from './participant-catalogue.js';
import {participantAssignments,participantIdentity} from './participant-names.js';

export const FLOW_INITIALIZATION='STUDIO_PARCOURS_INIT_V5';
export const FLOW_INITIALIZATION_DESCRIPTION='FLOW_STUDIO_PARCOURS_INIT_V1 — Initialisation des parcours par numéro';
export const FLOW_INITIALIZATION_LIMIT=15;
export const FLOW_INITIALIZATION_TYPES=Object.freeze({text:'string',list:'string',integer:'int',boolean:'bool'});
const slotPrefix=slot=>'ATTRIBUTE_'+String(slot).padStart(2,'0');
export const FLOW_INITIALIZATION_FIELDS=Object.freeze(['key','DESCRIPTION','DIVISION',...Array.from({length:FLOW_INITIALIZATION_LIMIT},(_,i)=>['NAME','TYPE','VALUE'].map(part=>`${slotPrefix(i+1)}_${part}`)).flat()]);
const fields=new Set(FLOW_INITIALIZATION_FIELDS);
const numbered=key=>typeof key==='string'&&/^\+?\d+$/.test(key)&&key.length<=256;
const dynamic=value=>/\$var:|^var:|^variable$/i.test(value);
const validName=name=>typeof name==='string'&&Boolean(name.trim())&&name===name.trim()&&name.length<=256&&!/[|;=\r\n]/.test(name)&&!dynamic(name);
const textLimit=field=>field.endsWith('_VALUE')?4096:256;
const canonical=row=>Object.fromEntries(FLOW_INITIALIZATION_FIELDS.map(field=>[field,row[field]??'']));
const oneTable=(snapshot,predicate,label,required=true)=>{const tables=(snapshot?.tables||[]).filter(predicate);if(tables.length>1||required&&tables.length!==1)throw Error(`Une seule table ${label} doit être disponible.`);return tables[0]||null;};

export function flowInitializationDefinition(divisionId){
 if(typeof divisionId!=='string'||!/^[a-zA-Z0-9_-]+$/.test(divisionId))throw Error('Choisissez la division de la table d’initialisation.');
 return {name:FLOW_INITIALIZATION,description:FLOW_INITIALIZATION_DESCRIPTION,division:{id:divisionId},schema:{$schema:'http://json-schema.org/draft-04/schema#',type:'object',additionalProperties:false,required:['key'],properties:Object.fromEntries(FLOW_INITIALIZATION_FIELDS.map((field,index)=>[field,{type:'string',title:field,$id:'/properties/'+field,displayOrder:index,minLength:field==='key'?1:0,maxLength:textLimit(field),...(field==='key'?{}:{default:''})}]))}};
}
/** Only our exact 48-field schema and ownership marker may receive writes. */
export function validateFlowInitializationTable(table){
 const schema=table?.schema,properties=schema?.properties;
 if(!table?.id||table.name!==FLOW_INITIALIZATION||table.description!==FLOW_INITIALIZATION_DESCRIPTION||schema?.type!=='object'||schema.additionalProperties!==false||!Array.isArray(schema.required)||schema.required.length!==1||schema.required[0]!=='key'||!properties||Object.keys(properties).length!==FLOW_INITIALIZATION_FIELDS.length||FLOW_INITIALIZATION_FIELDS.some(field=>properties[field]?.type!=='string'||properties[field].readOnly===true)||Object.keys(properties).some(field=>!fields.has(field)))throw Error('La table d’initialisation est incompatible. Aucune table existante ne sera modifiée.');
 return table;
}
/** Empty, omitted slots are equivalent. Occupied slots retain exact values and order. */
export function initializationAttributes(row){
 return Array.from({length:FLOW_INITIALIZATION_LIMIT},(_,index)=>{const slot=index+1,prefix=slotPrefix(slot);return {slot,name:row?.[prefix+'_NAME']??'',type:row?.[prefix+'_TYPE']??'',value:row?.[prefix+'_VALUE']??''};}).filter(item=>item.name!==''||item.type!==''||item.value!=='');
}
export function validateFlowInitializationRow(row){
 if(!row||!numbered(row.key))throw Error('La clé d’initialisation doit être le numéro exact du parcours.');
 for(const [field,value] of Object.entries(row))if(!fields.has(field)||typeof value!=='string'||value.length>textLimit(field))throw Error(`Champ d’initialisation invalide : ${field}.`);
 const seen=new Set();
 for(const item of initializationAttributes(row)){
  if(!validName(item.name))throw Error(`Attribut invalide à la position ${item.slot}.`);
  const identity=participantIdentity(item.name);if(seen.has(identity))throw Error(`L’attribut « ${item.name} » est initialisé plusieurs fois.`);seen.add(identity);
  if(!['string','int','bool'].includes(item.type))throw Error(`Type d’initialisation invalide pour « ${item.name} ».`);
  if(dynamic(item.value))throw Error(`« ${item.name} » contient une valeur calculée ; elle ne peut pas être migrée comme valeur statique.`);
  const definition={key:item.name,LABEL:item.name,VALUE_TYPE:{string:'text',int:'integer',bool:'boolean'}[item.type]};
  validateParticipantValue(definition,item.value);
 }
 return row;
}
function catalogueTable(snapshot){
 const table=oneTable(snapshot,t=>t.name===PARTICIPANT_CATALOGUE,PARTICIPANT_CATALOGUE);
 validateParticipantCatalogueTable(table);validateParticipantDefinitions(table.rows||[]);return table;
}
export function validateFlowInitializationCatalogue(row,snapshot){
 validateFlowInitializationRow(row);catalogueTable(snapshot);
 for(const item of initializationAttributes(row)){
  const definition=catalogueDefinition(snapshot,item.name);
  if(!definition)throw Error(`L’attribut « ${item.name} » est absent du catalogue administrateur.`);
  if(FLOW_INITIALIZATION_TYPES[definition.VALUE_TYPE]!==item.type)throw Error(`Le type de « ${item.name} » ne correspond pas au catalogue administrateur.`);
  validateParticipantValue(definition,item.value);
 }
 return row;
}
export function createFlowInitializationRow({key,description='',division='',attributes=[]},snapshot){
 if(!Array.isArray(attributes)||attributes.length>FLOW_INITIALIZATION_LIMIT)throw Error(`Un parcours accepte au maximum ${FLOW_INITIALIZATION_LIMIT} attributs d’entrée.`);
 catalogueTable(snapshot);
 const row=Object.fromEntries(FLOW_INITIALIZATION_FIELDS.map(field=>[field,'']));Object.assign(row,{key,DESCRIPTION:description,DIVISION:division});
 const seen=new Set();
 attributes.forEach((item,index)=>{
  if(!validName(item?.name))throw Error(`Attribut invalide à la position ${index+1}.`);
  const identity=participantIdentity(item.name);if(seen.has(identity))throw Error(`L’attribut « ${item.name} » est initialisé plusieurs fois.`);seen.add(identity);
  const definition=catalogueDefinition(snapshot,item.name);
  if(!definition)throw Error(`L’attribut « ${item.name} » est absent du catalogue administrateur.`);
  const prefix=slotPrefix(index+1);row[prefix+'_NAME']=item.name;row[prefix+'_TYPE']=FLOW_INITIALIZATION_TYPES[definition.VALUE_TYPE];row[prefix+'_VALUE']=item.value;
 });
 return validateFlowInitializationCatalogue(row,snapshot);
}
function entryGroupKeys(entry){
 if(entry.NEXT_TARGET!=null&&typeof entry.NEXT_TARGET!=='string')throw Error('La première destination du parcours est invalide.');
 const result=[];
 for(const suffix of (entry.NEXT_TARGET||'').split('|').slice(1))if(/^pdata:/i.test(suffix)){
  for(const key of suffix.slice(6).split(';')){
   if(!key||key!==key.trim()||dynamic(key))throw Error('Une référence de données d’entrée est vide, ambiguë ou calculée.');
   if(result.includes(key))throw Error(`Le groupe d’entrée « ${key} » est appliqué plusieurs fois.`);result.push(key);
  }
 }
 return result;
}
/** Read-only plan: never removes NEXT_TARGET suffixes and never overwrites a dedicated row. */
export function prepareFlowInitializationMigration(snapshot){
 if(snapshot?.source?.partial)throw Error('Attendez le chargement complet avant de préparer la migration.');
 const inbound=oneTable(snapshot,t=>/^W_INBOUND_CALL_V5$/i.test(t.name),'W_INBOUND_CALL_V5');
 catalogueTable(snapshot);
 const target=oneTable(snapshot,t=>t.name===FLOW_INITIALIZATION,FLOW_INITIALIZATION,false);
 if(target)validateFlowInitializationTable(target);
 const existingRows=new Map();for(const row of target?.rows||[]){validateFlowInitializationRow(row);if(existingRows.has(row.key))throw Error(`Plusieurs lignes d’initialisation portent la clé « ${row.key} ».`);existingRows.set(row.key,row);}
 const rows=[],existing=[],errors=[],skipped=[],report=[],seen=new Set();
 for(const entry of [...(inbound.rows||[])].sort((a,b)=>String(a.key).localeCompare(String(b.key),'en'))){
  const key=entry.key;
  if(!numbered(key)){skipped.push({key,reason:'Entrée non numérotée'});continue;}
  try{
   if(seen.has(key))throw Error(`Le numéro « ${key} » est présent plusieurs fois dans les entrées.`);seen.add(key);
   const groupKeys=entryGroupKeys(entry),attributes=[];
   if(groupKeys.length){
    const source=oneTable(snapshot,t=>/^W_PARTICIPANT_DATA_V5$/i.test(t.name),'W_PARTICIPANT_DATA_V5');
    for(const groupKey of groupKeys){const matches=(source.rows||[]).filter(row=>row.key===groupKey);if(matches.length!==1)throw Error(`Le groupe d’entrée « ${groupKey} » est absent ou ambigu.`);attributes.push(...participantAssignments(matches[0]));}
   }
   const proposed=createFlowInitializationRow({key,description:entry.DESCRIPTION??'',division:entry.DIVISION??'',attributes},snapshot),current=existingRows.get(key);
   if(current){
    const before=canonical(current),differences=FLOW_INITIALIZATION_FIELDS.filter(field=>before[field]!==proposed[field]).map(field=>({field,before:before[field],after:proposed[field]}));
    const comparison={key,status:differences.length?'different':'identical',row:structuredClone(current),proposed,differences};existing.push(comparison);report.push({key,status:comparison.status,attributes:attributes.length,groups:groupKeys});
   }else{rows.push(proposed);report.push({key,status:'create',attributes:attributes.length,groups:groupKeys});}
  }catch(error){errors.push({key,message:error.message});report.push({key,status:'error',message:error.message});}
 }
 // A duplicate inbound number invalidates its earlier candidate too.
 const rejected=new Set(errors.map(error=>error.key));
 return {ok:errors.length===0&&!existing.some(item=>item.status==='different'),tableId:target?.id||null,rows:rows.filter(row=>!rejected.has(row.key)),existing,errors,skipped,report,legacyPreserved:true};
}
