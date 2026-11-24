import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneFlow} from '../src/flow-clone.js';
import {normalizeSnapshot,buildVoiceInventory} from '../src/data-source.js';
import {FLOW_INITIALIZATION,flowInitializationDefinition} from '../src/flow-initialization.js';
import {prepareCoreModelCopy} from '../src/core-model-actions.js';
import {emptyRegistry,declareReference} from '../src/governance.js';
import {validateGovernanceMigration} from '../src/governance-projection.js';
function setup(){
 const definition=flowInitializationDefinition('g2s');
 const row=Object.fromEntries(Object.entries(definition.schema.properties).map(([name,rule])=>[name,rule.default??'']));
 Object.assign(row,{key:'+33999999500',DESCRIPTION:'Référence',DIVISION:'G2S',ATTRIBUTE_01_NAME:'ACTIVE',ATTRIBUTE_01_TYPE:'bool',ATTRIBUTE_01_VALUE:'false',ATTRIBUTE_02_NAME:'MAX',ATTRIBUTE_02_TYPE:'int',ATTRIBUTE_02_VALUE:'3',ATTRIBUTE_03_NAME:'STATUS',ATTRIBUTE_03_TYPE:'string',ATTRIBUTE_03_VALUE:'OUVERTE'});
 return normalizeSnapshot({tables:[
  {id:'in',name:'W_INBOUND_CALL_v5',rows:[{key:row.key,DESCRIPTION:'Référence',DIVISION:'G2S',NEXT_TARGET_TYPE:'disconnect',NEXT_TARGET:'|pdata:LEGACY'}]},
  {id:'legacy',name:'W_PARTICIPANT_DATA_v5',rows:[{key:'LEGACY',PDATA_LIST_1:'UNCHANGED==old',DIVISION:'G2S'}]},
  {id:'init',...definition,rows:[row]},
 ]});
}
const source=snapshot=>buildVoiceInventory(snapshot).flows[0];
const init=(snapshot,key)=>snapshot.tables.find(t=>t.name===FLOW_INITIALIZATION).rows.find(r=>r.key===key);
const options={name:'Agence Centre',division:'Agence',phone:'+33999999501'};
test('clone copies per-flow initialization using new inbound key and preserves source and legacy runtime data',()=>{
 const snapshot=setup(),before=structuredClone(snapshot),result=cloneFlow(snapshot,source(snapshot),options),copy=init(result.snapshot,options.phone);
 assert.deepEqual(snapshot,before);
 assert.deepEqual(copy,{...init(snapshot,source(snapshot).key),key:options.phone,DESCRIPTION:options.name,DIVISION:options.division});
 assert.deepEqual(init(result.snapshot,source(snapshot).key),init(snapshot,source(snapshot).key));
 const mapping=result.summary.mappings.find(m=>m.initialization);
 assert.equal(mapping.nodeId,'init:'+options.phone);assert.equal(mapping.sourceNodeId,'init:'+source(snapshot).key);
 assert.equal(result.summary.nodeCount,result.summary.mappings.length);
 assert.equal(result.snapshot.source.relationships.at(-1).nodeMappings.some(m=>m.localNodeId===mapping.nodeId),false);
 const clonedEntry=result.snapshot.tables.find(t=>t.id==='in').rows.find(r=>r.key===options.phone);
 const legacyMapping=result.summary.mappings.find(m=>m.tableId==='legacy');
 assert.equal(clonedEntry.NEXT_TARGET,'|pdata:'+legacyMapping.key);
 assert.equal(result.snapshot.tables.find(t=>t.id==='legacy').rows.find(r=>r.key===legacyMapping.key).PDATA_LIST_1,'UNCHANGED==old');
 assert.deepEqual(result.snapshot.tables.find(t=>t.id==='legacy').rows[0],snapshot.tables.find(t=>t.id==='legacy').rows[0]);
});
test('new versions copy values from their selected source and leave prior versions independent',()=>{
 const snapshot=setup(),flow=source(snapshot),registry=declareReference(emptyRegistry(),{flowId:flow.id,name:'Groupe',versionLabel:'V1'});
 const result=prepareCoreModelCopy({snapshot,registry,form:{sourceFlowId:flow.id,modelId:registry.coreModels[0].id,kind:'version',versionLabel:'V2',phone:options.phone,division:options.division}});
 assert.equal(init(result.snapshot,options.phone).ATTRIBUTE_01_VALUE,'false');assert.equal(init(result.snapshot,options.phone).DESCRIPTION,'Groupe · V2');
 assert.equal(init(result.snapshot,flow.key).ATTRIBUTE_01_VALUE,'false');assert.equal(result.registry.coreModels[0].versions.length,2);
 const next=structuredClone(result.snapshot);init(next,options.phone).ATTRIBUTE_01_VALUE='true';
 const versionFlow=buildVoiceInventory(next).flows.find(f=>f.id===result.flowId),copy=cloneFlow(next,versionFlow,{...options,phone:'+33999999502'});
 assert.equal(init(copy.snapshot,'+33999999502').ATTRIBUTE_01_VALUE,'true');assert.equal(init(copy.snapshot,flow.key).ATTRIBUTE_01_VALUE,'false');
});
test('missing source initialization creates no defaults or empty per-flow row',()=>{
 const snapshot=structuredClone(setup());snapshot.tables.find(t=>t.id==='init').rows=[];
 const result=cloneFlow(snapshot,source(snapshot),options);
 assert.equal(result.snapshot.tables.find(t=>t.id==='init').rows.length,0);assert.equal(result.summary.mappings.some(m=>m.initialization),false);
});
test('an existing initialization is never overwritten and numbered copies require an explicit new number',()=>{
 const snapshot=structuredClone(setup()),table=snapshot.tables.find(t=>t.id==='init');
 table.rows.push({...table.rows[0],key:options.phone});
 assert.throws(()=>cloneFlow(snapshot,source(snapshot),options),/déjà une initialisation/);
 assert.throws(()=>cloneFlow(snapshot,source(snapshot),{...options,phone:''}),/nouveau numéro d’entrée/);
});

test('declination governance contains graph mappings while publication summary retains its initialization row',()=>{
 const snapshot=setup(),flow=source(snapshot),registry=declareReference(emptyRegistry(),{flowId:flow.id,name:'Groupe',versionLabel:'V1'});
 const result=prepareCoreModelCopy({snapshot,registry,form:{sourceFlowId:flow.id,modelId:registry.coreModels[0].id,kind:'declination',name:options.name,phone:options.phone,division:options.division}});
 assert.ok(result.summary.mappings.some(m=>m.initialization));
 const child=result.registry.declinations.find(d=>d.flowId===result.flowId);
 assert.equal(child.nodeMappings.some(m=>m.localNodeId.startsWith('init:')),false);
 assert.doesNotThrow(()=>validateGovernanceMigration(result.registry,buildVoiceInventory(result.snapshot)));
 assert.equal(init(result.snapshot,options.phone).ATTRIBUTE_01_VALUE,'false');
});
