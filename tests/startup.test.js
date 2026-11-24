import test from 'node:test';
import assert from 'node:assert/strict';
import { startGenesysSession } from '../src/startup.js';

test('a fresh visit redirects directly to Genesys without loading any data', async () => {
  const calls=[];
  const result=await startGenesysSession({completeLogin:async()=>{calls.push('callback');return {handled:false,authenticated:false};},beginLogin:async()=>calls.push('login'),loadSource:async()=>calls.push('load')});
  assert.equal(result,'redirecting');assert.deepEqual(calls,['callback','login']);
});
test('a successful callback loads the real source without restarting OAuth', async () => {
  const calls=[];
  const result=await startGenesysSession({completeLogin:async()=>({handled:true,authenticated:true}),beginLogin:async()=>calls.push('login'),loadSource:async()=>calls.push('load')});
  assert.equal(result,'connected');assert.deepEqual(calls,['load']);
});
test('cancelled, rejected and failed source reads surface errors without redirect loops or fallback data',async()=>{
  for(const failure of ['callback','source','handled']){
    const calls=[];
    await assert.rejects(startGenesysSession({completeLogin:async()=>{if(failure==='callback')throw Error('Connexion annulée');return {handled:true,authenticated:failure==='source'};},beginLogin:async()=>calls.push('login'),loadSource:async()=>{calls.push('load');throw Error('Accès refusé');}}));
    assert.deepEqual(calls,failure==='source'?['load']:[]);
  }
});

test('identity access failure does not discard successfully read journeys',async()=>{
 const {loadStudioSession}=await import('../src/startup.js');
 const snapshot={tables:[{id:'v5'}]};
 const result=await loadStudioSession({loadSource:async()=>snapshot,loadIdentity:async()=>{throw Object.assign(Error('Compte refusé'),{status:403});}});
 assert.equal(result.snapshot,snapshot);assert.equal(result.identity,null);assert.equal(result.identityError,'Compte refusé');
});
test('source failures and expired identities still reject the session',async()=>{
 const {loadStudioSession}=await import('../src/startup.js');let identityRead=false;
 await assert.rejects(loadStudioSession({loadSource:async()=>{throw Error('Lecture DT refusée');},loadIdentity:async()=>{identityRead=true;}}),/Lecture DT/);
 assert.equal(identityRead,false);
 await assert.rejects(loadStudioSession({loadSource:async()=>({tables:[]}),loadIdentity:async()=>{throw Object.assign(Error('Session expirée'),{status:401});}}),/expirée/);
});


test('a rejected persisted session is invalidated without an automatic redirect loop', async()=>{
 for(const status of [401,403,500]){
  const calls=[];
  await assert.rejects(startGenesysSession({completeLogin:async()=>({handled:false,authenticated:true}),beginLogin:async()=>calls.push('login'),loadSource:async()=>{throw Object.assign(Error('API refused'),{status});},invalidateSession:()=>calls.push('invalidate')}));
  assert.deepEqual(calls,status===401?['invalidate']:[]);
 }
});
