import test from 'node:test';
import assert from 'node:assert/strict';
import {governanceTableDefinition,GOVERNANCE_TABLE_NAME} from '../src/genesys-governance.js';
import {emptyRegistry} from '../src/governance.js';
import {harness,registry} from './governance-fixture.js';

test('missing table differs from initialized empty table; reads never write',async()=>{
 const h=harness(),c=h.client();assert.equal((await c.load()).exists,false);assert.equal(h.mutations().length,0);
 const result=await c.initialize(emptyRegistry(),'g2s');assert.equal(result.exists,true);assert.deepEqual(result.registry,emptyRegistry());assert.equal(h.mutations().length,1);assert.equal(h.rows.size,0);
 assert.deepEqual((await h.client().load()).registry,emptyRegistry());
});
test('schema is explicit, includes division ID and name, and has no PAYLOAD',()=>{
 const d=governanceTableDefinition('g2s');assert.equal(d.name,GOVERNANCE_TABLE_NAME);assert.ok(d.schema.properties.DIVISION_ID);assert.ok(d.schema.properties.DIVISION);assert.ok(d.schema.properties.MODEL_ID);assert.ok(d.schema.properties.BASE_FLOW_ID);assert.equal(d.schema.properties.PAYLOAD,undefined);assert.equal(d.schema.additionalProperties,false);assert.throws(()=>governanceTableDefinition('../bad'),{code:'INVALID_DIVISION'});
});
test('round trip preserves versions, mappings, Unicode and per-journey divisions',async()=>{
 const h=harness({paginated:true}),r=registry('Modèle 😀',4);r.coreModels[0].versions.push({flowId:'inbound:v2',label:'V2',declaredAt:'2026-11-24'});await h.seed(r);
 assert.deepEqual((await h.client().load()).registry,r);assert.equal(h.rows.size,11);
 for(const row of h.rows.values())assert.equal(row.DIVISION_ID,['MODEL','VERSION'].includes(row.RECORD_TYPE)?'g2s':'gan');
 assert.ok(h.calls.every(c=>c.u.origin==='https://api.mypurecloud.ie'));assert.equal([...h.rows.values()].some(r=>r.key==='write_lock'||r.key.startsWith('journal:')),false);
});
test('rename writes only the model business row; versions and children stay byte-identical',async()=>{
 const h=harness(),c=await h.seed(),before=structuredClone(h.rows),start=h.calls.length;
 await c.save(registry('Nouveau nom'));const writes=h.calls.slice(start).filter(c=>c.method==='PUT'&&c.body?.STATUS==='active');assert.equal(writes.length,1);assert.equal(writes[0].body.RECORD_TYPE,'MODEL');
 for(const [key,row]of before)if(row.RECORD_TYPE!=='MODEL')assert.deepEqual(h.rows.get(key),row);
 assert.deepEqual((await h.client().load()).registry,registry('Nouveau nom'));
});
test('stale clients and organization mismatches cannot mutate rows',async()=>{
 const h=harness(),first=await h.seed(),second=h.client();await second.load();await first.save(registry('A'));let n=h.mutations().length;
 await assert.rejects(second.save(registry('B')),{code:'CONFLICT'});assert.equal(h.mutations().length,n);
 h.setOrganization('elsewhere');await assert.rejects(h.client().load(),{code:'ORGANIZATION_MISMATCH'});assert.equal(h.mutations().length,n);
});
test('schema drift, table identity drift and unrelated homonyms fail closed',async()=>{
 const h=harness(),c=await h.seed();h.table.schema.properties.MODEL_NAME.maxLength=200;let n=h.mutations().length;await assert.rejects(c.save(registry('A')),{code:'TABLE_CHANGED'});assert.equal(h.mutations().length,n);
 h.setHook((call,res)=>call.path==='/api/v2/flows/datatables/records'?res({...h.table,id:'wolf'}):undefined);await assert.rejects(h.client().load(),{code:'TABLE_IDENTITY'});
 h.setHook(null);h.table.description='other app';await assert.rejects(h.client().load(),{code:'TABLE_IDENTITY'});assert.equal(h.mutations().length,n);
});
test('invalid graphs and ambiguous or absent division names never write',async()=>{
 const h=harness(),c=await h.seed(),r=registry();r.declinations.push({flowId:'orphan',coreModelId:'missing'});let n=h.mutations().length;
 await assert.rejects(c.save(r),{code:'INVALID_REGISTRY'});assert.equal(h.mutations().length,n);
 h.setFlowDivisions(new Map([['inbound:group','unknown']]));await assert.rejects(c.save(registry('A')),{code:'INVALID_DIVISION'});assert.equal(h.mutations().length,n);
 h.divisions.push({id:'duplicate',name:'G2S'});h.setFlowDivisions(new Map([['inbound:group','G2S']]));await c.load();await assert.rejects(c.save(registry('B')),{code:'INVALID_DIVISION'});assert.equal(h.mutations().length,n);
});
test('catalogue division rename refreshes labels without changing IDs or child ownership',async()=>{
 const h=harness(),c=await h.seed();h.divisions[0].name='Groupe';h.setFlowDivisions(new Map([['inbound:group','g2s'],['inbound:entity-0','gan']]));await c.save(registry('Nouveau'));
 assert.equal(h.rows.get('model:group').DIVISION,'Groupe');assert.equal(h.rows.get('declination:inbound:entity-0').DIVISION_ID,'gan');
});
test('deleting metadata uses tombstones and never deletes a journey',async()=>{
 const h=harness(),c=await h.seed(),runtime=structuredClone(h.runtime);await c.save(emptyRegistry());assert.deepEqual((await h.client().load()).registry,emptyRegistry());assert.equal(h.rows.size,4);assert.ok([...h.rows.values()].every(r=>r.STATUS==='deleted'));assert.deepEqual(h.runtime,runtime);
});
test('orphan and tampered business rows are rejected rather than silently dropped',async()=>{
 const h=harness();await h.seed();h.rows.get('declination:inbound:entity-0').BASE_FLOW_ID='missing';let n=h.mutations().length;await assert.rejects(h.client().load(),{code:'INVALID_REGISTRY'});assert.equal(h.mutations().length,n);
});
test('API 403 is not treated as an empty table and token is not disclosed in 400 errors',async()=>{
 const h=harness();h.setHook((c,res)=>res({},403));await assert.rejects(h.client().load(),{status:403});assert.equal(h.mutations().length,0);
 h.setHook((c,res)=>res({message:'test-token'},400));await assert.rejects(h.client().load(),e=>!e.message.includes('test-token'));
});

