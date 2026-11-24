import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagramModel,
  diagramLayout,
  prepareDiagram,
  journeyDiagram,
  onDiagramReady,
  CARD_WIDTH,
} from '../src/journey-diagram.js';

const node = (id, type, description = id) => ({
  id,
  type,
  key: id,
  label: type,
  row: { key: id, DESCRIPTION: description },
});
const edge = (from, to, branch, extra = {}) => ({
  from,
  to,
  branch,
  type: 'service',
  resolved: true,
  relationship: 'route',
  ...extra,
});
const agency = () => ({
  id: 'entry',
  nodes: [
    node('entry', 'inboundcall', 'Accueil'),
    node('hours', 'schedulegroup', 'Horaires agence'),
    node('menu', 'menu', 'Orienter'),
    node('claims', 'service', 'Sinistres'),
    node('contracts', 'service', 'Contrats'),
  ],
  edges: [
    edge('entry', 'hours', 'NEXT'),
    edge('hours', null, 'DEFAULT', { terminal: true, type: 'disconnect' }),
    edge('hours', null, 'CLOSED', { terminal: true, type: 'disconnect', audio: 'tts:Fermé' }),
    edge('hours', 'menu', 'OPEN'),
    edge('menu', 'contracts', 'OPTION2'),
    edge('menu', 'claims', 'OPTION1'),
    edge('contracts', 'menu', 'INQUEUE'),
    edge('claims', null, 'INQUEUE', { terminal: true, type: 'disconnect' }),
  ],
});
const exits = (model, id) => model.nodes.find((card) => card.id === id).exits;

test('each step is one card and its branches are its exits, in the order a call reads them', () => {
  const flow = agency(),
    original = structuredClone(flow),
    model = diagramModel(flow);
  assert.deepEqual(model.nodes.map((card) => card.id).sort(), [
    'claims',
    'contracts',
    'entry',
    'hours',
    'menu',
  ]);
  assert.deepEqual(
    exits(model, 'hours').map((exit) => exit.label),
    ['Pendant l’ouverture', 'En dehors des horaires', 'Sinon'],
  );
  assert.deepEqual(
    exits(model, 'menu').map((exit) => exit.label),
    ['Choix 1', 'Choix 2'],
  );
  assert.deepEqual(flow, original);
  assert.deepEqual(diagramModel(flow), model);
});

test('an exit that ends the call is written on its card, without a card or a link of its own', () => {
  const model = diagramModel(agency());
  assert.ok(model.nodes.every((card) => !card.terminal));
  const [open, closed] = exits(model, 'hours');
  assert.equal(open.to, 'menu');
  assert.equal(closed.to, '');
  assert.equal(closed.destination, 'Fin d’appel');
  assert.deepEqual(model.edges.map((link) => link.from + '>' + link.to).sort(), [
    'contracts>menu',
    'entry>hours',
    'hours>menu',
    'menu>claims',
    'menu>contracts',
  ]);
});

test('unresolved and dynamic destinations stay distinct and faithfully named on their exit', () => {
  const flow = {
    id: 'entry',
    nodes: [node('entry', 'inboundcall')],
    edges: [
      edge('entry', null, 'OPEN', {
        terminal: true,
        type: 'queue',
        target: 'Conseillers habitation',
      }),
      edge('entry', null, 'CLOSED', { type: 'queue', target: 'variable' }),
      edge('entry', null, 'DEFAULT', { resolved: false, target: 'missing' }),
    ],
  };
  const [open, closed, fallback] = exits(diagramModel(flow), 'entry');
  assert.equal(open.destination, 'Équipe · Conseillers habitation');
  assert.equal(closed.destination, 'Destination déterminée pendant l’appel');
  assert.equal(fallback.destination, 'Destination à vérifier');
  assert.deepEqual([open.unresolved, closed.unresolved, fallback.unresolved], [false, false, true]);
});

