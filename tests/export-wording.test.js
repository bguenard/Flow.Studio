import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVoiceInventory} from '../src/data-source.js';
import {demoSnapshot} from '../src/demo-snapshot.js';
import {startSimulation} from '../src/call-simulator.js';
import {simulatorView} from '../src/simulator-view.js';
import {createCallComparison} from '../src/call-comparison.js';
import {callComparisonView} from '../src/call-comparison-view.js';
import {stepList} from '../src/journey-view.js';
import {plural} from '../src/ui-kit.js';

const flow=buildVoiceInventory(demoSnapshot).flows[0];

test('a journey read from a local export is never presented as the Genesys version',()=>{
 const simulation=simulatorView(startSimulation(flow),{origin:'local'});
 assert.match(simulation,/Version de l’export/);assert.doesNotMatch(simulation,/Version Genesys/);
 const comparison=callComparisonView(createCallComparison(flow,flow),{origin:'local'});
 assert.match(comparison,/VERSION CHARGÉE DEPUIS L’EXPORT/);assert.doesNotMatch(comparison,/DEPUIS GENESYS/);
});

test('the Genesys wording stays the default for a connected source',()=>{
 assert.match(simulatorView(startSimulation(flow)),/Version Genesys/);
 assert.match(callComparisonView(createCallComparison(flow,flow)),/VERSION CHARGÉE DEPUIS GENESYS/);
});

test('technical step keys may wrap after an underscore and keep their exact tooltip',()=>{
 const html=stepList(flow,{audience:'admin'});
 assert.ok(html.includes(`title="${flow.nodes[0].key}"`));
 assert.ok(html.includes(`<strong>${flow.nodes[0].key.replace(/_/g,'_<wbr>')}</strong>`));
});

test('counts agree in number, including irregular plurals',()=>{
 assert.equal(plural(0,'étape'),'0 étape');
 assert.equal(plural(1,'étape'),'1 étape');
 assert.equal(plural(2,'étape'),'2 étapes');
 assert.equal(plural(3,'parcours créé','parcours créés'),'3 parcours créés');
});
