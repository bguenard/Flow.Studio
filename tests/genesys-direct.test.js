import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFromGenesys, loadGenesysSnapshot, GENESYS_API_ORIGIN, isVoiceTableName } from '../src/genesys-direct.js';

const schema = { type: 'object', properties: { key: { type: 'string' }, DESCRIPTION: { type: 'string' }, PRIORITY: { type: 'integer' } } };
const ok = payload => ({ ok: true, status: 200, json: async () => structuredClone(payload) });
const failure = (status, retryAfter = null) => ({ ok: false, status, headers: { get: name => name === 'Retry-After' ? retryAfter : null } });
function mockApi(handler, calls = []) {
  return async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    assert.equal(parsed.origin, GENESYS_API_ORIGIN);
    assert.equal(options.method, 'GET');
    assert.equal(options.mode, 'cors');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return handler(parsed, options);
  };
}
const prefix = '/api/v2/flows/datatables';

test('Dublin loader filters W_ tables, preserves full rows/schema, and reports safe progress', async () => {
  const calls = [], progress = [];
  const token = 'private-user-token';
  const result = await loadFromGenesys(token, { onProgress: event => progress.push(event), fetchImpl: mockApi(url => {
    if (url.pathname === prefix) {
      assert.equal(url.searchParams.has('expand'), false);
      return ok({ entities: [{ id: 'wolf', name: 'W_SERVICES_v5', schema }, { id: 'unrelated', name: 'Finance_private', schema }], pageCount: 1, pageNumber: 1 });
    }
    assert.equal(url.pathname, prefix + '/wolf/rows');
    assert.equal(url.searchParams.get('showbrief'), 'false');
    return ok({ entities: [{ key: 'SERVICE_1', DESCRIPTION: 'Sinistres', PRIORITY: 3 }], pageCount: 1, pageNumber: 1 });
  }, calls) });
  assert.equal(result.tables.length, 1);
  assert.equal(result.tables[0].rows[0].PRIORITY, 3);
  assert.deepEqual(result.tables[0].schema, schema);
  assert.equal(result.source.region, 'eu-west-1');
  assert.equal(result.source.readOnly, true);
  assert.ok(Object.isFrozen(result.tables[0].rows[0]));
  assert.ok(calls.every(call => call.options.headers.Authorization === `Bearer ${token}`));
  assert.ok(calls.every(call => !call.url.href.includes(token)));
  assert.equal(JSON.stringify([result, progress]).includes(token), false);
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(loadGenesysSnapshot, loadFromGenesys);
});

test('voice registry reads V5 only, excluding V4 and messaging before schema and row requests', async () => {
  assert.equal(isVoiceTableName('W_INBOUND_CALL_v4'), false);
  assert.equal(isVoiceTableName('W_INBOUND_CALL_v5'), true);
  assert.equal(isVoiceTableName('W_SEND_SMS_VOICE_v4'), false);
  assert.equal(isVoiceTableName('W_CUST_DISTRIB_MESSAGE_Home_V1'), false);
  assert.equal(isVoiceTableName('w_menu_message_v1'), false);
  assert.equal(isVoiceTableName('Finance_private'), false);
  assert.equal(isVoiceTableName(null), false);
  const calls = [], progress = [];
  const metadata = [
    { id: 'voice4', name: 'W_INBOUND_CALL_v4' },
    { id: 'voice5', name: 'W_INBOUND_CALL_v5' },
    { id: 'message1', name: 'W_PARTICIPANT_DATA_MESSAGE_v1' },
    { id: 'message2', name: 'W_CUST_DISTRIB_MESSAGE_Home_V1' },
    { id: 'other', name: 'Other' },
  ];
  const result = await loadFromGenesys('token', { onProgress: event => progress.push(event), fetchImpl: mockApi(url => {
    if (url.pathname === prefix) {
      assert.equal(url.searchParams.has('expand'), false);
      return ok({ entities: metadata, pageCount: 1 });
    }
    const id = url.pathname.slice(prefix.length + 1).split('/')[0];
    assert.ok(['voice5'].includes(id), 'No request may read an excluded schema or its rows');
    if (url.pathname.endsWith('/rows')) return ok({ entities: [{ key: id }], pageCount: 1 });
    assert.equal(url.searchParams.get('expand'), 'schema');
    return ok({ ...metadata.find(table => table.id === id), schema });
  }, calls) });
  assert.deepEqual(result.tables.map(table => table.id), ['voice5']);
  assert.equal(result.source.media, 'voice');
  assert.equal(result.source.listedTables, 5);
  assert.equal(result.source.selectedVoiceTables, 1);
  assert.equal(result.source.excludedMessageTables, 2);
  assert.equal(calls.length, 3);
  assert.equal(progress.find(event => event.phase === 'selection').totalTables, 1);
});