test('conditions sharing a destination share one exit; a card grows with its exits', () => {
  const flow = {
    id: 'entry',
    nodes: [node('entry', 'inboundcall'), node('menu', 'menu'), node('team', 'service')],
    edges: [
      edge('entry', 'menu', 'NEXT'),
      ...[0, 3, 4, 1, 2, 5, 6, 9, 7, 8].map((key) => edge('menu', 'team', `OPTION${key}`)),
    ],
  };
  const model = diagramModel(flow),
    menu = model.nodes.find((card) => card.id === 'menu');
  assert.deepEqual(
    menu.exits.map((exit) => exit.label),
    ['Choix 0 à 9'],
  );
  assert.equal(menu.exits[0].routes.length, 10);
  const wide = diagramModel(agency()).nodes.find((card) => card.id === 'hours'),
    narrow = diagramModel(agency()).nodes.find((card) => card.id === 'claims');
  assert.equal(wide.height - narrow.height, (wide.exits.length - narrow.exits.length) * 30);
  for (const card of [wide, narrow])
    card.exits.forEach((exit, index) =>
      assert.equal(exit.y, card.height - (card.exits.length - index) * 30 + 15),
    );
});

test('the main view folds queue properties and waiting menus; every link view shows them as exits', () => {
  const service = node('n1', 'service', 'Niveau 1');
  service.row.QUEUE = 'Q_N1';
  const flow = {
    id: 'entry',
    nodes: [node('entry', 'inboundcall'), service, node('wait', 'menu', 'Menu d’attente')],
    edges: [
      edge('entry', 'n1', 'NEXT'),
      edge('n1', null, 'QUEUE', {
        terminal: true,
        type: 'queue',
        target: 'Q_N1',
        derivedFrom: 'QUEUE',
      }),
      edge('n1', 'wait', 'INQUEUE_MENU_1', { field: 'INQUEUE_MENU_1' }),
    ],
  };
  const main = diagramModel(flow),
    all = diagramModel(flow, { allLinks: true });
  assert.deepEqual(
    main.nodes.map((card) => card.id),
    ['entry', 'n1'],
  );
  assert.ok(main.hiddenLinksCount >= 2);
  assert.equal(exits(main, 'n1').length, 0);
  assert.deepEqual(
    all.nodes.map((card) => card.id),
    ['entry', 'n1', 'wait'],
  );
  assert.equal(all.hiddenLinksCount, 0);
  assert.equal(exits(all, 'n1').length, 2);
});

test('ELK places the cards without overlap, and each link runs at right angles from its exit to the entry of its target', async () => {
  const flow = agency(),
    layout = await prepareDiagram(flow);
  assert.equal(layout.ready, true);
  const cards = layout.nodes;
  for (const card of cards) {
    assert.ok(card.x >= 0 && card.y >= 0);
    assert.ok(card.x + CARD_WIDTH <= layout.width && card.y + card.height <= layout.height);
  }
  for (const a of cards)
    for (const b of cards)
      if (a !== b)
        assert.ok(
          a.x + CARD_WIDTH <= b.x ||
            b.x + CARD_WIDTH <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          `${a.id} / ${b.id}`,
        );
  const at = Object.fromEntries(cards.map((card) => [card.id, card]));
  assert.ok(at.entry.x < at.hours.x && at.hours.x < at.menu.x && at.menu.x < at.claims.x);
  for (const link of layout.edges) {
    const from = at[link.from],
      to = at[link.to],
      exit = from.exits.find((item) => item.id === link.id);
    const [start, end] = [link.points[0], link.points.at(-1)];
    assert.ok(
      Math.abs(start[1] - (from.y + exit.y)) < 0.01 && start[0] === from.x + CARD_WIDTH,
      link.id,
    );
    assert.ok(Math.abs(end[1] - (to.y + 31)) < 0.01 && end[0] === to.x, link.id);
    for (let index = 1; index < link.points.length; index++)
      assert.ok(
        link.points[index][0] === link.points[index - 1][0] ||
          link.points[index][1] === link.points[index - 1][1],
        'segment oblique : ' + link.id,
      );
    assert.ok(link.path.startsWith('M ') && !link.path.includes('NaN'));
  }
  const loop = layout.edges.find((link) => link.from === 'contracts' && link.to === 'menu');
  assert.equal(loop.backedge, true);
  assert.equal(layout.edges.filter((link) => link.backedge).length, 1);
  assert.deepEqual(await prepareDiagram(flow), layout);
});

