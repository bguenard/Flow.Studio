import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshot,buildVoiceInventory} from '../src/data-source.js';
import {createCallComparison,comparisonChoice,advanceCallComparison,comparisonComplete,evaluateScenarioDecision,callComparisonReport,comparisonDiff} from '../src/call-comparison.js';
import {createComparisonPlayback} from '../src/call-comparison-playback.js';
import {simulationPlaylist} from '../src/simulation-audio.js';
import {comparisonPlaylist} from '../src/call-comparison-audio.js';
import {callComparisonView} from '../src/call-comparison-view.js';

// Independent fixtures exercise actual data-table routing instead of implementation-shaped stubs.
function flow({welcome='tts:Bonjour',branch='schedulegroup',target='hours',decisionValue='ACTIF',reverse=false}={}){
 const snapshot=normalizeSnapshot({tables:[
  {id:'entry',name:'W_INBOUND_CALL_v5',rows:[{key:'+33123456789',DESCRIPTION:'Accueil',WELCOME_AUDIO:welcome,NEXT_TARGET_TYPE:branch,NEXT_TARGET:target}]},
  {id:'schedule',name:'W_SCHEDULE_GROUP_v5',rows:[{key:'hours',DESCRIPTION:'Horaires',OPEN_TARGET_TYPE:'service',OPEN_TARGET:'primary',CLOSED_TARGET_TYPE:'disconnect',CLOSED_TARGET_AUDIO:'tts:Notre agence est fermée.',EMERGENCY_TARGET_TYPE:'decision',EMERGENCY_TARGET:'crisis'}]},
  {id:'decision',name:'W_DECISION_v5',rows:[{key:'crisis',DESCRIPTION:'Gestion de crise',PARTICIPANT_DATA_TO_CHECK:'CRISE',DECISION_OPERATOR:'==',DECISION_VALUE:decisionValue,TRUE_TARGET_TYPE:'service',TRUE_TARGET:'backup',FALSE_TARGET_TYPE:'service',FALSE_TARGET:'primary'}]},
  {id:'services',name:'W_SERVICES_v5',rows:[{key:'primary',DESCRIPTION:'Première équipe',QUEUE:'Q Primaire',INQUEUE_AUDIO_1:'tts:Merci de patienter.',INQUEUE_TARGET_TYPE:'service',INQUEUE_TARGET:'backup',INQUEUE_TARGET_AUDIO:'tts:Nous vous transférons.'},{key:'backup',DESCRIPTION:'Équipe de secours',QUEUE:'Q Secours',INQUEUE_TARGET_TYPE:'disconnect'}]},
  {id:'menu',name:'W_MENU_v5',rows:[{key:'main',MENU_AUDIO:'tts:Tapez un ou deux.',...(reverse?{OPTION2_TARGET_TYPE:'service',OPTION2_TARGET:'backup',OPTION1_TARGET_TYPE:'service',OPTION1_TARGET:'primary'}:{OPTION1_TARGET_TYPE:'service',OPTION1_TARGET:'primary',OPTION2_TARGET_TYPE:'service',OPTION2_TARGET:'backup'})}]}
 ]});
 return buildVoiceInventory(snapshot).flows[0];
}
function run(c){
 for(let i=0;i<80&&!comparisonComplete(c);i++){
  const session=c.lanes[c.cursor];
  assert.ok(session.status!=='active'||comparisonChoice(c).route,comparisonChoice(c).reason);
  c=advanceCallComparison(c);
 }
 assert.equal(comparisonComplete(c),true);return c;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('review: crisis applies the same context but re-evaluates changed decision logic in each version',()=>{
 const before=flow(),after=flow({decisionValue:'INACTIF'}),original=structuredClone({before,after});
 const comparison=run(createCallComparison(before,after,{scenario:'crisis'}));
 assert.ok(comparison.lanes.before.trail.some(t=>t.nodeId==='services:backup'));
 assert.ok(!comparison.lanes.before.trail.some(t=>t.nodeId==='services:primary'));
 assert.ok(comparison.lanes.after.trail.some(t=>t.nodeId==='services:primary'));
 assert.deepEqual({before,after},original);
 const report=callComparisonReport(comparison);assert.equal(report.executedInGenesys,false);assert.equal(report.assumptions.context.CRISE,'ACTIF');
 assert.ok(report.differences.changes.some(f=>f.key==='DECISION_VALUE'));
});
test('review: closed scenario uses CLOSED and retains its final transition announcement',()=>{
 let c=createCallComparison(flow(),flow(),{scenario:'closed'});
 while(c.lanes.before.status==='active')c=advanceCallComparison(c);
 assert.equal(c.lanes.before.trail.at(-1).field,'CLOSED_TARGET_TYPE');
 assert.deepEqual(simulationPlaylist(c.lanes.before),[{kind:'tts',text:'Notre agence est fermée.'}]);
 assert.ok(!c.lanes.before.trail.some(t=>t.nodeId.startsWith('services:')));
});
test('review: saturation follows configured waiting exit and permits the backup team to answer',()=>{
 const c=run(createCallComparison(flow(),flow(),{scenario:'saturated'}));
 for(const side of ['before','after']){
  assert.equal(c.events[side].filter(e=>e.effect==='saturated').length,1);
  const trail=c.lanes[side].trail;
  assert.ok(trail.some(t=>t.field==='INQUEUE_TARGET_TYPE'&&t.nodeId==='services:primary'));
  assert.equal(trail.at(-1).nodeId,'services:backup');assert.match(c.lanes[side].outcome,/conseiller/);
 }
});
test('review: menu choices remain identical when the route order differs between versions',()=>{
 const before=flow({branch:'menu',target:'main'}),after=flow({branch:'menu',target:'main',reverse:true});
 const c=run(createCallComparison(before,after,{scenario:'closed',digit:'2'}));
 for(const side of ['before','after'])assert.equal(c.lanes[side].trail.find(t=>t.nodeId==='menu:main').field,'OPTION2_TARGET_TYPE');
});
test('review: unknown data is not false, blank is not numeric zero, invalid operators never evaluate',()=>{
 const row={PARTICIPANT_DATA_TO_CHECK:'CRISE',DECISION_OPERATOR:'==',DECISION_VALUE:'ACTIF'};
 assert.equal(evaluateScenarioDecision(row,{}),null);
 assert.equal(evaluateScenarioDecision({...row,DECISION_OPERATOR:'exist'},{}),null);
 assert.equal(evaluateScenarioDecision({...row,DECISION_OPERATOR:'empty'},{CRISE:''}),true);
 assert.equal(evaluateScenarioDecision({...row,DECISION_OPERATOR:'>=',DECISION_VALUE:'0'},{CRISE:' '}),null);
 assert.equal(evaluateScenarioDecision({...row,DECISION_OPERATOR:'>=',DECISION_VALUE:'0'},{CRISE:'0'}),true);
 assert.equal(evaluateScenarioDecision({...row,DECISION_OPERATOR:'execute'},{CRISE:'1'}),null);
 let c=createCallComparison(flow({branch:'decision',target:'crisis'}),flow({branch:'decision',target:'crisis'}),{context:{AUTRE:'ACTIF'}});
 c=advanceCallComparison(c);c=advanceCallComparison(c);assert.equal(comparisonChoice(c).route,null);
});
test('review: absent before version stays absent in both the results and export',()=>{
 const c=run(createCallComparison(null,flow(),{scenario:'closed'}));
 assert.equal(c.lanes.before,null);assert.equal(callComparisonReport(c).before,null);assert.equal(comparisonDiff(c).available,false);
});
test('review: audio completion gates the transition and never overlaps the two versions',async()=>{
 let state={...createCallComparison(flow(),flow()),playing:true},finish,starts=0;const timers=[];
 const audio={cancel(){},play(){starts++;return new Promise(resolve=>finish=resolve);}};
 const player=createComparisonPlayback({getState:()=>state,update:s=>{state=s;},audio,schedule:f=>{timers.push(f);return timers.length;},unschedule(){}});
 player.sync();await tick();assert.equal(starts,1);assert.equal(timers.length,0);assert.equal(state.turn,0);
 player.sync();assert.equal(starts,1);finish({cancelled:false});await tick();assert.equal(timers.length,1);
 timers.shift()();assert.equal(state.turn,1);assert.equal(state.cursor,'after');
 player.sync();await tick();assert.equal(starts,2);assert.equal(timers.length,0);player.cancel();finish({cancelled:true});await tick();
});
test('review: immediate pause cancels the queued audio startup before any sound begins',async()=>{
 let state={...createCallComparison(flow(),flow()),playing:true},starts=0;
 const player=createComparisonPlayback({getState:()=>state,update:s=>{state=s;},audio:{cancel(){},play:async()=>{starts++;return {cancelled:false};}}});
 player.sync();state={...state,playing:false};player.cancel();await tick();assert.equal(starts,0);
});
test('review: late audio completion and late failure cannot mutate a new comparison',async()=>{
 for(const fail of [false,true]){
  let state={...createCallComparison(flow(),flow()),playing:true},resolve,reject,updates=0;
  const player=createComparisonPlayback({getState:()=>state,update:s=>{updates++;state=s;},audio:{cancel(){},play:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})}});
  player.sync();await tick();player.cancel();const replacement=createCallComparison(flow(),flow(),{scenario:'closed'});state=replacement;
  if(fail)reject(Error('Old audio failure'));else resolve({cancelled:false});await tick();assert.equal(updates,0);assert.equal(state,replacement);
 }
});
test('review: a failed recorded message pauses before moving the illuminated step',async()=>{
 let state={...createCallComparison(flow({welcome:'pr:Accueil'}),flow()),playing:true};
 const timers=[];
 const player=createComparisonPlayback({getState:()=>state,update:s=>{state=s;},audio:{cancel(){},play:async()=>{throw Error('Message Genesys indisponible');}},schedule:f=>{timers.push(f);}});
 player.sync();await tick();assert.equal(state.playing,false);assert.equal(state.turn,0);assert.equal(state.cursor,'before');assert.match(state.audioError,/indisponible/);assert.deepEqual(timers,[]);
});
test('review: missing scenario branch requires a choice rather than silently taking a different branch',()=>{
 const f=structuredClone(flow());f.edges=f.edges.filter(e=>e.branch!=='EMERGENCY');
 let c=createCallComparison(f,f,{scenario:'crisis'});c=advanceCallComparison(c);c=advanceCallComparison(c);
 assert.equal(comparisonChoice(c).route,null);assert.throws(()=>advanceCallComparison(c),/Choisissez une branche/);
});
test('review: looping paths stop at the budget and never claim a real-call success',()=>{
 const f=structuredClone(flow());const schedule=f.nodes.find(n=>n.type==='schedulegroup');
 const closed=f.edges.find(e=>e.branch==='CLOSED');Object.assign(closed,{terminal:false,to:schedule.id,type:'schedulegroup',target:schedule.key,resolved:true});
 let c=createCallComparison(f,f,{scenario:'closed'});
 for(let i=0;i<165&&!comparisonComplete(c);i++)c=advanceCallComparison(c);
 assert.equal(comparisonComplete(c),true);
 for(const side of ['before','after']){assert.equal(c.lanes[side].status,'boundary');assert.match(c.lanes[side].outcome,/80 transitions/);assert.equal(callComparisonReport(c)[side].executedInGenesys,false);}
});
test('review: paired maps have distinct SVG marker identities and independently illuminated nodes',()=>{
 const c=advanceCallComparison(createCallComparison(flow(),flow(),{scenario:'closed'})),html=callComparisonView(c);
 const markerIds=[...html.matchAll(/<marker id="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(markerIds.length,4);assert.equal(new Set(markerIds).size,4);
 assert.ok(markerIds.includes('compare-before-arrow'));assert.ok(markerIds.includes('compare-after-arrow'));
 const before=html.slice(html.indexOf('data-side="before"'),html.indexOf('data-side="after"'));
 const after=html.slice(html.indexOf('data-side="after"'));
 assert.match(before,/current" data-map-node="schedule:hours"/);
 assert.match(after,/current" data-map-node="entry:\+33123456789"/);
});
test('review: comparison UI escapes configuration, context and error text and labels its simulated status',()=>{
 const f=structuredClone(flow());f.name='<script>alert(1)</script>';f.nodes[0].row.WELCOME_AUDIO='tts:<img src=x onerror=alert(1)>';
 const c=createCallComparison(f,f,{context:{'CRISE" onclick="bad':'<b>ACTIF</b>'}});c.audioError='<script>error</script>';
 const html=callComparisonView(c);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
 assert.match(html,/APPELS SIMULÉS/);assert.match(html,/Aucun appel réel/);assert.match(html,/VERSION CHARGÉE DEPUIS GENESYS/);
 assert.match(callComparisonView(createCallComparison(null,f)),/Pas encore publié/);
});

test('review: an idle comparison never cancels another player speech',()=>{
 let cancellations=0;
 const player=createComparisonPlayback({getState:()=>null,update(){},audio:{cancel(){cancellations++;},play:async()=>({cancelled:false})}});
 player.sync();player.sync();player.cancel();assert.equal(cancellations,0);
});
function waitingFlow(){
 return buildVoiceInventory(normalizeSnapshot({tables:[
  {id:'entry',name:'W_INBOUND_CALL_v5',rows:[{key:'+33123456789',WELCOME_AUDIO:'tts:Accueil',NEXT_TARGET_TYPE:'service',NEXT_TARGET:'primary'}]},
  {id:'services',name:'W_SERVICES_v5',rows:[{key:'primary',QUEUE:'Q Primaire',INQUEUE_AUDIO_1:'tts:Attente une',INQUEUE_MENU_1:'waitmenu',INQUEUE_AUDIO_2:'',INQUEUE_AUDIO_3:'tts:Attente trois',INQUEUE_AUDIO_4:'tts:Attente quatre',INQUEUE_REPEAT_AUDIO:'tts:Répétition non simulée',INQUEUE_TARGET_TYPE:'service',INQUEUE_TARGET:'backup',INQUEUE_TARGET_AUDIO:'tts:Débordement'},{key:'backup',QUEUE:'Q Secours',INQUEUE_TARGET_TYPE:'disconnect'}]},
  {id:'menus',name:'W_MENU_v5',rows:[{key:'waitmenu',MENU_AUDIO:'tts:Menu attente',OPTION1_TARGET_TYPE:'next',OPTION1_TARGET_AUDIO:'tts:Retour attente'}]}
 ]})).flows[0];
}
test('review: saturated waiting follows announcements, menu return and overflow once in each version',()=>{
 let c=createCallComparison(waitingFlow(),waitingFlow(),{scenario:'saturated'});
 const heard={before:[],after:[]};
 for(let i=0;i<80&&!comparisonComplete(c);i++){
  heard[c.cursor].push(...comparisonPlaylist(c).filter(x=>x.kind==='tts').map(x=>x.text));
  assert.ok(comparisonChoice(c).route||c.lanes[c.cursor].status!=='active',comparisonChoice(c).reason);
  c=advanceCallComparison(c);
 }
 assert.equal(comparisonComplete(c),true);
 for(const side of ['before','after']){
  assert.deepEqual(heard[side],['Accueil','Attente une','Menu attente','Retour attente','Attente trois','Attente quatre','Débordement']);
  assert.equal(c.lanes[side].trail.filter(t=>t.field==='INQUEUE_TARGET_TYPE').length,1);
  assert.equal(c.events[side].filter(e=>e.effect==='saturated').length,1);
 }
});
test('review: waiting stages remain independent when after removes an intermediate announcement',()=>{
 const before=waitingFlow(),after=structuredClone(before);
 after.nodes.find(n=>n.key==='primary').row.INQUEUE_AUDIO_3='';
 let c=createCallComparison(before,after,{scenario:'saturated'}),heard={before:[],after:[]};
 for(let i=0;i<80&&!comparisonComplete(c);i++){
  heard[c.cursor].push(...comparisonPlaylist(c).filter(x=>x.kind==='tts').map(x=>x.text));c=advanceCallComparison(c);
 }
 assert.equal(comparisonComplete(c),true);
 assert.equal(heard.before.filter(x=>x==='Attente trois').length,1);
 assert.equal(heard.after.filter(x=>x==='Attente trois').length,0);
 assert.equal(heard.before.filter(x=>x==='Attente quatre').length,1);
 assert.equal(heard.after.filter(x=>x==='Attente quatre').length,1);
});