test('other media fail explicitly before any Genesys request', async () => {
  await assert.rejects(loadFromGenesys('token', { media: 'message', fetchImpl: async () => assert.fail('No fetch for unsupported media') }), /Seul le média voix/);
});

test('loader requests missing schema explicitly and paginates tables and rows', async () => {
  const calls = [];
  const result = await loadFromGenesys('token', { fetchImpl: mockApi(url => {
    const page = Number(url.searchParams.get('pageNumber'));
    if (url.pathname === prefix) return ok({ entities: page === 1 ? [{ id: 'table1', name: 'W_SERVICES_v5' }] : [{ id: 'ignore', name: 'Other' }], pageNumber: page, pageCount: 2 });
    if (url.pathname === prefix + '/table1') {
      assert.equal(url.searchParams.get('expand'), 'schema');
      return ok({ id: 'table1', name: 'W_SERVICES_v5', schema });
    }
    return ok({ entities: [{ key: `service-${page}`, PRIORITY: page }], pageNumber: page, pageCount: 2 });
  }, calls) });
  assert.equal(calls.length, 5);
  assert.deepEqual(result.tables[0].rows.map(row => row.PRIORITY), [1, 2]);
});

test('403 stops without retries and does not disclose API response or token', async () => {
  let calls = 0;
  await assert.rejects(loadFromGenesys('hidden-token', { fetchImpl: async () => { calls++; return failure(403); } }), error => error.status === 403 && /scopes OAuth/.test(error.message) && !error.message.includes('hidden-token'));
  assert.equal(calls, 1);
});

