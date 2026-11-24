import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationPreflight} from '../src/publication-preflight.js';
import {publicationView} from '../src/publication-view.js';
const schema=fields=>({type:'object',required:['key'],properties:Object.fromEntries(['key',...fields].map(k=>[k,{type:k==='PRIORITY'?'integer':'string',...(k==='PRIORITY'?{minimum:0}:{})}]))});
const table=(id,name,rows,fields=[])=>({id,name,rows,schema:schema([...new Set([...rows.flatMap(r=>Object.keys(r)),...fields])])});
function fixture(){return {tables:[
 table('in','W_INBOUND_CALL_v5',[{key:'+33100000001',DESCRIPTION:'Accueil Paris',DIVISION:'France',NEXT_TARGET_TYPE:'menu',NEXT_TARGET:'M'},{key:'+33100000002',DESCRIPTION:'Accueil Lyon',DIVISION:'France',NEXT_TARGET_TYPE:'menu',NEXT_TARGET:'M'}]),
 table('menu','W_MENU_v5',[{key:'M',DESCRIPTION:'Votre demande',OPTION1_TARGET_TYPE:'service',OPTION1_TARGET:'S',DEFAULT_TARGET_TYPE:'disconnect',DEFAULT_TARGET:''}]),
 table('service','W_SERVICES_v5',[{key:'S',DESCRIPTION:'Conseillers',QUEUE:'Q Clients',PRIORITY:1,INQUEUE_TARGET_TYPE:'disconnect',INQUEUE_TARGET:''}]),
 table('record','W_RECORDING_V5',[{key:'France',ENABLE_RECORDING:'true'}]),
 table('context','W_PARTICIPANT_DATA_v5',[{key:'P',DESCRIPTION:'Contexte client',PDATA_LIST_1:'CRISE==ACTIF'}]),
 ]};}