test('the first placement is asynchronous; it is then announced once and served from memory', async () => {
  const flow = agency();
  flow.nodes.push(node('extra', 'service', 'Renfort'));
  flow.edges.push(edge('claims', 'extra', 'NOT_BUSY'));
  const first = diagramLayout(flow);
  assert.equal(first.ready, false);
  assert.match(
    journeyDiagram(flow),
    /id="graph-viewport"[\s\S]*role="status"[^>]*>Mise en page du diagramme/,
  );
  let announced = 0;
  const stop = onDiagramReady(() => announced++);
  await new Promise((resolve) => {
    const off = onDiagramReady(() => {
      off();
      resolve();
    });
  });
  stop();
  assert.equal(announced, 1);
  const ready = diagramLayout(flow);
  assert.equal(ready.ready, true);
  assert.deepEqual(diagramLayout(flow), ready);
  // A change that keeps every card's size and links (a selection, a zoom) reuses the placement.
  assert.match(
    journeyDiagram(flow, { selectedIndex: 2, zoom: 0.8 }),
    /class="diagram-card selected"/,
  );
});

test('rendering opens steps by their original index, escapes names, and marks the selected step and its links', async () => {
  const team = node('team', 'service', 'Équipe <privilégiée>');
  team.row.QUEUE = 'QUEUE_HABITATION';
  const flow = {
    id: 'entry',
    nodes: [team, node('entry', 'inboundcall', 'Bienvenue'), node('ctx', 'pdata')],
    edges: [
      edge('entry', 'team', 'OPEN'),
      edge('entry', null, 'CLOSED', { terminal: true, type: 'disconnect' }),
      edge('team', 'ctx', '', { relationship: 'context' }),
    ],
  };
  await prepareDiagram(flow);
  const html = journeyDiagram(flow, { selectedIndex: 0, zoom: 0.75 });
  assert.ok(html.includes('data-action="select-node" data-node="0"'));
  assert.ok(html.includes('Équipe &lt;privilégiée&gt;') && !html.includes('<privilégiée>'));
  assert.ok(html.includes('Queue Habitation'));
  assert.ok(html.includes('1 information associée'));
  assert.ok(html.includes('&quot;scale&quot;:0.75'));
  assert.ok(!html.includes('style='));
  assert.equal(html.split('class="canvas-edge highlighted').length - 1, 1);
  assert.match(
    html,
    /<span class="diagram-exit"><span class="diagram-exit-label"[^>]*>Pendant l’ouverture<\/span><i class="diagram-port"><\/i><\/span>/,
  );
  assert.match(
    html,
    /<span class="diagram-exit inline"><span class="diagram-exit-label"[^>]*>En dehors des horaires<\/span><span class="diagram-exit-end"[^>]*>Fin d’appel<\/span><\/span>/,
  );
  assert.equal(html.split('<button type="button" class="diagram-card').length - 1, 2);
  // Nothing floats on the links any more.
  assert.doesNotMatch(html, /canvas-edge-label|<text/);
});

test('an empty journey and a self-returning step are drawn without error', async () => {
  const empty = await prepareDiagram({ id: '', nodes: [], edges: [] });
  assert.equal(empty.ready, true);
  assert.doesNotThrow(() => journeyDiagram({ id: '', nodes: [], edges: [] }));
  const flow = {
    id: 'entry',
    nodes: [node('entry', 'inboundcall'), node('team', 'service')],
    edges: [edge('entry', 'team', 'NEXT'), edge('team', 'team', 'INQUEUE')],
  };
  const layout = await prepareDiagram(flow);
  assert.equal(layout.edges.length, 2);
  assert.ok(layout.edges.every((link) => link.points.length >= 2 && !link.path.includes('NaN')));
});

