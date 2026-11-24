import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshot,buildVoiceInventory} from '../src/data-source.js';
import {prepareFlowWizard} from '../src/flow-wizard.js';
import {applyDesignerDraft} from '../src/designer-draft.js';
import {applyDraftRows} from '../src/working-inventory.js';
import {publicationRows,validatePublicationSelection} from '../src/publication.js';

const string={type:'string'};
function table(id,name,fields,rows=[]){return {id,name,schema:{required:['key'],properties:{key:string,DESCRIPTION:string,...Object.fromEntries(fields.map(key=>[key,string]))}},rows};}
function setup(){
 const snapshot=normalizeSnapshot({tables:[
  table('entry','W_INBOUND_CALL_v5',['NEXT_TARGET_TYPE','NEXT_TARGET','WELCOME_AUDIO'],[{key:'+33111111111',DESCRIPTION:'Accueil existant',NEXT_TARGET_TYPE:'disconnect',NEXT_TARGET:''}]),
  table('menu','W_MENU_v5',['MENU_AUDIO','OPTION1_TARGET_TYPE','OPTION1_TARGET','OPTION2_TARGET_TYPE','OPTION2_TARGET','DEFAULT_TARGET_TYPE','DEFAULT_TARGET']),
  table('schedule','W_SCHEDULE_GROUP_v5',['SCHEDULE_GROUP','OPEN_TARGET_TYPE','OPEN_TARGET','CLOSED_TARGET_TYPE','CLOSED_TARGET','HOLIDAY_TARGET_TYPE','HOLIDAY_TARGET','EMERGENCY_TARGET_TYPE','EMERGENCY_TARGET']),
  table('service','W_SERVICES_v5',['QUEUE','PRIORITY','INQUEUE_TARGET_TYPE','INQUEUE_TARGET'])
 ]});
 const original=snapshot.tables[0].rows[0],draft={nodeId:'entry:'+original.key,tableId:'entry',table:'W_INBOUND_CALL_v5',key:original.key,original,row:{...original,DESCRIPTION:'Accueil modifié'}};
 return {snapshot,drafts:new Map([[draft.nodeId,draft]]),draft};
}
const form={name:'Nouveau parcours',phone:'+33222222222',routing:'menu',welcomeValues:{WELCOME_AUDIO:'tts:Bienvenue'},menuAudio:'tts:Pour un devis tapez 1, pour une assistance tapez 2.',scheduleEnabled:true,scheduleGroup:'Horaires France',choices:[{digit:'1',label:'Devis',queue:'Q Devis',priority:'1'},{digit:'2',label:'Assistance',queue:'Q Assistance',priority:'2'}]};

test('wizard commit preserves earlier draft baselines and every new row survives serialization as a creation',()=>{
 const {snapshot,drafts,draft}=setup(),original=JSON.stringify(snapshot),beforeDraft=JSON.stringify([...drafts]);
 const plan=prepareFlowWizard({snapshot:applyDraftRows(snapshot,drafts),form});
 assert.equal(plan.ok,true,JSON.stringify(plan.errors));assert.equal(plan.createdRows.length,5);assert.deepEqual(plan.updatedRows,[]);
 const result=applyDesignerDraft({snapshot,drafts,plan});
 assert.equal(JSON.stringify(snapshot),original);assert.equal(JSON.stringify([...drafts]),beforeDraft);
 assert.deepEqual(result.drafts.get(draft.nodeId),draft);
 assert.equal(result.snapshot.tables[0].rows[0].DESCRIPTION,'Accueil existant');
 const stored=JSON.parse(JSON.stringify({snapshot:result.snapshot,drafts:[...result.drafts],creations:[[plan.flowId,{...plan.summary,mappings:plan.mappings}]]}));
 const restoredDrafts=new Map(stored.drafts),created=new Map(stored.creations);
 const published=publicationRows(stored.snapshot,restoredDrafts,created);
 assert.equal(published.filter(row=>row.kind==='create').length,5);assert.equal(published.length,6);
 assert.deepEqual(new Set(published.filter(row=>row.kind==='create').map(row=>row.id)),new Set(plan.mappings.map(row=>row.nodeId)));
 const previous=published.find(row=>row.id===draft.nodeId);
 assert.equal(previous.before.DESCRIPTION,'Accueil existant');assert.equal(previous.after.DESCRIPTION,'Accueil modifié');
 const flow=buildVoiceInventory(applyDraftRows(stored.snapshot,restoredDrafts)).flows.find(flow=>flow.id===plan.flowId);
 assert.equal(flow.nodes.filter(node=>!node.terminal).length,5);
});

test('wizard publication requires every referenced new block and orders dependencies before entry',()=>{
 const {snapshot}=setup(),plan=prepareFlowWizard({snapshot,form});assert.equal(plan.ok,true,JSON.stringify(plan.errors));
 const result=applyDesignerDraft({snapshot,plan});
 const rows=publicationRows(result.snapshot,result.drafts,new Map([[plan.flowId,{mappings:plan.mappings}]]));
 assert.doesNotThrow(()=>validatePublicationSelection(rows));
 assert.equal(rows.at(-1).id,plan.flowId);
 for(const row of rows)for(const dependency of row.requiresCreatedRows)assert.ok(rows.findIndex(item=>item.id===dependency)<rows.indexOf(row));
 const queue=rows.find(row=>row.table==='W_SERVICES_v5');
 assert.throws(()=>validatePublicationSelection(rows.filter(row=>row.id!==queue.id)),/non sélectionnée/);
});

test('incomplete wizard cannot alter snapshots or existing drafts',()=>{
 const {snapshot,drafts}=setup(),before=JSON.stringify({snapshot,drafts:[...drafts]});
 const plan=prepareFlowWizard({snapshot:applyDraftRows(snapshot,drafts),form:{...form,choices:[{...form.choices[0],queue:''},form.choices[1]]}});
 assert.equal(plan.ok,false);assert.deepEqual(plan.createdRows,[]);assert.equal(plan.snapshot,null);
 assert.throws(()=>applyDesignerDraft({snapshot,drafts,plan}),/Vérifiez/);
 assert.equal(JSON.stringify({snapshot,drafts:[...drafts]}),before);
});
