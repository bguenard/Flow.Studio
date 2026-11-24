import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutJourney } from '../src/journey-canvas.js';
import { journeyDiagram, prepareDiagram } from '../src/journey-diagram.js';

// Le diagramme affiché en Administration, une fois son placement calculé.
const drawn = async (flow, options = {}) => { await prepareDiagram(flow, options); return journeyDiagram(flow, options); };

const node = (id, type, description = id) => ({ id, type, key: id, label: type, row: { key: id, DESCRIPTION: description } });
const edge = (from, to, branch, extra = {}) => ({ from, to, branch, type: 'service', resolved: true, relationship: 'route', ...extra });

test('layered canvas keeps branches and reconvergence with one card per real node', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('a', 'menu'), node('b', 'menu'), node('end', 'service')], edges: [edge('entry', 'a', 'OPEN'), edge('entry', 'b', 'CLOSED'), edge('a', 'end', 'OPTION1'), edge('b', 'end', 'OPTION2')] };
  const original = structuredClone(flow), layout = layoutJourney(flow);
  assert.equal(layout.nodes.length, 4);
  assert.deepEqual(layout.nodes.map(n => [n.id, n.layer]), [['entry', 0], ['a', 1], ['b', 1], ['end', 2]]);
  assert.equal(layout.edges.length, 4);
  assert.notEqual(layout.nodes[1].y, layout.nodes[2].y);
  assert.deepEqual(flow, original);
  assert.deepEqual(layoutJourney(flow), layout);
  for (const n of layout.nodes) { assert.ok(n.x >= 0 && n.y >= 0); assert.ok(n.x + n.width <= layout.width && n.y + n.height <= layout.height); }
});

test('cycles use visible return paths without duplicating steps', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('menu', 'menu'), node('team', 'service')], edges: [edge('entry', 'menu', 'NEXT'), edge('menu', 'team', 'OPTION1'), edge('team', 'menu', 'INQUEUE')] };
  const layout = layoutJourney(flow);
  assert.equal(layout.nodes.length, 3);
  assert.ok(layout.edges.some(e => e.backedge && e.from === 'team' && e.to === 'menu'));
  for (const e of layout.edges) assert.ok(!e.path.includes('NaN'));
});

test('multiple conditions to the same destination remain present in the edge label', async () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('team', 'service')], edges: [edge('entry', 'team', 'OPEN'), edge('entry', 'team', 'CLOSED')] };
  const layout = layoutJourney(flow);
  assert.equal(layout.edges.length, 1);
  assert.deepEqual(layout.edges[0].labels, ['Pendant l’ouverture', 'En dehors des horaires']);
  const html = await drawn(flow);
  assert.ok(html.includes('Pendant l’ouverture'));
  assert.ok(html.includes('En dehors des horaires'));
});

test('context attachments are counted on their owner and not inserted into execution', async () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('context', 'pdata'), node('team', 'service')], edges: [edge('entry', 'context', '', { relationship: 'context' }), edge('entry', 'team', 'NEXT')] };
  const layout = layoutJourney(flow);
  assert.deepEqual(layout.nodes.map(n => n.id), ['entry', 'team']);
  assert.equal(layout.nodes[0].contexts, 1);
  assert.equal(layout.edges.length, 1);
  assert.ok((await drawn(flow)).includes('1 information associée'));
});

test('actual terminal and missing destinations stay distinct and faithfully named', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall')], edges: [edge('entry', null, 'OPEN', { terminal: true, type: 'queue', target: 'Conseillers habitation' }), edge('entry', null, 'CLOSED', { terminal: true, type: 'disconnect' }), edge('entry', null, 'DEFAULT', { resolved: false, target: 'missing' })] };
  const layout = layoutJourney(flow);
  assert.equal(layout.nodes.length, 4);
  assert.ok(layout.nodes.some(n => n.title === 'Équipe · Conseillers habitation' && n.terminal));
  assert.ok(layout.nodes.some(n => n.title === 'Fin d’appel' && n.terminal));
  assert.ok(layout.nodes.some(n => n.title === 'Destination à vérifier' && n.unresolved));
});

