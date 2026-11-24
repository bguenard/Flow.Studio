import test from 'node:test';
import assert from 'node:assert/strict';
import {durableRegistry,restorePendingRegistry,validateGovernanceMigration} from '../src/governance-projection.js';
import {emptyRegistry,declareReference,attachDeclination,setScope} from '../src/governance.js';
const registry=()=>attachDeclination(declareReference(emptyRegistry(),{flowId:'t:reference',name:'Groupe',versionLabel:'V1'}),{flowId:'t:entity',baseFlowId:'t:reference',scope:'active',nodeMappings:[{referenceNodeId:'t:reference',localNodeId:'t:entity'}]});
test('pending complete model is never persisted as a remote role',()=>{
 const original=registry(),before=structuredClone(original);
 assert.deepEqual(durableRegistry(original,['t:reference','t:entity']),emptyRegistry());
 assert.deepEqual(original,before);
});
test('existing reference remains while unpublished declination stays pending',()=>{
 const result=durableRegistry(registry(),['t:entity']);assert.equal(result.coreModels.length,1);assert.equal(result.declinations.length,0);
});
test('workspace recovery keeps remote changes and only adds unpublished roles',()=>{
 const old=registry(),remote=setScope(old,'t:entity','inactive');
 const draft=attachDeclination(old,{flowId:'t:new',baseFlowId:'t:reference'});
 const recovered=restorePendingRegistry(remote,draft,['t:new']);
 assert.equal(recovered.declinations.find(d=>d.flowId==='t:entity').scope,'inactive');
 assert.equal(recovered.declinations.length,2);
 assert.deepEqual(durableRegistry(recovered,['t:new']),remote);
});
test('migration refuses another organization or mismatched node mappings',()=>{
 const input=registry();assert.throws(()=>validateGovernanceMigration(input,{flows:[]}),/absente/);
 assert.throws(()=>validateGovernanceMigration(input,{flows:[{id:'t:reference',nodes:[]},{id:'t:entity',nodes:[]}]}),/correspondance/);
 const inventory={flows:[{id:'t:reference',nodes:[{id:'t:reference'}]},{id:'t:entity',nodes:[{id:'t:entity'}]}]};
 assert.deepEqual(validateGovernanceMigration(input,inventory),input);
});
test('recovery refuses independently created model IDs instead of merging unrelated families',()=>{
 const remote=declareReference(emptyRegistry(),{flowId:'t:remote',name:'Accueil',versionLabel:'V1'});
 const draft=declareReference(emptyRegistry(),{flowId:'t:pending',name:'Accueil',versionLabel:'V1'}),before=structuredClone(remote);
 assert.throws(()=>restorePendingRegistry(remote,draft,['t:pending']),/Conflit de Core Model/);assert.deepEqual(remote,before);
});
test('recovery preserves a remote family rename when a published version proves common provenance',()=>{
 const draft=declareReference(registry(),{flowId:'t:pending',coreModelId:registry().coreModels[0].id,versionLabel:'V2'}),remote=registry();remote.coreModels[0].name='Nouveau nom Groupe';
 const restored=restorePendingRegistry(remote,draft,['t:pending']);assert.equal(restored.coreModels[0].name,'Nouveau nom Groupe');assert.equal(restored.coreModels[0].versions.length,2);
 assert.deepEqual(durableRegistry(restored,['t:pending']),remote);
});
test('recovery rejects a pending version label already used by another remote version',()=>{
 const base=registry(),model=base.coreModels[0].id;
 const remote=declareReference(base,{flowId:'t:remote-v2',coreModelId:model,versionLabel:'V2'});
 const draft=declareReference(base,{flowId:'t:pending-v2',coreModelId:model,versionLabel:'V2'});
 assert.throws(()=>restorePendingRegistry(remote,draft,['t:pending-v2']),/Conflit de version/);
});
