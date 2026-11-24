import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicationClient} from '../src/publication.js';
import {PARTICIPANT_CATALOGUE,participantCatalogueDefinition} from '../src/participant-catalogue.js';
const def=(key,type='boolean')=>({key,LABEL:key,DIVISION:'G2S',DIVISION_ID:'g2s',VALUE_TYPE:type,DEFAULT_VALUE:'',ALLOWED_VALUES:''});
function harness(tableName,before,after,definitions){
 const fields=Object.keys(after),schema={type:'object',properties:Object.fromEntries(fields.map(key=>[key,{type:'string'}]))};
 const runtime={id:'runtime',name:tableName,schema},catalogue={id:'catalogue',...participantCatalogueDefinition('g2s')};
 const entry={id:`runtime:${before.key}`,tableId:'runtime',table:tableName,key:before.key,kind:'update',before,after,fields:fields.filter(k=>before[k]!==after[k]),catalogueValidation:true};
 const calls=[],runtimeRows=new Map([[before.key,structuredClone(before)]]);let rows=definitions;
 const fetchImpl=async(url,options)=>{
  const path=new URL(url).pathname.replace('/api/v2','');calls.push({path,method:options.method});
  const ok=data=>({ok:true,status:200,json:async()=>structuredClone(data)});
  if(path==='/users/me')return ok({id:'user',organization:{id:'org'}});
  if(path==='/flows/datatables')return ok({entities:[runtime,catalogue],pageCount:1});
  if(path==='/flows/datatables/runtime')return ok(runtime);
  if(path==='/flows/datatables/catalogue')return ok(catalogue);
  if(path==='/flows/datatables/catalogue/rows')return ok({entities:rows,pageCount:1});
  if(path==='/flows/datatables/runtime/rows'&&options.method==='POST'){const row=JSON.parse(options.body);runtimeRows.set(row.key,row);return ok(row);}
  if(path.startsWith('/flows/datatables/runtime/rows/')){const row=runtimeRows.get(decodeURIComponent(path.split('/').at(-1)));return row?ok(row):{ok:false,status:404};}
  throw Error(`Unexpected mocked request ${options.method} ${path}`);
 };
 return {entry,calls,runtimeRows,client:createPublicationClient('token',{fetchImpl}),setDefinitions:value=>rows=value};
}
test('publication revalidates changed decision against catalogue updated after review',async()=>{
 const before={key:'RULE',PARTICIPANT_DATA_TO_CHECK:'ACTIVE',DECISION_OPERATOR:'==',DECISION_VALUE:'false'},after={...before,DECISION_VALUE:'true'};
 const h=harness('W_DECISION_v5',before,after,[def('ACTIVE')]);
 const plan=await h.client.prepare([h.entry],{organizationId:'org'});
 h.setDefinitions([def('ACTIVE','integer')]);
 const result=await h.client.publish(plan,{journal:async()=>{}});
 assert.equal(result.status,'failed');assert.match(result.error,/entier/);assert.equal(h.calls.some(c=>c.method!=='GET'),false);
});
test('editing one participant preserves unrelated legacy value in the same assignment slot',async()=>{
 const before={key:'INIT',PDATA_LIST_1:'LEGACY==unchanged||ACTIVE==false'},after={...before,PDATA_LIST_1:'LEGACY==unchanged||ACTIVE==true'};
 const h=harness('W_PARTICIPANT_DATA_v5',before,after,[def('ACTIVE')]);
 const plan=await h.client.prepare([h.entry],{organizationId:'org'});
 assert.equal(plan.entries[0].after.PDATA_LIST_1,after.PDATA_LIST_1);
});
test('new dynamic assignment must still use a registered attribute',async()=>{
 const before={key:'INIT',PDATA_LIST_1:'ACTIVE==false'},after={...before,PDATA_LIST_1:'ACTIVE==false||UNKNOWN==$var:answer$'};
 const h=harness('W_PARTICIPANT_DATA_v5',before,after,[def('ACTIVE')]);
 await assert.rejects(h.client.prepare([h.entry],{organizationId:'org'}),/catalogue/);
 assert.equal(h.calls.some(c=>c.method!=='GET'),false);
});

function sharedClone(){
 const source={key:'SHARED',PDATA_LIST_1:'LEGACY==unchanged||ACTIVE==false'},after={...source,key:'CLONE',PDATA_LIST_1:'LEGACY==unchanged||ACTIVE==true'};
 const h=harness('W_PARTICIPANT_DATA_v5',source,after,[def('ACTIVE')]);
 h.entry={...h.entry,id:'runtime:CLONE',key:'CLONE',kind:'create',before:null,fields:Object.keys(after),participantSource:{tableId:'runtime',key:'SHARED',row:structuredClone(source)}};
 return h;
}
test('shared group clones retain legacy assignments only after rereading their recorded source',async()=>{
 const h=sharedClone(),plan=await h.client.prepare([h.entry],{organizationId:'org'});
 const result=await h.client.publish(plan,{journal:async()=>{}});
 assert.equal(result.status,'verified');assert.equal(h.runtimeRows.get('CLONE').PDATA_LIST_1,'LEGACY==unchanged||ACTIVE==true');
 assert.equal(h.runtimeRows.get('SHARED').PDATA_LIST_1,'LEGACY==unchanged||ACTIVE==false');
 assert.ok(h.calls.filter(c=>c.path.endsWith('/rows/SHARED')&&c.method==='GET').length>=3);
});
test('shared clone rejects changed or fabricated source before writing',async()=>{
 const h=sharedClone();h.entry.participantSource.row.PDATA_LIST_1='LEGACY==fabricated||ACTIVE==false';
 await assert.rejects(h.client.prepare([h.entry],{organizationId:'org'}),/configuration partagée/);
 const fresh=sharedClone(),plan=await fresh.client.prepare([fresh.entry],{organizationId:'org'});
 fresh.runtimeRows.get('SHARED').PDATA_LIST_1='LEGACY==concurrent||ACTIVE==false';
 const result=await fresh.client.publish(plan,{journal:async()=>{}});
 assert.equal(result.status,'failed');assert.match(result.error,/configuration partagée/);assert.equal(fresh.calls.some(c=>c.method!=='GET'),false);
});
test('clone provenance does not authorize changing a legacy attribute or using another table',async()=>{
 const h=sharedClone();h.entry.after.PDATA_LIST_1='LEGACY==changed||ACTIVE==true';
 await assert.rejects(h.client.prepare([h.entry],{organizationId:'org'}),/catalogue/);
 const invalid=sharedClone();invalid.entry.participantSource.tableId='other';
 await assert.rejects(invalid.client.prepare([invalid.entry],{organizationId:'org'}),/Origine/);
});
