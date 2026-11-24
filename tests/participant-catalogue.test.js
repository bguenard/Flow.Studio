import test from 'node:test';
import assert from 'node:assert/strict';
import {participantCatalogueDefinition,participantDefinition,PARTICIPANT_CATALOGUE,validateParticipantDefinitions} from '../src/participant-catalogue.js';
import {createParticipantCatalogueClient} from '../src/genesys-participant-catalogue.js';
import {prepareFlowData,flowDataModel,participantOptions} from '../src/flow-data.js';
import {applyDesignerDraft} from '../src/designer-draft.js';
import {publicationRows,validatePublicationSelection,createPublicationClient} from '../src/publication.js';
import {publicationPreflight} from '../src/publication-preflight.js';
function harness(){
 const calls=[],rows=[],division={id:'division-fr',name:'France'};let table=null,org='org';
 const ok=data=>({ok:true,status:200,json:async()=>structuredClone(data)});
 const fetchImpl=async(url,options)=>{
  const u=new URL(url),path=u.pathname.replace('/api/v2','');calls.push({path,method:options.method,body:options.body});
  if(path==='/users/me')return ok({id:'u',organization:{id:org}});
  if(path==='/authorization/divisions')return ok({entities:[division],pageCount:1});
  if(path==='/authorization/divisions/division-fr')return ok(division);
  if(path==='/flows/datatables'&&options.method==='POST'){assert.equal(table,null);table={id:'catalogue',...JSON.parse(options.body)};return ok(table);}
  if(path==='/flows/datatables')return ok({entities:table?[table]:[],pageCount:1,pageNumber:1});
  if(path==='/flows/datatables/catalogue')return ok(table);
  if(path==='/flows/datatables/catalogue/rows'&&options.method==='POST'){rows.push(JSON.parse(options.body));return ok(rows.at(-1));}
  if(path==='/flows/datatables/catalogue/rows')return ok({entities:rows,pageCount:1});
  if(path.startsWith('/flows/datatables/catalogue/rows/')){const row=rows.find(r=>r.key===decodeURIComponent(path.split('/').at(-1)));return row?ok(row):{ok:false,status:404};}
  throw Error('Unexpected endpoint '+path);
 };
 return {calls,rows,division,fetchImpl,client:createParticipantCatalogueClient('token',{organizationId:'org',fetchImpl}),get table(){return table;},set table(v){table=v;},set org(v){org=v;}};
}
test('catalogue initialization creates only its dedicated table in the selected division and reads it back',async()=>{
 const h=harness();assert.equal((await h.client.load()).status,'missing');const state=await h.client.initialize(h.division.id);
 assert.equal(state.status,'ready');assert.equal(state.table.name,PARTICIPANT_CATALOGUE);assert.equal(state.table.division.id,h.division.id);
 assert.deepEqual(h.calls.filter(c=>c.method!=='GET').map(c=>[c.method,c.path]),[['POST','/flows/datatables']]);
 assert.deepEqual(Object.keys(state.table.schema.properties),['key','LABEL','DIVISION','DIVISION_ID','VALUE_TYPE','DEFAULT_VALUE','ALLOWED_VALUES']);
 h.rows.push(participantDefinition('ACTIVE','true',h.division));assert.equal((await h.client.load()).table.rows[0].key,'ACTIVE');
 await assert.rejects(h.client.initialize(h.division.id),/existe déjà/);assert.equal(h.calls.filter(c=>c.method!=='GET').length,1);
});
test('unrecognized catalogue schema and wrong organization never trigger mutations',async()=>{
 const h=harness();h.table={id:'catalogue',...participantCatalogueDefinition(h.division.id),description:'not owned'};
 await assert.rejects(h.client.load(),/incompatible/);await assert.rejects(h.client.initialize(h.division.id),/incompatible/);
 h.table=null;h.org='other';await assert.rejects(h.client.initialize(h.division.id),/organisation/);
 assert.equal(h.calls.some(c=>c.method!=='GET'),false);
});
test('duplicate definitions and missing divisions are rejected without renaming keys',()=>{
 const d={id:'d',name:'France'},a=participantDefinition('ACTIVE','true',d);assert.equal(a.key,'ACTIVE');
 assert.throws(()=>participantDefinition('ACTIVE','true',null),/division/);
 assert.throws(()=>validateParticipantDefinitions([a,{...a,key:'active'}]),/Plusieurs/);
});
function snapshot(){const str={type:'string'},schema=properties=>({type:'object',required:['key'],properties:{key:str,...properties}});return {source:{participantCatalogueRequired:true},tables:[
 {id:'in',name:'W_INBOUND_CALL_v5',schema:schema({NEXT_TARGET:str,NEXT_TARGET_TYPE:str,DIVISION:str}),rows:[{key:'100',NEXT_TARGET_TYPE:'disconnect',NEXT_TARGET:'',DIVISION:'France'}]},
 {id:'pdata',name:'W_PARTICIPANT_DATA_v5',schema:schema({PDATA_NAME:str,PDATA_LIST_1:{...str,default:''},DIVISION:str}),rows:[]},
 {id:'catalogue',...participantCatalogueDefinition('d'),rows:[]}
]};}
test('business stages runtime values from an existing admin definition with ordered dependencies',()=>{
 const s=snapshot();s.tables[2].rows.push(participantDefinition('ACTIVE','true',{id:'d',name:'France'}));
 const m=flowDataModel(s,'in:100'),p=prepareFlowData({snapshot:s,flowId:m.flowId,signature:m.signature,additions:[{name:'ACTIVE',selection:'ACTIVE',value:'true'}]});
 assert.equal(p.createdRows.length,1);assert.equal(p.createdRows[0].row.PDATA_LIST_1,'ACTIVE==true');
 const applied=applyDesignerDraft({snapshot:s,plan:p});const rows=publicationRows(applied.snapshot,applied.drafts,new Map(),new Map([['added',p.summary]]));
 assert.deepEqual(rows.map(r=>r.id),['pdata:ACTIVE','in:100']);assert.throws(()=>validatePublicationSelection(rows.slice(1)),/non sélectionnée/);
 const report=publicationPreflight({snapshot:applied.snapshot,rows});assert.equal(report.errors,0,JSON.stringify(report.findings));
 const option=participantOptions(applied.snapshot).find(o=>o.name==='ACTIVE');assert.equal(option.catalogued,true);assert.equal(option.division,'France');
 assert.deepEqual(applied.snapshot.tables.find(t=>t.id==='catalogue').rows,s.tables[2].rows);
});
test('catalogue unavailable or undeclared attribute prevents business staging',()=>{
 const s=snapshot(),m=flowDataModel(s,'in:100');
 assert.throws(()=>prepareFlowData({snapshot:s,flowId:m.flowId,signature:m.signature,additions:[{name:'ACTIVE',value:'true'}]}),/catalogue administrateur/);
 s.tables.pop();const missing=flowDataModel(s,'in:100');assert.throws(()=>prepareFlowData({snapshot:s,flowId:missing.flowId,signature:missing.signature,additions:[{name:'ACTIVE',value:'true'}]}),/catalogue/);
});
test('catalogue publication is create-only, checks division identity and catches remote duplicates',async()=>{
 const h=harness();await h.client.initialize(h.division.id);
 const row=participantDefinition('ACTIVE','true',h.division),entry={id:'catalogue:ACTIVE',tableId:'catalogue',table:PARTICIPANT_CATALOGUE,key:'ACTIVE',kind:'create',before:null,after:row,fields:Object.keys(row)};
 const client=createPublicationClient('token',{fetchImpl:h.fetchImpl});
 await assert.rejects(client.prepare([{...entry,after:{...row,DIVISION_ID:'wrong'}}],{organizationId:'org'}),/division/);
 const plan=await client.prepare([entry],{organizationId:'org'});const run=await client.publish(plan,{journal:async()=>{}});assert.equal(run.status,'verified',run.error);assert.deepEqual(h.rows[0],row);
 await assert.rejects(client.prepare([{...entry,key:'active',id:'catalogue:active',after:{...row,key:'active'}}],{organizationId:'org'}),/existe déjà/);
 await assert.rejects(client.prepare([{...entry,kind:'update',before:row}],{organizationId:'org'}),/création/);
 assert.deepEqual(h.calls.filter(c=>c.method!=='GET').map(c=>[c.method,c.path]),[['POST','/flows/datatables'],['POST','/flows/datatables/catalogue/rows']]);
});
