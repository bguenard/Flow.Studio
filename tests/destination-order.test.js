import test from 'node:test';
import assert from 'node:assert/strict';
import {sortDestinations} from '../src/destination-order.js';
import {designerView} from '../src/flow-designer-view.js';

test('French destination order ignores case and accents, sorts numbers naturally, and preserves identities',()=>{
  const source=['Zulu','équipe 10','Équipe 2','accueil','EQUIPE 1'].map((label,index)=>({nodeId:String(index),label}));
  const sorted=sortDestinations(source);
  assert.deepEqual(sorted.map(item=>item.label),['accueil','EQUIPE 1','Équipe 2','équipe 10','Zulu']);
  assert.deepEqual(source.map(item=>item.nodeId),['0','1','2','3','4']);
  assert.equal(sorted[0],source[3]);
});

test('destination dropdown keeps its placeholder first and terminal actions after named destinations',()=>{
  const html=designerView({mode:'connect',options:{catalogue:[],placements:[],destinations:sortDestinations([{nodeId:'z',label:'Zulu'},{nodeId:'a',label:'Accueil'}])},form:{destination:{nodeId:'z'}}});
  const select=html.match(/<select[^>]*id="designer-destination"[\s\S]*?<\/select>/)?.[0];
  assert.ok(select);
  assert.ok(select.indexOf('Choisir…')<select.indexOf('Accueil'));
  assert.ok(select.indexOf('Accueil')<select.indexOf('Zulu'));
  assert.ok(select.indexOf('Zulu')<select.indexOf('Terminer l’appel'));
  assert.match(select,/<option value="z" selected/);
});
