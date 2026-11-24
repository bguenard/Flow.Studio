import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowInitializationClient } from '../src/genesys-flow-initialization.js';
import {
  flowInitializationDefinition,
  FLOW_INITIALIZATION,
  createFlowInitializationRow,
} from '../src/flow-initialization.js';
import {
  participantCatalogueDefinition,
  participantDefinition,
  validateParticipantDefinitionChange,
} from '../src/participant-catalogue.js';
import { flowDataModel, prepareFlowData } from '../src/flow-data.js';
import { publicationRows } from '../src/publication.js';
import { publicationPreflight } from '../src/publication-preflight.js';
const schema = (names) => ({
  type: 'object',
  properties: Object.fromEntries(names.map((n) => [n, { type: 'string' }])),
});
function fixture() {
  return {
    source: { flowInitializationRequired: true },
    tables: [
      {
        id: 'i',
        name: 'W_INBOUND_CALL_v5',
        schema: schema(['key', 'DESCRIPTION', 'DIVISION', 'NEXT_TARGET_TYPE', 'NEXT_TARGET']),
        rows: [
          {
            key: '+33123456789',
            DESCRIPTION: 'Accueil',
            DIVISION: 'G2S',
            NEXT_TARGET_TYPE: 'disconnect',
            NEXT_TARGET: '|pdata:ACTIVATION',
          },
        ],
      },
      {
        id: 'p',
        name: 'W_PARTICIPANT_DATA_v5',
        schema: schema(['key', 'PDATA_LIST_1']),
        rows: [
          { key: 'ACTIVATION', PDATA_LIST_1: 'ACTIVE==true' },
          { key: 'MOTIF', PDATA_LIST_1: 'MOTIF==conseil' },
        ],
      },
      {
        id: 'c',
        ...participantCatalogueDefinition('g'),
        rows: [participantDefinition('ACTIVE', 'true', { id: 'g', name: 'G2S' })],
      },
      { id: 'init', ...flowInitializationDefinition('g'), rows: [] },
    ],
  };
}
function harness({ missing = false } = {}) {
  const data = fixture();
  if (missing) data.tables.pop();
  const calls = [];
  let fail = false;
  const ok = (value) => ({ ok: true, status: 200, json: async () => structuredClone(value) });
  const fetchImpl = async (url, opt) => {
    const path = new URL(url).pathname.replace('/api/v2', ''),
      body = opt.body ? JSON.parse(opt.body) : null;
    calls.push({ path, method: opt.method, body });
    if (path === '/users/me') return ok({ id: 'u', organization: { id: 'org' } });
    if (path === '/authorization/divisions/g') return ok({ id: 'g', name: 'G2S' });
    if (path === '/flows/datatables') {
      if (opt.method === 'POST') {
        const t = { id: 'init', ...body, rows: [] };
        data.tables.push(t);
        return ok(t);
      }
      return ok({ pageNumber: 1, pageCount: 1, entities: data.tables.map(({ rows, ...t }) => t) });
    }
    const match = /^\/flows\/datatables\/([^/]+)(?:\/rows(?:\/(.+))?)?$/.exec(path);
    assert.ok(match, path);
    const table = data.tables.find((t) => t.id === match[1]);
    assert.ok(table);
    if (!path.includes('/rows')) {
      const { rows, ...meta } = table;
      return ok(meta);
    }
    if (opt.method === 'POST') {
      if (fail) throw Error('network');
      assert.ok(!table.rows.some((r) => r.key === body.key));
      table.rows.push(body);
      return ok(body);
    }
    if (match[2]) return ok(table.rows.find((r) => r.key === decodeURIComponent(match[2])));
    return ok({ pageCount: 1, entities: table.rows });
  };
  return {
    data,
    calls,
    client: createFlowInitializationClient('test', { organizationId: 'org', fetchImpl }),
    set fail(v) {
      fail = v;
    },
  };
}
test('dedicated table creates once and reads only its own rows', async () => {
  const h = harness({ missing: true }),
    before = structuredClone(h.data.tables);
  assert.equal((await h.client.load()).status, 'missing');
  const result = await h.client.initialize('g');
  assert.equal(result.status, 'ready');
  assert.deepEqual(h.data.tables.slice(0, 3), before);
  assert.deepEqual(
    h.calls.filter((c) => c.method !== 'GET').map((c) => c.path),
    ['/flows/datatables'],
  );
  await assert.rejects(h.client.initialize('g'), /existe déjà/);
  assert.ok(!h.calls.some((c) => /datatables\/(?:i|p|c)(?:\/|$)/.test(c.path)));
});
test('foreign schema and invalid stored values are rejected without writes', async () => {
  const h = harness();
  h.data.tables[3].description = 'Other table';
  await assert.rejects(h.client.load(), /incompatible/);
  const h2 = harness();
  h2.data.tables[3].rows.push({
    key: '+33123456789',
    ATTRIBUTE_01_NAME: 'ACTIVE',
    ATTRIBUTE_01_TYPE: 'bool',
    ATTRIBUTE_01_VALUE: 'maybe',
  });
  await assert.rejects(h2.client.load());
  assert.ok([...h.calls, ...h2.calls].every((c) => c.method === 'GET'));
});
test('an uncertain table creation is not automatically retried', async () => {
  let posts = 0;
  const client = createFlowInitializationClient('test', {
    organizationId: 'org',
    fetchImpl: async (url, opt) => {
      const path = new URL(url).pathname;
      if (opt.method === 'POST') {
        posts++;
        throw Error('network');
      }
      const value = path.endsWith('/users/me')
        ? { id: 'u', organization: { id: 'org' } }
        : path.endsWith('/divisions/g')
          ? { id: 'g' }
          : { pageCount: 1, entities: [] };
      return { ok: true, status: 200, json: async () => value };
    },
  });
  await assert.rejects(client.initialize('g'), (e) => e.uncertain);
  assert.equal(posts, 1);
});
test('entry editor changes dedicated row only, not WOLF refs or branch context', () => {
  const s = fixture();
  s.tables[3].rows.push(
    createFlowInitializationRow(
      {
        key: s.tables[0].rows[0].key,
        description: 'Accueil',
        division: 'G2S',
        attributes: [{ name: 'ACTIVE', value: 'true' }],
      },
      s,
    ),
  );
  const before = structuredClone(s);
  const m = flowDataModel(s, 'i:+33123456789');
  assert.ok(m.dedicated);
  const plan = prepareFlowData({
    snapshot: s,
    flowId: m.flowId,
    signature: m.signature,
    values: { 'slot:1': 'false' },
  });
  assert.equal(plan.updatedRows.length, 1);
  assert.equal(plan.updatedRows[0].node.tableId, 'init');
  assert.equal(plan.updatedRows[0].row.ATTRIBUTE_01_VALUE, 'false');
  assert.deepEqual(s, before);
  const row = plan.updatedRows[0],
    drafts = new Map([[row.node.id, { original: row.node.row, row: row.row }]]),
    entries = publicationRows(s, drafts);
  assert.equal(entries[0].catalogueValidation, true);
  const preflight = publicationPreflight({ snapshot: s, rows: entries });
  assert.equal(preflight.impacted[0].number, '+33123456789');
  assert.equal(preflight.unknownScope.length, 0);
});
test('a new numbered row is created without copying legacy groups; missing table blocks old writer', () => {
  const s = fixture(),
    before = structuredClone(s),
    m = flowDataModel(s, 'i:+33123456789');
  const plan = prepareFlowData({
    snapshot: s,
    flowId: m.flowId,
    signature: m.signature,
    additions: [{ name: 'ACTIVE', value: 'false' }],
  });
  assert.equal(plan.createdRows.length, 1);
  assert.equal(plan.createdRows[0].tableId, 'init');
  assert.equal(plan.createdRows[0].row.ATTRIBUTE_01_VALUE, 'false');
  assert.equal(plan.updatedRows.length, 0);
  assert.deepEqual(s, before);
  s.tables.pop();
  const legacy = flowDataModel(s, 'i:+33123456789');
  assert.throws(
    () => prepareFlowData({ snapshot: s, flowId: legacy.flowId, signature: legacy.signature }),
    /table dédiée/,
  );
});
test('used dedicated type is protected against incompatible catalogue changes', () => {
  const s = fixture(),
    def = s.tables[2].rows[0];
  s.tables[3].rows.push(
    createFlowInitializationRow(
      { key: '+33123456789', attributes: [{ name: 'ACTIVE', value: 'true' }] },
      s,
    ),
  );
  assert.throws(
    () => validateParticipantDefinitionChange(def, { ...def, VALUE_TYPE: 'text' }, s),
    /type est déjà utilisé/,
  );
});