test('primary view folds queue properties and waiting menus but preserves N1 to N2 continuation', async () => {
  const first = node('n1', 'service', 'Niveau 1'); first.row.QUEUE = 'variable';
  const second = node('n2', 'service', 'Niveau 2'); second.row.QUEUE = 'variable';
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), first, second, node('wait', 'menu', 'Menu d’attente'), node('context', 'pdata')], edges: [
    edge('entry', 'n1', 'NEXT'),
    edge('n1', 'n2', 'INQUEUE', { phase: 'waiting', field: 'INQUEUE_TARGET_TYPE' }),
    edge('n1', 'wait', 'INQUEUE_MENU_1', { phase: 'waiting', field: 'INQUEUE_MENU_1', type: 'menu' }),
    edge('n2', 'wait', 'INQUEUE_REPEAT_MENU', { phase: 'waiting', field: 'INQUEUE_REPEAT_MENU', type: 'menu' }),
    edge('n1', null, 'QUEUE', { derivedFrom: 'QUEUE', field: 'QUEUE', type: 'queue', terminal: true, target: 'variable' }),
    edge('n2', null, 'QUEUE', { derivedFrom: 'QUEUE', field: 'QUEUE', type: 'queue', terminal: true, target: 'variable' }),
    edge('n1', 'context', '', { relationship: 'context', type: 'pdata' }),
  ] };
  const original = structuredClone(flow), primary = layoutJourney(flow);
  assert.deepEqual(primary.nodes.map(n => n.id), ['entry', 'n1', 'n2']);
  assert.ok(primary.edges.some(e => e.from === 'n1' && e.to === 'n2'));
  assert.equal(primary.hiddenLinksCount, 4);
  assert.equal(primary.hiddenNodeCount, 1);
  assert.equal(primary.attachments.n1.queues.length, 1);
  assert.equal(primary.attachments.n1.waitingMenus.length, 1);
  assert.equal(primary.nodes.find(n => n.id === 'n1').preview, 'File choisie pendant l’appel');
  const html = await drawn(flow);
  assert.ok(html.includes('File associée · Attente : 1 menu · 1 information associée'));
  assert.deepEqual(flow, original);
  const complete = layoutJourney(flow, { allLinks: true });
  assert.equal(complete.hiddenLinksCount, 0);
  assert.ok(complete.nodes.some(n => n.id === 'wait'));
  const queueEnds = complete.nodes.filter(n => n.terminal && n.kind === 'queue');
  assert.equal(queueEnds.length, 2);
  assert.notEqual(queueEnds[0].id, queueEnds[1].id);
  assert.ok(queueEnds.every(n => n.title === 'Destination déterminée pendant l’appel'));
  assert.ok(!(await drawn(flow, { allLinks: true })).includes('Équipe · variable'));
});

test('waiting menu also reached by an ordinary branch remains in the primary graph', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('team', 'service'), node('shared', 'menu')], edges: [
    edge('entry', 'team', 'OPEN'), edge('entry', 'shared', 'CLOSED', { type: 'menu' }),
    edge('team', 'shared', 'INQUEUE_MENU_2', { type: 'menu', phase: 'waiting', field: 'INQUEUE_MENU_2' }),
  ] };
  const layout = layoutJourney(flow);
  assert.ok(layout.nodes.some(n => n.id === 'shared'));
  assert.ok(layout.edges.some(e => e.from === 'entry' && e.to === 'shared'));
  assert.ok(!layout.edges.some(e => e.from === 'team' && e.to === 'shared'));
  assert.equal(layout.hiddenLinksCount, 1);
});

