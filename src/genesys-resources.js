/** GET-only catalogues. WOLF references use names, not the API object's id. */
import { GENESYS_API_ORIGIN } from './genesys-direct.js';

export const resourceCatalogues = {
  divisions: { path: '/authorization/divisions', permission: 'authorization:division:view' },
  queues: { path: '/routing/queues', permission: 'routing:queue:view' },
  schedules: { path: '/architect/schedulegroups', permission: 'routing:scheduleGroup:view' },
  emergencies: { path: '/architect/emergencygroups', permission: 'routing:emergencyGroup:view' },
  skills: { path: '/routing/skills', permission: 'routing:skill:view' },
  languages: { path: '/routing/languages', permission: 'lecture des langues de routage' },
  users: { path: '/users', permission: 'directory:user:view', query: { state: 'active' } },
  prompts: { path: '/architect/prompts', permission: 'architect:userPrompt:view' },
  flows: { path: '/flows', permission: 'architect:flow:view', query: { type: 'inboundcall', deleted: 'false' } },
  bots: { path: '/flows', permission: 'architect:flow:view', query: { type:'bot', deleted:'false' } },
  scripts: { path: '/scripts/published', permission: 'scripter:publishedScript:view' },
};
const audioKey = key => /(?:^|_)AUDIO(?:_[1-4])?$/.test(key) || ['RECORDING_ANNOUNCE','AUDIO_RECORDING'].includes(key);

/** Only fields whose V5 lookup contract is known; row identities are never renamed. */
export function resourceForField(key, node) {
  if (!/_v5$/i.test(node?.tableName || '')) return null;
  const name = key.toUpperCase();
  const types = { DIVISION:'divisions', QUEUE:'queues', CALLBACK_QUEUE:'queues', SCHEDULE_GROUP:'schedules', SCHEDULEGROUP_FOR_CALLBACK:'schedules', EMERGENCY_GROUP:'emergencies', SKILLS:'skills', LANGUAGE_SKILL:'languages', DIRECT_USER:'users', FLOW_NAME:'flows', SCRIPT:'scripts', ID_BOT:'bots' };
  if (audioKey(name)) return { catalogue:'prompts', audio:true };
  if (/^INQUEUE_HOLD_MUSIC_(INIT|[1-4])$/.test(name)) return { catalogue:'prompts' };
  if (!types[name]) return null;
  return { catalogue:types[name], multiple:name==='SKILLS', external:name==='ID_BOT' };
}

export async function loadResourceCatalogue(kind, token, { fetchImpl = globalThis.fetch, signal } = {}) {
  const spec = resourceCatalogues[kind];
  if (!spec) throw Error('Catalogue Genesys inconnu.');
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw Error('Connectez-vous à Genesys pour choisir une ressource.');
  const entities = [], ids = new Set();
  for (let pageNumber=1; pageNumber<=1000; pageNumber++) {
    const url = new URL(`${GENESYS_API_ORIGIN}/api/v2${spec.path}`);
    url.search = new URLSearchParams({ ...spec.query, pageSize:100, pageNumber });
    const controller = new AbortController(), cancel=()=>controller.abort();
    if (signal?.aborted) throw Error('Lecture annulée.');
    signal?.addEventListener('abort',cancel,{once:true});
    const timeout=setTimeout(cancel,20000);
    let response, payload;
    try {
      try { response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json',Authorization:`Bearer ${token}`},credentials:'omit',mode:'cors',redirect:'error',cache:'no-store',signal:controller.signal}); }
      catch { throw Error(signal?.aborted?'Lecture annulée.':'Catalogue Genesys injoignable. Vérifiez le réseau, puis rechargez la liste.'); }
      if (!response.ok) throw Object.assign(Error(response.status===401?'Session Genesys expirée. Reconnectez-vous.':response.status===403?`Accès refusé : permission ${spec.permission} et scope OAuth de lecture requis.`:response.status===429?'Limite Genesys atteinte. Réessayez dans quelques instants.':`Catalogue Genesys indisponible (HTTP ${response.status}).`),{status:response.status});
      payload=await response.json();
    } finally { clearTimeout(timeout);signal?.removeEventListener('abort',cancel); }
    if (!Array.isArray(payload?.entities)) throw Error('Catalogue Genesys invalide.');
    if (payload.pageNumber!=null && Number(payload.pageNumber)!==pageNumber) throw Error('Pagination Genesys incohérente.');
    for (const item of payload.entities) {
      if (typeof item.id!=='string'||!item.id||typeof item.name!=='string'||!item.name) throw Error('Ressource Genesys sans identité exploitable.');
      if (ids.has(item.id)) throw Error('Catalogue modifié pendant la lecture. Actualisez la liste.');
      ids.add(item.id);
      entities.push({id:item.id,name:item.name,email:item.email||'',division:item.division?.name||'',published:Boolean(item.publishedVersion)});
    }
    let done;
    if (payload.pageCount!=null) {
      const count=Number(payload.pageCount);
      if (!Number.isInteger(count)||count<0||count>1000) throw Error('Pagination Genesys invalide.');
      done=pageNumber>=count;
    } else if (payload.total!=null) {
      if (!Number.isInteger(payload.total)||payload.total<0) throw Error('Total Genesys invalide.');
      done=entities.length>=payload.total;
    } else done=!payload.nextUri && payload.entities.length<100;
    if (done) return entities.sort((a,b)=>a.name.localeCompare(b.name,'fr',{numeric:true,sensitivity:'base'}));
    if (!payload.entities.length) throw Error('Catalogue Genesys incomplet.');
    // Do not follow a server-supplied nextUri with the OAuth token.
  }
  throw Error('Catalogue Genesys trop volumineux.');
}

export function resourceOptions(field, node, entities = []) {
  const spec=resourceForField(field.key,node);
  if (!spec) return [];
  const counts=new Map();
  for (const item of entities) counts.set(item.name,(counts.get(item.name)||0)+1);
  return entities.filter(item=>!['flows','bots'].includes(spec.catalogue)||item.published).map(item=>({
    value:spec.catalogue==='bots'?item.id:spec.audio?`pr:${item.name}`:item.name,
    label:[item.name,item.email,item.division].filter(Boolean).join(' · '),
    // Name-based WOLF lookup must not silently select one of two homonyms.
    disabled:spec.catalogue!=='bots' && (counts.get(item.name)>1 || /[|;]/.test(item.name) || /\$?var:/i.test(item.name)),
  }));
}

export function validateResourceChoice(field,node,value,catalogues) {
  if (typeof value!=='string') throw Error('Sélection de ressource invalide.');
  if (value===String(field.value??'')) return value;
  const spec=resourceForField(field.key,node);
  if (!spec) throw Error('Ce champ ne correspond pas à une ressource modifiable.');
  if (value==='') return value;
  const options=resourceOptions(field,node,catalogues?.[spec.catalogue]);
  const values=spec.multiple?value.split(';'):[value];
  if (spec.multiple && (values.length>6||new Set(values).size!==values.length)) throw Error('Choisissez au maximum six compétences distinctes.');
  if (values.some(item=>!options.some(option=>!option.disabled&&option.value===item))) throw Error('Choisissez une ressource disponible dans la liste Genesys.');
  return value;
}
