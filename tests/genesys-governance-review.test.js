import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenesysGovernanceClient} from '../src/genesys-governance.js';
import {normalizeRegistry} from '../src/governance.js';

function registry(name='Référence Groupe',count=1){
 return normalizeRegistry({schemaVersion:1,coreModels:[{id:'group',name,versions:[{flowId:'inbound:group',label:'V1'}]}],declinations:Array.from({length:count},(_,index)=>({flowId:`inbound:entity-${index}`,coreModelId:'group',baseFlowId:'inbound:group',scope:'active',scopeNote:'',origin:'created',nodeMappings:Array.from({length:count>1?30:1},(_,node)=>({referenceNodeId:`table-reference-configuration:message-and-routing-step-${node}`,localNodeId:`table-entity-configuration-${index}:message-and-routing-step-${node}`}))}))});
}
function harness(){
 const tables=[{id:'existing-wolf-table',name:'W_INBOUND_CALL_v5',description:'Existing runtime table',schema:{type:'object',properties:{key:{type:'string'}}},rows:new Map([['existing',{key:'existing',DESCRIPTION:'Do not change'}]])}],calls=[];
 let hook=null;
 const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data),text:async()=>JSON.stringify(data)});
 const fetchImpl=async(url,options={})=>{
  const path=new URL(url).pathname,method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;
  calls.push({path,method,body});
  const intercepted=await hook?.({path,method,body,tables,response});if(intercepted)return intercepted;
  if(path==='/api/v2/users/me')return response({id:'reviewer',name:'Reviewer',organization:{id:'org',name:'Org'}});
  if(path==='/api/v2/organizations/me')return response({id:'org',name:'Org'});
  if(path==='/api/v2/authorization/divisions/division')return response({id:'division',name:'France'});
  if(path==='/api/v2/authorization/divisions')return response({entities:[{id:'division',name:'France'}],pageNumber:1,pageCount:1});
  if(path==='/api/v2/flows/datatables'){
   if(method==='GET')return response({entities:tables.map(({rows,...table})=>table),pageNumber:1,pageCount:1});
   assert.equal(method,'POST');assert.equal(body.name,'STUDIO_CORE_MODELS_V5');
   const created={...structuredClone(body),id:`registry-${tables.length}`,rows:new Map()};tables.push(created);const {rows,...metadata}=created;return response(metadata,201);
  }
  const match=path.match(/^\/api\/v2\/flows\/datatables\/([^/]+)(?:\/rows(?:\/(.+))?)?$/);assert.ok(match,`Unexpected API ${method} ${path}`);
  const table=tables.find(t=>t.id===match[1]);if(!table)return response({},404);
  if(!path.includes('/rows')){assert.equal(method,'GET','Existing table schemas must never be changed');const {rows,...metadata}=table;return response(metadata);}
  const key=match[2]&&decodeURIComponent(match[2]);
  if(method==='GET'){
   assert.equal(new URL(url).searchParams.get('showbrief'),'false');
   return key?(table.rows.has(key)?response(table.rows.get(key)):response({},404)):response({entities:[...table.rows.values()],pageNumber:1,pageCount:1});
  }
  assert.equal(table.name,'STUDIO_CORE_MODELS_V5','The writer must only address the dedicated governance table');
  assert.ok(['POST','PUT'].includes(method),'Never delete rows or tables');
  if(method==='POST'&&table.rows.has(body.key))return response({},409);
  if(method==='PUT'&&!table.rows.has(key))return response({},404);
  assert.ok(!key||key===body.key);table.rows.set(body.key,structuredClone(body));return response(body,method==='POST'?201:200);
 };
 const client=()=>createGenesysGovernanceClient('test-only-token',{organizationId:'org',fetchImpl});
 return {tables,calls,client,setHook:value=>hook=value,async seed(value=registry()){const c=client();await c.load();await c.initialize(value,'division');return c;}};
}

test('dedicated registry creation and round trip never mutate pre-existing runtime tables',async()=>{
 const h=harness(),before=structuredClone(h.tables[0]);await h.seed();const loaded=await h.client().load();
 assert.equal(loaded.tableExists,true);assert.equal(loaded.exists,true);assert.deepEqual(loaded.registry,registry());assert.deepEqual(h.tables[0],before);
 assert.equal(h.calls.filter(call=>call.method==='POST'&&call.path==='/api/v2/flows/datatables').length,1);
 assert.doesNotMatch(JSON.stringify(loaded),/test-only-token/);
});

test('a stale second administrator cannot overwrite a registry saved since its last load',async()=>{
 const h=harness(),first=await h.seed(),second=h.client();await second.load();await first.save(registry('Version Groupe A'));
 const count=h.calls.filter(c=>c.method!=='GET').length;await assert.rejects(second.save(registry('Version Groupe B')),/conflit|changé|modifi|recharg/i);
 assert.equal(h.calls.filter(c=>c.method!=='GET').length,count);assert.equal((await h.client().load()).registry.coreModels[0].name,'Version Groupe A');
});