test('waiting-only subgraph is folded until its real reconvergence with the main route', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('team', 'service'), node('wait', 'menu'), node('choice', 'decision'), node('n2', 'service')], edges: [
    edge('entry', 'team', 'NEXT'),
    edge('team', 'n2', 'INQUEUE', { phase: 'waiting', field: 'INQUEUE_TARGET_TYPE' }),
    edge('team', 'wait', 'INQUEUE_MENU_1', { phase: 'waiting', field: 'INQUEUE_MENU_1', type: 'menu' }),
    edge('wait', 'choice', 'OPTION1', { type: 'decision' }), edge('choice', 'n2', 'TRUE'),
  ] };
  const layout = layoutJourney(flow);
  assert.deepEqual(layout.nodes.map(n => n.id), ['entry', 'team', 'n2']);
  assert.equal(layout.hiddenLinksCount, 3);
  assert.equal(layout.hiddenNodeCount, 2);
  const complete = layoutJourney(flow, { allLinks: true });
  assert.equal(complete.nodes.length, 5);
  assert.equal(complete.edges.length, 5);
});

test('terminal outcomes of different sources never create a shared fake routing node', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('a', 'service'), node('b', 'service')], edges: [
    edge('entry', 'a', 'OPEN'), edge('entry', 'b', 'CLOSED'),
    edge('a', null, 'DEFAULT', { terminal: true, type: 'disconnect', target: '' }),
    edge('b', null, 'DEFAULT', { terminal: true, type: 'disconnect', target: '' }),
  ] };
  const layout = layoutJourney(flow);
  assert.equal(layout.nodes.filter(n => n.terminal).length, 2);
  assert.notEqual(layout.edges.find(e => e.from === 'a').to, layout.edges.find(e => e.from === 'b').to);
  assert.ok(layout.edges.every(e => !e.backedge));
});

test('destination-free outcomes do not become dynamic because an unused target says variable', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall')], edges: [
    ...['disconnect', 'next', 'enable', 'disable'].map((type, index) => edge('entry', null, `OPTION${index}`, { terminal: true, type, target: 'variable' })),
    edge('entry', null, 'OPTION4', { terminal: true, type: 'queue', target: 'variable' }),
  ] };
  const layout = layoutJourney(flow, { allLinks: true });
  const outcomes = layout.nodes.filter(n => n.terminal);
  assert.equal(outcomes.find(n => n.kind === 'disconnect').title, 'Fin d’appel');
  for (const type of ['disconnect', 'next', 'enable', 'disable']) {
    const outcome = outcomes.find(n => n.kind === type);
    assert.notEqual(outcome.title, 'Destination déterminée pendant l’appel');
    assert.notEqual(outcome.typeLabel, 'Destination dynamique');
    assert.equal(layout.edges.find(e => e.to === outcome.id).routes[0].dynamic, false);
  }
  assert.equal(outcomes.find(n => n.kind === 'queue').title, 'Destination déterminée pendant l’appel');
});

test('source ports follow destination geometry when DEFAULT precedes NEXT in the source rows', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('decision', 'decision')], edges: [
    edge('entry', null, 'DEFAULT', { terminal: true, type: 'disconnect' }),
    edge('entry', 'decision', 'NEXT', { type: 'decision' }),
  ] };
  const layout = layoutJourney(flow);
  const upper = layout.edges.find(e => e.to === 'decision');
  const lower = layout.edges.find(e => e.labels.includes('Sinon'));
  const points = e => e.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const up = points(upper), down = points(lower);
  assert.equal(up[0], down[0]);
  assert.ok(up[1] < down[1], 'upper destination must leave from the upper source port');
  assert.ok(up.at(-1) < down.at(-1), 'destination order stays consistent');
  assert.deepEqual(upper.labels, ['Puis']);
  assert.deepEqual(lower.labels, ['Sinon']);
});

test('a queue reached by an opaque ID is named as a team on its exit, without changing the actual edge', async () => {
  const queueId = '12345678-abcd-1234-abcd-123456789abc';
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall', 'Accueil')], edges: [edge('entry', null, 'NEXT', { type: 'queue', terminal: true, target: queueId })] };
  const admin = await drawn(flow);
  assert.match(admin, /class="diagram-exit-end"[^>]*>Équipe ·/);
  assert.equal(layoutJourney(flow).edges[0].routes[0].edge.target, queueId);
});

