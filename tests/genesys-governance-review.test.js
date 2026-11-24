import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,registry} from './governance-fixture.js';

test('interrupted journal preparation leaves business rows intact; recovery abandons preparation',async()=>{
 const h=harness(),c=await h.seed(),before=structuredClone(h.rows);let posts=0;
 h.setHook((call,res)=>call.method==='POST'&&call.body?.key.startsWith('journal:')&&++posts===2?res({},503):undefined);
 await assert.rejects(c.save(registry('A')),e=>e.uncertain);assert.equal(posts,2);
 for(const [key,row]of before)assert.deepEqual(h.rows.get(key),row);
 h.setHook(null);const other=h.client();await assert.rejects(other.load(),{code:'UPDATE_INTERRUPTED'});const op=h.rows.get('write_lock').OPERATION_ID;
 assert.deepEqual((await other.recover(op)).registry,registry());assert.equal(h.rows.size,before.size);
});
test('partial business writes are never loaded and explicit recovery completes the journal',async()=>{
 const h=harness(),c=await h.seed(),r=registry('A');r.declinations[0].scope='inactive';let writes=0;
 h.setHook((call,res)=>call.method==='PUT'&&call.body?.STATUS==='active'&&++writes===2?res({},503):undefined);
 await assert.rejects(c.save(r),e=>e.uncertain);assert.equal(writes,2);h.setHook(null);
 const other=h.client();await assert.rejects(other.load(),{code:'UPDATE_INTERRUPTED'});
 assert.deepEqual((await other.recover(h.rows.get('write_lock').OPERATION_ID)).registry,r);assert.equal(h.rows.size,4);
});
test('lost successful write response is uncertain and never blindly retried',async()=>{
 const h=harness(),c=await h.seed();let writes=0;
 h.setHook(call=>{if(call.method==='PUT'&&call.body?.STATUS==='active'){writes++;h.rows.set(call.body.key,structuredClone(call.body));throw Error('lost');}});
 await assert.rejects(c.save(registry('A')),e=>e.uncertain);assert.equal(writes,1);await assert.rejects(c.save(registry('A')),{code:'LOAD_REQUIRED'});
 h.setHook(null);const n=h.calls.length;assert.deepEqual((await c.recover(h.rows.get('write_lock').OPERATION_ID)).registry,registry('A'));assert.equal(h.calls.slice(n).filter(c=>c.method==='PUT'&&c.body?.STATUS==='active').length,0);
});
test('third-party change during an interrupted operation blocks recovery without overwriting it',async()=>{
 const h=harness(),c=await h.seed();h.setHook((call,res)=>call.method==='PUT'&&call.body?.STATUS==='active'?res({},503):undefined);await assert.rejects(c.save(registry('A')));h.setHook(null);
 h.rows.get('model:group').MODEL_NAME='External';let n=h.mutations().length;await assert.rejects(c.recover(h.rows.get('write_lock').OPERATION_ID),{code:'CONFLICT'});assert.equal(h.mutations().length,n);assert.equal(h.rows.get('model:group').MODEL_NAME,'External');
});
test('missing or corrupt journal blocks recovery and remains visible',async()=>{
 const h=harness(),c=await h.seed();h.setHook((call,res)=>call.method==='PUT'&&call.body?.STATUS==='active'?res({},503):undefined);await assert.rejects(c.save(registry('A')));h.setHook(null);
 const after=[...h.rows.values()].find(r=>r.STATUS==='after');after.MODEL_NAME='Corrupt';const n=h.mutations().length;await assert.rejects(c.recover(h.rows.get('write_lock').OPERATION_ID),{code:'CORRUPT_REGISTRY'});assert.equal(h.mutations().length,n);
});
test('cleanup interrupted after commit recovers even when some journal rows are already removed',async()=>{
 const h=harness(),c=await h.seed();let deletes=0;h.setHook((call,res)=>call.method==='DELETE'&&++deletes===2?res({},503):undefined);
 await assert.rejects(c.save(registry('A')),e=>e.uncertain);assert.equal(h.rows.get('write_lock').STATUS,'committed');h.setHook(null);
 assert.deepEqual((await c.recover(h.rows.get('write_lock').OPERATION_ID)).registry,registry('A'));assert.equal(h.rows.size,4);
});
test('atomic lock collision allows only one Studio writer to proceed',async()=>{
 const h=harness(),a=await h.seed(),b=h.client();await b.load();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let first=true;
 h.setHook(async call=>{if(first&&call.method==='POST'&&call.body?.key==='write_lock'){first=false;entered();await gate;}});
 const pending=a.save(registry('A'));await started;await b.save(registry('B'));release();await assert.rejects(pending,{code:'CONFLICT'});h.setHook(null);assert.deepEqual((await h.client().load()).registry,registry('B'));
});
test('child attachment during confirmation prevents stale model deletion',async()=>{
 const h=harness(),a=await h.seed(registry('Groupe',0)),b=h.client();await b.load();h.setFlowDivisions(new Map([['inbound:group','G2S'],['inbound:entity-0','Gan Assurances']]));await b.save(registry('Groupe',1));
 await assert.rejects(a.save({schemaVersion:1,coreModels:[],declinations:[]}),{code:'CONFLICT'});assert.equal((await h.client().load()).registry.declinations.length,1);
});

test('POST lock conflict is never converted into a PUT that could overwrite the other writer',async()=>{
 const h=harness(),c=await h.seed(),before=structuredClone(h.rows),start=h.calls.length;
 h.setHook((call,res)=>{if(call.method==='POST'&&call.body?.key==='write_lock')return res({},409);});
 await assert.rejects(c.save(registry('A')),{code:'CONFLICT'});assert.deepEqual(h.rows,before);assert.equal(h.calls.slice(start).filter(c=>c.method!=='GET').length,1);
});