test('429 respects Retry-After and succeeds after a bounded retry', async () => {
  let calls = 0;
  const sleeps = [];
  const result = await loadFromGenesys('token', {
    sleepImpl: async ms => sleeps.push(ms),
    fetchImpl: async () => { calls++; return calls === 1 ? failure(429, '2') : ok({ entities: [], pageCount: 1, pageNumber: 1 }); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(result.tables.length, 0);
});

test('retries stop after three attempts and excessive Retry-After is not shortened', async () => {
  let calls = 0;
  await assert.rejects(loadFromGenesys('token', { sleepImpl: async () => {}, fetchImpl: async () => { calls++; return failure(503); } }), /HTTP 503/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(loadFromGenesys('token', { sleepImpl: async () => assert.fail('should not sleep'), fetchImpl: async () => { calls++; return failure(429, '120'); } }), /Limite de lecture/);
  assert.equal(calls, 1);
});

test('external nextUri never receives the user token; sequential pages stay on Dublin origin', async () => {
  const calls = [];
  await loadFromGenesys('token', { fetchImpl: mockApi(url => {
    const page = Number(url.searchParams.get('pageNumber'));
    return page === 1 ? ok({ entities: [{ id: 'one', name: 'Other' }], nextUri: 'https://attacker.example/collect' }) : ok({ entities: [] });
  }, calls) });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url.origin === GENESYS_API_ORIGIN));
  assert.deepEqual(calls.map(call => call.url.searchParams.get('pageNumber')), ['1', '2']);
});

test('malformed schemas, inconsistent pages and duplicate tables fail rather than return partial source', async () => {
  await assert.rejects(loadFromGenesys('token', { fetchImpl: async () => ok({ entities: [], pageNumber: 3, pageCount: 3 }) }), /Pagination.*incohérente/);
  await assert.rejects(loadFromGenesys('token', { fetchImpl: mockApi(url => url.pathname === prefix ? ok({ entities: [{ id: 'one', name: 'W_SERVICES_v5' }], pageCount: 1 }) : ok({ id: 'one', name: 'W_SERVICES_v5' })) }), /schéma/);
  const same = { id: 'same', name: 'W_SERVICES_v5', schema };
  await assert.rejects(loadFromGenesys('token', { fetchImpl: mockApi(url => url.pathname === prefix ? ok({ entities: [same, same], pageCount: 1 }) : ok({ entities: [], pageCount: 1 })) }), /dupliqué/);
});

test('network failures are sanitized and cancelled loads never continue', async () => {
  await assert.rejects(loadFromGenesys('token', { fetchImpl: async () => { throw new Error('request headers Authorization: Bearer token'); } }), error => /Connexion.*impossible/.test(error.message) && !error.message.includes('Bearer'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadFromGenesys('token', { signal: controller.signal, fetchImpl: async () => assert.fail('no fetch expected') }), { name: 'AbortError' });
  await assert.rejects(loadFromGenesys('', { fetchImpl: async () => assert.fail('no fetch expected') }), /Connectez-vous/);
});

test('entry catalogue is released before other V5 reads; background work is bounded and preserves table order', async()=>{
 const metadata=[{id:'menu',name:'W_MENU_v5',schema},{id:'entry',name:'W_INBOUND_CALL_V5',schema},{id:'service',name:'W_SERVICES_v5',schema},{id:'decision',name:'W_DECISION_v5',schema},{id:'schedule',name:'W_SCHEDULE_GROUP_v5',schema}];
 const started=[],releases=[];let active=0,peak=0,partial;
 let catalogueReleased;const ready=new Promise(resolve=>catalogueReleased=resolve);
 const result=loadFromGenesys('token',{concurrency:3,onCatalogue:async snapshot=>{
  partial=snapshot;assert.deepEqual(started,['entry']);assert.equal(snapshot.source.partial,true);assert.deepEqual(snapshot.tables.map(t=>t.id),['entry']);
  catalogueReleased();
 },fetchImpl:mockApi(async url=>{
  if(url.pathname===prefix)return ok({entities:metadata,pageCount:1,pageNumber:1});
  const id=url.pathname.split('/').at(-2);started.push(id);
  if(id!=='entry'){active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(()=>{active--;resolve();}));}
  return ok({entities:[{key:id}],pageCount:1,pageNumber:1});
 })});
 await ready;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(partial.tables.length,1);assert.equal(active,3);assert.equal(started.length,4);
 releases.splice(0).forEach(release=>release());await new Promise(resolve=>setImmediate(resolve));
 releases.splice(0).forEach(release=>release());
 const full=await result;assert.equal(peak,3);assert.equal(full.source.partial,false);
 assert.deepEqual(full.tables.map(t=>t.id),metadata.map(t=>t.id));assert.equal(partial.tables.length,1);
});

test('cancelling at the catalogue boundary does not start background requests',async()=>{
 const controller=new AbortController(),calls=[];
 await assert.rejects(loadFromGenesys('token',{signal:controller.signal,onCatalogue:()=>controller.abort(),fetchImpl:mockApi(url=>{
  if(url.pathname===prefix)return ok({entities:[{id:'entry',name:'W_INBOUND_CALL_v5',schema},{id:'menu',name:'W_MENU_v5',schema}],pageCount:1,pageNumber:1});
  return ok({entities:[],pageCount:1,pageNumber:1});
 },calls)}),{name:'AbortError'});
 assert.equal(calls.some(c=>c.url.pathname.includes('/menu')),false);
});

test('background failure rejects without reporting a complete snapshot',async()=>{
 let partial;const progress=[];
 await assert.rejects(loadFromGenesys('token',{concurrency:3,onCatalogue:s=>partial=s,onProgress:p=>progress.push(p),fetchImpl:mockApi(url=>{
  if(url.pathname===prefix)return ok({entities:[{id:'entry',name:'W_INBOUND_CALL_v5',schema},{id:'menu',name:'W_MENU_v5',schema}],pageCount:1,pageNumber:1});
  if(url.pathname.includes('/menu/'))return failure(403);
  return ok({entities:[{key:'123'}],pageCount:1,pageNumber:1});
 })}),{status:403});
 assert.equal(partial.source.partial,true);assert.equal(progress.some(p=>p.phase==='complete'),false);
});

test('a source without inbound entries still loads fully without publishing a partial catalogue',async()=>{
 let called=false;
 const result=await loadFromGenesys('token',{onCatalogue:()=>called=true,fetchImpl:mockApi(url=>url.pathname===prefix?ok({entities:[{id:'menu',name:'W_MENU_v5',schema}],pageCount:1,pageNumber:1}):ok({entities:[],pageCount:1,pageNumber:1}))});
 assert.equal(called,false);assert.equal(result.source.partial,false);assert.equal(result.tables.length,1);
});