test('ten menu keys sharing a destination stay complete and appear as one compact ordered caption', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('menu', 'menu'), node('team', 'service')], edges: [edge('entry', 'menu', 'NEXT'), ...[0,3,4,1,2,5,6,9,7,8].map(key => edge('menu', 'team', `OPTION${key}`))] };
  const grouped = layoutJourney(flow).edges.find(edge => edge.from === 'menu');
  assert.equal(grouped.routes.length, 10);
  assert.deepEqual(grouped.labels, Array.from({ length: 10 }, (_, key) => `Choix ${key}`));
  assert.deepEqual(grouped.labelLines, ['Choix 0 à 9']);
  const sparse = { ...flow, edges: flow.edges.filter(edge => !['OPTION4','OPTION5'].includes(edge.branch)) };
  assert.ok(!layoutJourney(sparse).edges.find(edge => edge.from === 'menu').labelLines.join(' ').includes('0 à 9'));
});

test('long names reserve height without overlapping neighbours and terminal outcomes stay compact', async () => {
  const long = node('long_identifier_with_no_spaces_'.repeat(4), 'menu', 'Gestion des demandes des assurés et accompagnement pendant les situations de crise '.repeat(3));
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), long, node('team', 'service')], edges: [edge('entry', long.id, 'OPEN'), edge('entry', 'team', 'CLOSED'), edge(long.id, null, 'DEFAULT', { type: 'disconnect', terminal: true })] };
  const layout = layoutJourney(flow), card = layout.nodes.find(node => node.id === long.id), team = layout.nodes.find(node => node.id === 'team');
  assert.ok(card.height > team.height);
  assert.ok(card.y + card.height < team.y || team.y + team.height < card.y);
  assert.ok(layout.nodes.find(node => node.terminal).height < team.height);
  const html = await drawn(flow);
  assert.ok(html.includes(long.row.DESCRIPTION.trim()));
  assert.ok(html.includes(long.key));
});

test('bypasses and return links use bounded orthogonal tracks outside cards', () => {
  const flow = { id: 'entry', nodes: [node('entry', 'inboundcall'), node('a', 'menu'), node('b', 'decision'), node('c', 'service')], edges: [edge('entry', 'a', 'NEXT'), edge('a', 'b', 'OPTION1'), edge('b', 'c', 'TRUE'), edge('entry', 'c', 'CLOSED'), edge('a', 'c', 'OPTION2'), edge('c', 'a', 'DEFAULT'), edge('c', 'c', 'INQUEUE')] };
  const layout = layoutJourney(flow);
  for (const e of layout.edges) {
    assert.ok(!e.path.includes(' C '), 'no reversing cubic curves');
    for (const [i, p] of e.points.entries()) {
      assert.ok(p[0] >= 0 && p[0] <= layout.width && p[1] >= 0 && p[1] <= layout.height);
      if (!i) continue;
      const a = e.points[i-1];
      assert.ok(a[0] === p[0] || a[1] === p[1]);
      for (const n of layout.nodes) {
        const crosses = a[0] === p[0]
          ? a[0] > n.x && a[0] < n.x+n.width && Math.max(a[1],p[1]) > n.y && Math.min(a[1],p[1]) < n.y+n.height
          : a[1] > n.y && a[1] < n.y+n.height && Math.max(a[0],p[0]) > n.x && Math.min(a[0],p[0]) < n.x+n.width;
        assert.equal(crosses, false, `route ${e.from}→${e.to} crosses ${n.id}`);
      }
    }
  }
});

test('neighbouring branches have distinct vertical tracks and bypass ports follow lane order', () => {
  const flow = { id: 'entry', nodes: [node('entry','inboundcall'),node('a','menu'),node('b','decision'),node('c','service'),node('d','service')], edges: [edge('entry','a','OPEN'),edge('entry','b','CLOSED'),edge('a','c','NEXT'),edge('c','d','NEXT'),edge('entry','c','OPTION1'),edge('entry','d','OPTION2')] };
  const layout=layoutJourney(flow);
  const direct=layout.edges.filter(e=>e.from==='entry'&&e.laneY===undefined);
  assert.equal(new Set(direct.map(e=>e.points[1][0])).size,direct.length);
  const bypass=layout.edges.filter(e=>e.from==='entry'&&e.laneY!==undefined).sort((a,b)=>a.laneY-b.laneY);
  for(let i=1;i<bypass.length;i++) assert.ok(bypass[i-1].points[0][1]<bypass[i].points[0][1]);
});

