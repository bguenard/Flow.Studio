/** Explicit business rows. No serialized registry or per-model JSON payload. */
import {normalizeRegistry} from './governance.js';
export const GOVERNANCE_TABLE_NAME='STUDIO_CORE_MODEL_RECORDS_V5';
export const GOVERNANCE_TABLE_DESCRIPTION='WOLF_STUDIO_GOVERNANCE_RECORDS_V1';
export const FIELDS=['key','RECORD_TYPE','MODEL_ID','MODEL_NAME','FLOW_ID','VERSION_LABEL','BASE_FLOW_ID','SCOPE','SCOPE_NOTE','ORIGIN','DECLARED_AT','REFERENCE_NODE_ID','LOCAL_NODE_ID','POSITION','FICTITIOUS','DIVISION_ID','DIVISION','STATUS','REVISION','ORGANIZATION_ID','UPDATED_AT','UPDATED_BY','RECORD_KEY','OPERATION_ID','BEFORE_SHA256','AFTER_SHA256','JOURNAL_REVISION','JOURNAL_UPDATED_AT','JOURNAL_UPDATED_BY','JOURNAL_STATUS'];
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const stable=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const same=(a,b)=>stable(a)===stable(b);
export const failure=(code,message,extra={})=>Object.assign(Error(message),{code,...extra});
export const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
export const blank=()=>Object.fromEntries(FIELDS.map(k=>[k,'']));
export function registryDocument(registry){
 if(!object(registry)||registry.schemaVersion!==1||!Array.isArray(registry.coreModels)||!Array.isArray(registry.declinations)||!same(normalizeRegistry(registry),registry))throw failure('INVALID_REGISTRY','Le référentiel contient des déclarations invalides ou contradictoires.');
 return structuredClone(registry);
}
export function governanceTableDefinition(divisionId){
 if(!validId(divisionId))throw failure('INVALID_DIVISION','Choisissez une division Genesys existante.');
 return {name:GOVERNANCE_TABLE_NAME,description:GOVERNANCE_TABLE_DESCRIPTION,division:{id:divisionId},schema:{$schema:'http://json-schema.org/draft-04/schema#',type:'object',additionalProperties:false,required:['key'],properties:Object.fromEntries(FIELDS.map((field,index)=>[field,{type:'string',title:field==='key'?'Clé de l’enregistrement':field,$id:'/properties/'+field,displayOrder:index,minLength:field==='key'?1:0,maxLength:field==='key'?256:4096,...(field==='key'?{}:{default:''})}]))}};
}
export function ownedTable(table){
 if(!object(table)||!validId(table.id)||table.name!==GOVERNANCE_TABLE_NAME||table.description!==GOVERNANCE_TABLE_DESCRIPTION)throw failure('TABLE_IDENTITY','La table ne correspond pas au référentiel dédié. Aucune table existante ne sera adaptée.');
 if(!same(Object.keys(table.schema?.properties||{}).sort(),[...FIELDS].sort())||FIELDS.some(k=>table.schema.properties[k]?.type!=='string')||!Array.isArray(table.schema.required)||!table.schema.required.includes('key')||table.schema.required.some(k=>!FIELDS.includes(k)))throw failure('TABLE_SCHEMA','Le schéma du référentiel est incompatible.');
 return structuredClone(table);
}
export function validateRow(table,row,organizationId){
 if(!object(row)||!same(Object.keys(row).sort(),[...FIELDS].sort())||row.ORGANIZATION_ID!==organizationId||!validId(row.REVISION)||!row.key)throw failure('INVALID_RECORD','Identité, organisation ou colonnes de ligne invalides.');
 for(const field of FIELDS){const rule=table.schema.properties[field],v=row[field];if(typeof v!=='string'||v.length<(rule.minLength||0)||v.length>Math.min(rule.maxLength??4096,field==='key'?256:4096))throw failure('INVALID_RECORD',`La valeur ${field} ne respecte pas le schéma du référentiel.`);}
}
const technical=['REVISION','ORGANIZATION_ID','UPDATED_AT','UPDATED_BY'];
export function business(row){const copy={...row};for(const k of technical)copy[k]='';return copy;}
export async function registryRows(registry,divisionFor,digest){
 registryDocument(registry);const rows=[];
 const add=async(type,identity,data,division)=>{
  if(!validId(division?.id)||!division?.name)throw failure('INVALID_DIVISION','La division de chaque parcours doit correspondre à une division Genesys accessible.');
  const readable=`${type.toLowerCase()}:${identity}`,key=readable.length<=180?readable:`${type.toLowerCase()}:${await digest(identity)}`;
  rows.push({...blank(),key,RECORD_KEY:key,RECORD_TYPE:type,STATUS:'active',DIVISION_ID:division.id,DIVISION:division.name,...data});
 };
 for(const [i,m] of registry.coreModels.entries()){
  await add('MODEL',m.id,{MODEL_ID:m.id,MODEL_NAME:m.name,POSITION:String(i),FICTITIOUS:m.fictitious?'true':''},await divisionFor(m.versions[0].flowId));
  for(const [j,v] of m.versions.entries())await add('VERSION',v.flowId,{MODEL_ID:m.id,FLOW_ID:v.flowId,VERSION_LABEL:v.label,POSITION:String(j),DECLARED_AT:v.declaredAt||''},await divisionFor(v.flowId));
 }
 for(const [i,d] of registry.declinations.entries()){
  const division=await divisionFor(d.flowId);
  await add('DECLINATION',d.flowId,{MODEL_ID:d.coreModelId,FLOW_ID:d.flowId,BASE_FLOW_ID:d.baseFlowId,SCOPE:d.scope,SCOPE_NOTE:d.scopeNote,ORIGIN:d.origin,DECLARED_AT:d.declaredAt||'',POSITION:String(i)},division);
  for(const [j,m] of (d.nodeMappings||[]).entries())await add('MAPPING',await digest(stable([d.flowId,m.referenceNodeId,m.localNodeId])),{MODEL_ID:d.coreModelId,FLOW_ID:d.flowId,REFERENCE_NODE_ID:m.referenceNodeId,LOCAL_NODE_ID:m.localNodeId,POSITION:String(j)},division);
 }
 if(new Set(rows.map(r=>r.key)).size!==rows.length)throw failure('INVALID_REGISTRY','Deux enregistrements utilisent la même clé.');
 return rows;
}
export async function rowsRegistry(rows,digest){
 const all=rows.filter(r=>r.STATUS==='active'),byType=t=>all.filter(r=>r.RECORD_TYPE===t).sort((a,b)=>Number(a.POSITION)-Number(b.POSITION));
 if(rows.some(r=>!['active','deleted'].includes(r.STATUS)||r.key!==r.RECORD_KEY||!['MODEL','VERSION','DECLINATION','MAPPING'].includes(r.RECORD_TYPE)||r.OPERATION_ID||r.BEFORE_SHA256||r.AFTER_SHA256||!validId(r.DIVISION_ID)||!r.DIVISION))throw failure('INVALID_RECORD','Une ligne métier possède une identité, un statut ou une division invalide.');
 const registry={schemaVersion:1,coreModels:byType('MODEL').map(m=>({id:m.MODEL_ID,name:m.MODEL_NAME,versions:byType('VERSION').filter(v=>v.MODEL_ID===m.MODEL_ID).map(v=>({flowId:v.FLOW_ID,label:v.VERSION_LABEL,...(v.DECLARED_AT?{declaredAt:v.DECLARED_AT}:{})})),...(m.FICTITIOUS==='true'?{fictitious:true}:{})})),declinations:byType('DECLINATION').map(d=>{
  const nodeMappings=byType('MAPPING').filter(m=>m.FLOW_ID===d.FLOW_ID).map(m=>({referenceNodeId:m.REFERENCE_NODE_ID,localNodeId:m.LOCAL_NODE_ID}));
  return {flowId:d.FLOW_ID,coreModelId:d.MODEL_ID,baseFlowId:d.BASE_FLOW_ID,scope:d.SCOPE,scopeNote:d.SCOPE_NOTE,origin:d.ORIGIN,...(d.DECLARED_AT?{declaredAt:d.DECLARED_AT}:{}),...(nodeMappings.length?{nodeMappings}:{})};
 })};
 registryDocument(registry);
 // Round-trip every column, relationship, order and key; never discard orphan rows.
 const divisions=new Map(all.filter(r=>['VERSION','DECLINATION'].includes(r.RECORD_TYPE)).map(r=>[r.FLOW_ID,{id:r.DIVISION_ID,name:r.DIVISION}]));
 const encoded=await registryRows(registry,flow=>divisions.get(flow),digest),ordered=rs=>rs.map(business).sort((a,b)=>a.key.localeCompare(b.key));
 if(!same(ordered(encoded),ordered(all)))throw failure('INVALID_REGISTRY','Le référentiel contient une relation orpheline, une division incohérente ou une colonne invalide.');
 return registry;
}