test('failed immutable chunk staging leaves the previously committed registry readable',async()=>{
 const h=harness(),client=await h.seed(),large=registry('Grand référentiel',150);assert.ok(JSON.stringify(large).length>262144);
 let chunks=0;h.setHook(({method,body,response})=>{if(method==='POST'&&String(body?.RECORD_TYPE).toLowerCase()==='chunk'&&++chunks===2)return response({},503);});
 await assert.rejects(client.save(large));assert.equal(chunks,2,'A failed POST must not be retried');
 h.setHook(null);assert.deepEqual((await h.client().load()).registry,registry());
});

test('an incomplete or tampered chunk payload fails closed rather than loading a partial registry',async()=>{
 const h=harness(),client=await h.seed();await client.save(registry('Grand référentiel',150));
 const table=h.tables.find(t=>t.name==='STUDIO_CORE_MODELS_V5'),chunk=[...table.rows.values()].find(row=>String(row.RECORD_TYPE).toLowerCase()==='chunk');assert.ok(chunk);
 chunk.PAYLOAD=chunk.PAYLOAD.slice(1);
 const count=h.calls.filter(c=>c.method!=='GET').length;await assert.rejects(h.client().load(),error=>error.code==='CORRUPT_REGISTRY');assert.equal(h.calls.filter(c=>c.method!=='GET').length,count);
});

test('access denial and a foreign homonymous table must not be interpreted as an empty registry',async()=>{
 const h=harness();h.setHook(({path,response})=>path==='/api/v2/flows/datatables'?response({},403):undefined);
 await assert.rejects(h.client().load());assert.ok(h.calls.every(c=>c.method==='GET'));
 h.setHook(null);h.tables.push({id:'unowned',name:'STUDIO_CORE_MODELS_V5',description:'Unrelated manually created table',schema:{type:'object',properties:{key:{type:'string'}}},rows:new Map()});
 await assert.rejects(h.client().load());assert.ok(h.calls.every(c=>c.method==='GET'));
});

test('a lost commit response is uncertain, never retried, and a new read recovers the committed registry',async()=>{
 const h=harness(),client=await h.seed(),updated=registry('Version enregistrée malgré la coupure');
 let writes=0;h.setHook(({method,body,tables})=>{if(method==='PUT'){writes++;tables.find(t=>t.name==='STUDIO_CORE_MODELS_V5').rows.set(body.key,structuredClone(body));throw Error('Response lost');}});
 await assert.rejects(client.save(updated),error=>error.uncertain===true);assert.equal(writes,1);
 await assert.rejects(client.save(updated),error=>error.code==='LOAD_REQUIRED');assert.equal(writes,1);
 h.setHook(null);assert.deepEqual((await client.load()).registry,updated);
});

test('Core Model wizard creation then childless deletion round trip only updates dedicated metadata',async()=>{
 const {prepareCoreModel,removeCoreModel}=await import('../src/core-model-wizard.js');
 const h=harness(),client=await h.seed(),before=structuredClone(h.tables[0]);
 const initial=(await client.load()).registry;
 const next=prepareCoreModel(initial,{name:'Accueil agences',version:'V1',flowId:'inbound:free'},[{id:'inbound:free'}]);
 await client.save(next);const remote=await h.client().load();assert.equal(remote.registry.coreModels.length,2);
 await client.load();await client.save(removeCoreModel(remote.registry,remote.registry.coreModels.find(m=>m.name==='Accueil agences').id));
 assert.deepEqual((await h.client().load()).registry,initial);assert.deepEqual(h.tables[0],before);
});

test('a child attached remotely during delete confirmation prevents stale model deletion',async()=>{
 const {declareReference,emptyRegistry,attachDeclination}=await import('../src/governance.js');
 const {removeCoreModel}=await import('../src/core-model-wizard.js');
 const h=harness(),r=declareReference(emptyRegistry(),{flowId:'ref',name:'Agences',versionLabel:'V1'}),client=await h.seed(r),other=h.client();
 await other.load();const deletion=removeCoreModel(r,r.coreModels[0].id);
 await other.save(attachDeclination(r,{flowId:'new-child',baseFlowId:'ref'}));
 await assert.rejects(client.save(deletion),/conflit|changé|modifi|recharg/i);
 const remote=await h.client().load();assert.equal(remote.registry.coreModels.length,1);assert.equal(remote.registry.declinations.length,1);
});

test('renamed Core Model is read back from Genesys with all version and child identities unchanged',async()=>{
 const {renameCoreModel}=await import('../src/core-model-actions.js');const h=harness(),client=await h.seed(),before=(await client.load()).registry;
 await client.save(renameCoreModel(before,before.coreModels[0].id,'Nouveau nom partagé'));
 const after=(await h.client().load()).registry;assert.equal(after.coreModels[0].name,'Nouveau nom partagé');assert.equal(after.coreModels[0].id,before.coreModels[0].id);assert.deepEqual(after.declinations,before.declinations);assert.deepEqual(after.coreModels[0].versions,before.coreModels[0].versions);
});
