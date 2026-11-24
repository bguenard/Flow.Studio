import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWolfV5, registryInScope } from '../src/wolf-scope.js';
import { demoSnapshot } from '../src/demo-snapshot.js';
import { normalizeSnapshot, buildVoiceInventory } from '../src/data-source.js';

test('mixed imports retain only V5 voice tables without changing or migrating legacy rows',()=>{
  const input={source:{kind:'import'},tables:[{id:'old',name:'W_INBOUND_CALL_v4',rows:[{key:'one'}]},{id:'new',name:'W_INBOUND_CALL_v5',rows:[{key:'two'}]},{id:'message',name:'W_MESSAGE_v5',rows:[]}]};
  const before=structuredClone(input), result=selectWolfV5(input);
  assert.deepEqual(result.tables.map(t=>t.id),['new']);assert.equal(result.source.wolfVersion,'5');assert.deepEqual(result.source.excludedLegacyTableIds,['old']);assert.deepEqual(input,before);
  assert.equal(selectWolfV5({tables:[input.tables[0]]}).tables.length,0);
});

test('legacy registry entries stay stored but disappear from the active view',()=>{
  const registry={coreModels:[{id:'family',versions:[{flowId:'old:one'},{flowId:'new:two'}]}],declinations:[{flowId:'old:three',baseFlowId:'old:one'},{flowId:'new:four',baseFlowId:'new:two'}]};
  const before=structuredClone(registry), view=registryInScope(registry,{excludedLegacyTableIds:['old']});
  assert.equal(view.coreModels[0].versions.length,1);assert.equal(view.declinations.length,1);assert.deepEqual(registry,before);
});

test('demo inventory is natively V5 and uses V5 entry routing',()=>{
  const snapshot=normalizeSnapshot(selectWolfV5(demoSnapshot));
  const inventory=buildVoiceInventory(snapshot);
  assert.ok(inventory.flows.length>0);assert.ok(inventory.flows.every(f=>String(f.version)==='5'));
  const inbound=snapshot.tables.find(t=>/INBOUND_CALL/i.test(t.name));
  assert.ok(inbound.rows.every(r=>Object.hasOwn(r,'NEXT_TARGET_TYPE')&&!Object.hasOwn(r,'OPEN_TARGET_TYPE')));
});