test('administration shows the technical reference of a step next to its readable name', async () => {
  const decision = {
    ...node('decision', 'decision', 'CRISE==|ACTIF'),
    key: 'CHECK_CRISIS_V5',
    label: 'Règle d’orientation',
    tableName: 'W_DECISION_v5',
  };
  Object.assign(decision.row, {
    key: decision.key,
    DECISION_TYPE: 'expression',
    DECISION_TARGET: 'CRISE|==|ACTIF',
  });
  const flow = {
    id: 'entry',
    nodes: [node('entry', 'inboundcall', 'Bienvenue'), decision],
    edges: [
      edge('entry', 'decision', 'NEXT'),
      edge('decision', null, 'FALSE', { terminal: true, type: 'disconnect' }),
    ],
  };
  await prepareDiagram(flow);
  const html = journeyDiagram(flow);
  assert.ok(html.includes('Check Crisis'));
  assert.ok(html.includes('CHECK_CRISIS_V5'));
  assert.ok(html.includes('W_DECISION_v5'));
});

test('an exit whose branch and destination cannot share a line takes two, and the next exits move down with it', () => {
  const flow = {
    id: 'entry',
    nodes: [node('entry', 'inboundcall'), node('team', 'service')],
    edges: [
      edge('entry', null, 'OPEN', {
        terminal: true,
        type: 'queue',
        target: 'Conseillers habitation et protection juridique',
      }),
      edge('entry', 'team', 'DEFAULT'),
    ],
  };
  const card = diagramModel(flow).nodes[0],
    [long, short] = card.exits;
  assert.ok(long.height > short.height);
  assert.equal(short.height, 30);
  assert.equal(long.y, card.top + long.height / 2);
  assert.equal(short.y, card.top + long.height + 15);
  assert.equal(card.height, card.top + long.height + short.height);
});

test('steps that follow one another stay on one line instead of stepping down from exit to entry', async () => {
  const ids = ['entry', 'bot', 'closures', 'hours', 'qualification', 'team'];
  const flow = {
    id: 'entry',
    nodes: ids.map((id, index) =>
      node(id, index ? (index % 2 ? 'decision' : 'schedulegroup') : 'inboundcall', 'Étape ' + id),
    ),
    edges: ids
      .slice(0, -1)
      .flatMap((id, index) => [
        edge(id, ids[index + 1], 'NEXT'),
        edge(id, null, 'CLOSED', { terminal: true, type: 'disconnect' }),
        edge(id, null, 'EMERGENCY', { terminal: true, type: 'disconnect', audio: 'tts:Urgence' }),
      ]),
  };
  const layout = await prepareDiagram(flow),
    tops = layout.nodes.map((card) => card.y);
  assert.ok(
    Math.max(...tops) - Math.min(...tops) < 4,
    'cartes en escalier : ' + tops.map(Math.round).join(', '),
  );
  assert.ok(layout.height < 2 * Math.max(...layout.nodes.map((card) => card.height)));
  // Les liens partent toujours de la vraie sortie et arrivent à l'entrée de la carte suivante.
  const at = Object.fromEntries(layout.nodes.map((card) => [card.id, card]));
  for (const link of layout.edges) {
    const from = at[link.from],
      to = at[link.to],
      exit = from.exits.find((item) => item.id === link.id);
    assert.ok(
      Math.abs(link.points[0][1] - (from.y + exit.y)) < 0.01 &&
        Math.abs(link.points.at(-1)[1] - (to.y + 31)) < 0.01,
      link.id,
    );
    for (let index = 1; index < link.points.length; index++)
      assert.ok(
        link.points[index][0] === link.points[index - 1][0] ||
          link.points[index][1] === link.points[index - 1][1],
      );
  }
});