test('division change updates a child and its mappings, without changing its model division',async()=>{
 const h=harness(),c=await h.seed();h.setFlowDivisions(new Map([['inbound:group','G2S'],['inbound:entity-0','Mutuaide']]));await c.save(registry());
 const rows=[...h.rows.values()];assert.ok(rows.filter(r=>['DECLINATION','MAPPING'].includes(r.RECORD_TYPE)).every(r=>r.DIVISION_ID==='mut'&&r.DIVISION==='Mutuaide'));assert.equal(h.rows.get('model:group').DIVISION_ID,'g2s');assert.deepEqual((await h.client().load()).registry,registry());
});

test('multi-page registries keep individual explicit rows without a JSON payload',async()=>{
 const h=harness(),r=registry('Grand modèle',110);for(const d of r.declinations)d.scopeNote='Contexte métier '.repeat(12);await h.seed(r);assert.deepEqual((await h.client().load()).registry,r);assert.equal(h.rows.size,222);assert.ok([...h.rows.values()].every(r=>!('PAYLOAD' in r)));
});

test('HTTP 429 on a read retries only the read, while a write is never replayed',async()=>{
 const h=harness();let limited=false;
 h.setHook((call,res)=>{if(!limited&&call.method==='GET'){limited=true;return {...res({},429),headers:{get:()=> '0'}};}});
 await h.client().load();assert.equal(h.mutations().length,0);
 h.setHook(null);const c=await h.seed(),start=h.calls.length;
 h.setHook((call,res)=>call.method==='POST'?res({},429):undefined);
 await assert.rejects(c.save(registry('Quota')),{status:429});assert.equal(h.calls.slice(start).filter(c=>c.method!=='GET').length,1);
});