test('returns from separate nodes use distinct tracks in the same gutter', () => {
  const flow={id:'entry',nodes:[node('entry','inboundcall'),node('a','menu'),node('b','menu')],edges:[edge('entry','a','OPEN'),edge('entry','b','CLOSED'),edge('a','a','DEFAULT'),edge('b','b','DEFAULT')]};
  const returns=layoutJourney(flow).edges.filter(e=>e.backedge);
  assert.equal(new Set(returns.map(e=>e.points[1][0])).size,2);
  assert.equal(new Set(returns.map(e=>e.points[3][0])).size,2);
});

test('crossing branch captions stay separate and inside the canvas', () => {
  const flow={id:'entry',nodes:['entry','a','b','c','d'].map((id,i)=>node(id,i?'menu':'inboundcall')),edges:[edge('entry','a','OPEN'),edge('entry','b','CLOSED'),edge('a','c','OPTION1'),edge('a','d','OPTION2'),edge('b','c','OPTION1'),edge('b','d','OPTION2')]};
  const layout=layoutJourney(flow);
  for(const [i,a] of layout.edges.entries()) {
    const ah=a.labelLines.length*15+12;
    assert.ok(a.labelY-ah/2>=0&&a.labelY+ah/2<=layout.height);
    for(const b of layout.edges.slice(i+1)) {
      const bh=b.labelLines.length*15+12;
      assert.ok(Math.abs(a.labelX-b.labelX)>=144||Math.abs(a.labelY-b.labelY)>=(ah+bh)/2,`overlapping captions ${a.from}→${a.to} and ${b.from}→${b.to}`);
    }
  }
});

test('calendar outcomes remain separate when reaching the same decision with different contexts',()=>{
 const flow={id:'entry',nodes:[node('entry','inboundcall'),node('hours','schedulegroup'),node('status','decision')],edges:[
  edge('entry','hours','NEXT'),
  edge('hours','status','OPEN',{type:'decision',rawType:'decision|sub:qualifier',rawTarget:'status|pdata:agence_ouverte'}),
  edge('hours','status','CLOSED',{type:'decision',rawType:'decision|sub:qualifier',rawTarget:'status|pdata:agence_ferme'})
 ]};
 const original=structuredClone(flow),layout=layoutJourney(flow),exits=layout.edges.filter(e=>e.from==='hours');
 assert.equal(exits.length,2);assert.equal(layout.nodes.filter(n=>n.id==='status').length,1);
 assert.deepEqual(exits.map(e=>e.labels),[['Pendant l’ouverture'],['En dehors des horaires']]);
 assert.notEqual(exits[0].path,exits[1].path);
 assert.notEqual(exits[0].labelY,exits[1].labelY);
 assert.deepEqual(flow,original);
 flow.edges[2].rawTarget=flow.edges[1].rawTarget;
 assert.equal(layoutJourney(flow).edges.filter(e=>e.from==='hours').length,2);
});

test('menu choices only merge when their parameters and announcements match',()=>{
 const flow={id:'entry',nodes:[node('entry','menu'),node('team','service')],edges:[
  edge('entry','team','OPTION1',{rawTarget:'team|pdata:first',audio:'tts:Un'}),
  edge('entry','team','OPTION2',{rawTarget:'team|pdata:second',audio:'tts:Deux'})
 ]};
 assert.equal(layoutJourney(flow).edges.length,2);
 flow.edges[1].rawTarget=flow.edges[0].rawTarget;
 assert.equal(layoutJourney(flow).edges.length,2);
 flow.edges[1].audio=flow.edges[0].audio;
 assert.equal(layoutJourney(flow).edges.length,1);
});
