import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshot,buildVoiceInventory} from '../src/data-source.js';
import {applyDraftRows} from '../src/working-inventory.js';
import {prepareNewFlow,prepareNewBlock,designerOptions} from '../src/flow-designer.js';
import {applyDesignerDraft} from '../src/designer-draft.js';
import {publicationRows} from '../src/publication.js';
function setup(){
 const properties=Object.fromEntries(['key','DESCRIPTION','NEXT_TARGET_TYPE','NEXT_TARGET'].map(k=>[k,{type:'string'}]));
 const snapshot=normalizeSnapshot({tables:[{id:'entry',name:'W_INBOUND_CALL_v5',schema:{properties,required:['key']},rows:[{key:'+33100000000',DESCRIPTION:'Accueil',NEXT_TARGET_TYPE:'disconnect',NEXT_TARGET:''}]},{id:'menu',name:'W_MENU_v5',schema:{properties:{key:{type:'string'},DESCRIPTION:{type:'string'},MENU_AUDIO:{type:'string',default:''},MENU_TIMEOUT:{type:'integer',default:5},MENU_REPEAT:{type:'integer',default:0},DEFAULT_TARGET_TYPE:{type:'string'},DEFAULT_TARGET:{type:'string'}},required:['key']},rows:[]}]});
 return {snapshot,flow:buildVoiceInventory(snapshot).flows[0]};
}
test('new flow commits from frozen source without mutations, and is publishable as a creation',()=>{
 const {snapshot}=setup(),before=JSON.stringify(snapshot),plan=prepareNewFlow({snapshot,name:'Nouveau',phone:'+33111111111'});
 assert.equal(plan.ok,true,JSON.stringify(plan.errors));
 const next=applyDesignerDraft({snapshot,plan});assert.equal(JSON.stringify(snapshot),before);assert.equal(next.inventory.flows.length,2);
 const rows=publicationRows(next.snapshot,next.drafts,new Map([[plan.flowId,{mappings:plan.mappings}]]));assert.equal(rows.length,1);assert.equal(rows[0].kind,'create');assert.equal(rows[0].before,null);
});
test('insertion retains the live baseline while preserving previous field edits, including after serialization',()=>{
 const {snapshot,flow}=setup(),node=flow.nodes[0],draft={nodeId:node.id,tableId:node.tableId,table:node.tableName,key:node.key,original:node.row,row:{...node.row,DESCRIPTION:'Accueil adapté'}};
 const drafts=new Map([[node.id,draft]]),effective=applyDraftRows(snapshot,drafts),working=buildVoiceInventory(effective).flows[0],placement=designerOptions({snapshot:effective,flow:working}).placements[0];
 const plan=prepareNewBlock({snapshot:effective,flow:working,type:'menu',name:'Choix',key:'CHOIX',placementId:placement.id,continuationField:'DEFAULT_TARGET_TYPE'});
 assert.equal(plan.ok,true,JSON.stringify(plan.errors));const result=applyDesignerDraft({snapshot,drafts,plan});
 assert.equal(result.drafts.get(node.id).original.DESCRIPTION,'Accueil');assert.equal(result.drafts.get(node.id).row.DESCRIPTION,'Accueil adapté');
 const restored=JSON.parse(JSON.stringify({snapshot:result.snapshot,drafts:[...result.drafts],blocks:[[plan.nodeId,plan.summary]]}));
 const rows=publicationRows(restored.snapshot,new Map(restored.drafts),new Map(),new Map(restored.blocks));assert.equal(rows.length,2);assert.equal(rows[0].kind,'create');assert.equal(rows[1].before.NEXT_TARGET_TYPE,'disconnect');assert.equal(rows[1].after.NEXT_TARGET_TYPE,'menu');
 assert.throws(()=>applyDesignerDraft({snapshot,plan}),/changé/);
});
test('pending input and duplicate additions reject atomically',()=>{
 const {snapshot}=setup(),plan=prepareNewFlow({snapshot,name:'Nouveau',phone:'+33111111111'});
 assert.throws(()=>applyDesignerDraft({snapshot,plan,pendingFields:new Map([['entry',{DESCRIPTION:'Saisie'}]])}),/réglages en cours/);
 const result=applyDesignerDraft({snapshot,plan});assert.throws(()=>applyDesignerDraft({snapshot:result.snapshot,plan}),/existe déjà/);assert.equal(snapshot.tables[0].rows.length,1);
});
