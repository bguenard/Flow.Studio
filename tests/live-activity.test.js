import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveActivityController,queueForActivityNode} from '../src/live-activity.js';
import {liveActivityView,liveActivityToggle} from '../src/live-activity-view.js';
const flow={id:'entry',name:'Parcours <client>',dnis:'+33100000000',nodes:[{id:'entry',key:'+33100000000',type:'inboundcall',row:{DESCRIPTION:'Accueil'}},{id:'team',key:'team',type:'service',row:{DESCRIPTION:'Équipe',QUEUE:'Q Clients'}},{id:'decision',key:'decision',type:'decision',row:{DESCRIPTION:'Condition'}}],edges:[{from:'entry',to:'team',branch:'NEXT',field:'NEXT_TARGET_TYPE',type:'service',resolved:true},{from:'team',type:'queue',target:'Q Clients',terminal:true,resolved:true,derivedFrom:'QUEUE'},{from:'team',to:'decision',branch:'INQUEUE',type:'decision',resolved:true}]};
const data=()=>({updatedAt:'2026-11-23T14:00:00.000Z',history:{status:'ready',metrics:{connected:24,averageWaitMs:12000}},live:{status:'ready',queues:[{id:'q1',name:'Q Clients',waiting:3,interacting:4,onQueue:6,available:0}]},scopeWarnings:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(load){const timers=new Map(),events=[];let serial=0;return {timers,events,controller:createLiveActivityController({getToken:()=> 'token',load,onChange:s=>events.push(s),now:()=>1000,schedule:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},unschedule:id=>timers.delete(id)})};}
test('activity makes no request until enabled, copies baseline and schedules demand-only refresh',async()=>{
 let calls=0,received;const f=fixture(async(token,input,options)=>{calls++;received={token,input,options};return data();});
 assert.equal(calls,0);await f.controller.start(flow);assert.equal(calls,1);assert.equal(received.options.period,'today');assert.equal(received.token,'token');assert.notEqual(received.input,flow);assert.equal(f.controller.getState().data.history.metrics.connected,24);
 assert.equal([...f.timers.values()][0].ms,30000);f.controller.stop();assert.equal(f.timers.size,0);assert.equal(f.controller.getState().enabled,false);await f.controller.refresh();assert.equal(calls,1);
});
test('turning the map off aborts requests and discards late responses',async()=>{
 const pending=deferred();let signal;const f=fixture(async(_,__,options)=>{signal=options.signal;return pending.promise;});
 const run=f.controller.start(flow);f.controller.stop();assert.equal(signal.aborted,true);pending.resolve(data());await run;assert.equal(f.controller.getState().data,null);assert.equal(f.timers.size,0);
});
test('changing flows cannot attach a previous flow response to the new map',async()=>{
 const first=deferred(),second=deferred();let count=0;const f=fixture(()=>++count===1?first.promise:second.promise);
 const a=f.controller.start(flow),b=f.controller.start({...flow,id:'other'});first.resolve(data());await a;assert.equal(f.controller.getState().data,null);
 second.resolve({...data(),dnis:'+33200000000'});await b;assert.equal(f.controller.getState().flow.id,'other');assert.equal(f.controller.getState().data.dnis,'+33200000000');f.controller.stop();
});
test('hidden tabs cancel refreshes and resume with a fresh read only while enabled',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return data();});await f.controller.start(flow);f.controller.setVisible(false);assert.equal(f.timers.size,0);await f.controller.refresh();assert.equal(calls,1);
 f.controller.setVisible(true);await tick();assert.equal(calls,2);f.controller.stop();f.controller.setVisible(false);f.controller.setVisible(true);await tick();assert.equal(calls,2);
});
test('retry-after slows polling and permission errors do not repeatedly query Genesys',async()=>{
 const throttled=data();throttled.live={status:'error',httpStatus:429,retryAfterMs:90000,error:'Limite atteinte',queues:[]};
 const f=fixture(async()=>throttled);await f.controller.start(flow);assert.equal([...f.timers.values()][0].ms,90000);f.controller.stop();
 const denied=fixture(async()=>({...data(),live:{status:'error',httpStatus:403,error:'Accès refusé',queues:[]}}));await denied.controller.start(flow);assert.equal(denied.timers.size,0);assert.equal(denied.controller.getState().data.live.httpStatus,403);denied.controller.stop();
});
test('invalid queries and malformed responses wait for explicit refresh rather than polling',async()=>{
 for(const httpStatus of [400,404,undefined]){
  const f=fixture(async()=>({...data(),history:{status:'error',httpStatus,error:'Requête indisponible'}}));
  await f.controller.start(flow);assert.equal(f.timers.size,0);assert.equal(f.controller.getState().data.live.queues[0].waiting,3);f.controller.stop();
 }
});
test('starting without a verified baseline or credentials never sends an analytics request',async()=>{
 let calls=0;const missing=fixture(async()=>{calls++;return data();});await missing.controller.start(null);assert.equal(calls,0);assert.match(missing.controller.getState().error,/version chargée/);missing.controller.stop();
 const unauth=createLiveActivityController({getToken:()=>null,load:async()=>{calls++;return data();}});await unauth.start(flow);assert.equal(calls,0);assert.match(unauth.getState().error,/Connectez-vous/);unauth.stop();
});
test('network failures retain the last measurement visibly without automatic request storms',async()=>{
 let fail=false;const f=fixture(async()=>{if(fail)throw Error('Réseau indisponible');return data();});await f.controller.start(flow);fail=true;await f.controller.refresh();assert.equal(f.controller.getState().error,'Réseau indisponible');assert.equal(f.controller.getState().data.history.metrics.connected,24);assert.equal(f.timers.size,0);assert.match(liveActivityView(f.controller.getState()),/données conservées/);f.controller.stop();
});
test('queue matching never invents data for dynamic, changed or ambiguous queue names',()=>{
 assert.equal(queueForActivityNode(flow.nodes[1],data()).waiting,3);
 for(const QUEUE of ['variable',' Q Clients','Q Brouillon','$var:file$',''])assert.equal(queueForActivityNode({...flow.nodes[1],row:{QUEUE}},data()),null);
 assert.equal(queueForActivityNode(flow.nodes[2],data()),null);
 const ambiguous=data();ambiguous.live.queues.push({...ambiguous.live.queues[0],id:'other'});assert.equal(queueForActivityNode(flow.nodes[1],ambiguous),null);
 const unavailable=data();unavailable.live.status='error';assert.equal(queueForActivityNode(flow.nodes[1],unavailable),null);
});
test('view displays actual node metrics, leaves unsupported steps unknown and labels queue scope',()=>{
 assert.equal(liveActivityView({enabled:false}), '');assert.match(liveActivityToggle(false),/aria-pressed="false"/);
 const html=liveActivityView({enabled:true,visible:true,flow,data:data(),nextRefreshAt:31000});
 assert.match(html,/Parcours &lt;client&gt;/);assert.match(html,/data-activity-node="team"/);assert.match(html,/>3<\/strong>/);assert.match(html,/>24<\/strong>/);assert.match(html,/Pas de mesure propre à cette étape/);assert.match(html,/tous numéros confondus/);assert.match(html,/ne s’additionnent pas/);assert.doesNotMatch(html,/saturée/i);
 const missing=data();missing.live.queues[0].waiting=null;const unknown=liveActivityView({enabled:true,visible:true,flow,data:missing});assert.match(unknown,/Attentes dans ces files<\/span><strong>—/);
});