function change(snapshot,id,key,delta,kind='update'){
 const t=snapshot.tables.find(t=>t.id===id),before=kind==='create'?null:structuredClone(t.rows.find(r=>r.key===key)),after={...before,key,...delta};
 return {id:`${id}:${key}`,tableId:id,table:t.name,key,label:after.DESCRIPTION||key,kind,before,after,fields:Object.keys(delta)};
}
test('preflight identifies every numbered flow sharing the changed configuration without mutating source',()=>{
 const snapshot=fixture(),before=structuredClone(snapshot),rows=[change(snapshot,'service','S',{PRIORITY:4})];
 const result=publicationPreflight({snapshot,rows});
 assert.equal(result.errors,0);assert.equal(result.canPrepare,true);assert.equal(result.impacted.length,2);assert.equal(result.changedFields,1);assert.equal(result.unknownScope.length,0);
 assert.deepEqual(snapshot,before);assert.equal(result.executedInGenesys,false);assert.deepEqual(result.impacted[0].changedRows,['service:S']);
});
test('selection projection never relies on an unselected created row',()=>{
 const snapshot=fixture(),create=change(snapshot,'service','NEW',{DESCRIPTION:'Nouvelle équipe',QUEUE:'Q Clients',PRIORITY:0,INQUEUE_TARGET_TYPE:'disconnect',INQUEUE_TARGET:''},'create');
 snapshot.tables[2].rows.push(create.after);
 const edit=change(snapshot,'menu','M',{OPTION1_TARGET:'NEW'});edit.requiresCreatedRows=[create.id];
 const report=publicationPreflight({snapshot,rows:[create,edit],selected:new Set([edit.id])});
 assert.equal(report.canPrepare,false);assert.ok(report.findings.some(f=>f.code==='unselected-dependency'));assert.ok(report.findings.some(f=>/absente/.test(f.detail)));
 const together=publicationPreflight({snapshot,rows:[create,edit]});assert.equal(together.errors,0);
});
test('multiple invalid selected settings are shown, not only the first error',()=>{
 const snapshot=fixture(),edit=change(snapshot,'service','S',{PRIORITY:-2,INQUEUE_TARGET_TYPE:'service',INQUEUE_TARGET:'UNKNOWN'});
 const report=publicationPreflight({snapshot,rows:[edit]});
 assert.ok(report.errors>=2);assert.ok(report.findings.some(f=>f.field==='PRIORITY'));assert.ok(report.findings.some(f=>f.field==='INQUEUE_TARGET_TYPE'||f.field==='INQUEUE_TARGET'));
 assert.equal(report.canPrepare,false);
});
test('unselected invalid drafts do not block the selected publication',()=>{
 const snapshot=fixture(),bad=change(snapshot,'menu','M',{OPTION1_TARGET:'UNKNOWN'}),good=change(snapshot,'service','S',{PRIORITY:2});
 const report=publicationPreflight({snapshot,rows:[bad,good],selected:new Set([good.id])});assert.equal(report.errors,0);assert.equal(report.impacted.length,2);
});
test('previously present anomalies are warnings when unrelated selected settings are changed',()=>{
 const snapshot=fixture();snapshot.tables[1].rows[0].DEFAULT_TARGET_TYPE='service';snapshot.tables[1].rows[0].DEFAULT_TARGET='UNKNOWN';
 const edit=change(snapshot,'service','S',{PRIORITY:2});
 const report=publicationPreflight({snapshot,rows:[edit]});assert.equal(report.errors,0);assert.ok(report.findings.some(f=>f.code==='existing-anomaly'));assert.equal(report.canPrepare,true);
});
test('impact follows PDATA and menu references and includes paths removed by publication',()=>{
 const snapshot=fixture();snapshot.tables[1].rows[0].OPTION1_TARGET='S|pdata:P';
 const context=change(snapshot,'context','P',{PDATA_LIST_1:'CRISE==INACTIF'}),route=change(snapshot,'menu','M',{OPTION1_TARGET_TYPE:'disconnect',OPTION1_TARGET:''});
 const report=publicationPreflight({snapshot,rows:[context,route]});assert.equal(report.errors,0);assert.equal(report.impacted.length,2);assert.ok(report.impacted.every(f=>f.changedRows.includes(context.id)));assert.equal(report.unknownScope.length,0);
});
test('runtime configurations never claim zero impact when static traversal cannot identify callers',()=>{
 const snapshot=fixture(),recording=change(snapshot,'record','France',{ENABLE_RECORDING:'false'});
 const report=publicationPreflight({snapshot,rows:[recording]});assert.equal(report.errors,0);assert.equal(report.unknownScope.length,1);assert.ok(report.findings.some(f=>f.code==='unknown-impact'));
 const html=publicationView({rows:[recording],selected:new Set([recording.id]),connected:true,preflight:report});assert.match(html,/Portée à confirmer/);assert.match(html,/0 \+ \?/);
});
test('expired or changed plans cannot present a publish-ready state',()=>{
 const snapshot=fixture(),row=change(snapshot,'service','S',{PRIORITY:2}),plan={createdAt:1,actor:{organizationName:'Org',userName:'User'},entries:[row]};
 const expired=publicationPreflight({snapshot,rows:[row],plan,now:()=>300001});assert.ok(expired.findings.some(f=>f.code==='stale-plan'));
 const revised=publicationPreflight({snapshot,rows:[row],plan,now:()=>10,revision:2,planRevision:1});assert.equal(revised.canPrepare,false);
 const html=publicationView({rows:[row],plan,preflight:expired,connected:true});assert.match(html,/data-action="publication-commit"[^>]*disabled/);
});
test('finding text is escaped and points to the original configuration',()=>{
 const snapshot=fixture(),row=change(snapshot,'service','S',{DESCRIPTION:'<script>bad</script>',PRIORITY:-1}),report=publicationPreflight({snapshot,rows:[row]});
 const html=publicationView({rows:[row],selected:new Set([row.id]),connected:true,preflight:report});
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-action="publication-inspect"[^>]*data-table="service"[^>]*data-key="S"/);assert.match(html,/data-action="publication-prepare"[^>]*disabled/);
});
test('a changed destination that reaches an existing broken branch is newly blocking',()=>{
 const snapshot=fixture();snapshot.tables[1].rows.push({key:'BROKEN',DESCRIPTION:'Menu isolé',OPTION1_TARGET_TYPE:'service',OPTION1_TARGET:'UNKNOWN'});
 const row=change(snapshot,'in','+33100000001',{NEXT_TARGET:'BROKEN'}),report=publicationPreflight({snapshot,rows:[row]});
 assert.ok(report.findings.some(f=>f.code==='introduced-anomaly'&&f.rowId==='menu:BROKEN'));assert.equal(report.canPrepare,false);
});
test('valid callback configuration reports its external runtime dependency without a false missing-target blocker',()=>{
 const snapshot=fixture();snapshot.tables.push(table('callback','W_CALLBACK_v5',[{key:'CB',DESCRIPTION:'Rappel',DIVISION:'France',CALLBACK_QUEUE:'Q Clients'}]));
 const row=change(snapshot,'menu','M',{OPTION1_TARGET_TYPE:'callback',OPTION1_TARGET:'CB'}),report=publicationPreflight({snapshot,rows:[row]});
 assert.equal(report.errors,0);assert.ok(report.findings.some(f=>f.code==='external-flow'));assert.equal(report.impacted.length,2);
 const missing=publicationPreflight({snapshot,rows:[change(snapshot,'menu','M',{OPTION1_TARGET_TYPE:'callback',OPTION1_TARGET:'MISSING'})]});assert.ok(missing.errors>0);
});
test('prepared checks compare against fresh Genesys rows rather than an older loaded baseline',()=>{
 const snapshot=fixture(),entry=change(snapshot,'menu','M',{DESCRIPTION:'Choisissez votre demande'});
 entry.before={...entry.before,DEFAULT_TARGET_TYPE:'service',DEFAULT_TARGET:'UNKNOWN'};
 entry.after={...entry.after,DEFAULT_TARGET_TYPE:'service',DEFAULT_TARGET:'UNKNOWN'};
 const plan={createdAt:1,entries:[entry]},report=publicationPreflight({snapshot,baselineSnapshot:structuredClone(snapshot),rows:plan.entries,plan,now:()=>10});
 assert.equal(report.errors,0);assert.ok(report.findings.some(f=>f.code==='existing-anomaly'));assert.equal(report.changedFields,1);
 assert.equal(snapshot.tables[1].rows[0].DEFAULT_TARGET_TYPE,'disconnect');
});
