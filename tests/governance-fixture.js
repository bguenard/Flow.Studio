import assert from 'node:assert/strict';
import {createGenesysGovernanceClient,GOVERNANCE_TABLE_NAME} from '../src/genesys-governance.js';
import {normalizeRegistry} from '../src/governance.js';
export function registry(name='Référence Groupe',count=1){return normalizeRegistry({schemaVersion:1,coreModels:[{id:'group',name,versions:[{flowId:'inbound:group',label:'V1'}]}],declinations:Array.from({length:count},(_,i)=>({flowId:`inbound:entity-${i}`,coreModelId:'group',baseFlowId:'inbound:group',scope:'active',scopeNote:'',origin:'created',nodeMappings:[{referenceNodeId:'table:reference',localNodeId:`table:entity-${i}-😀`}]}))});}
export function harness({paginated=false}={}){
 const runtime={id:'wolf',name:'W_INBOUND_CALL_v5',rows:new Map([['entry',{key:'entry',DESCRIPTION:'Preserve me'}]])};
 const tables=[runtime],calls=[];let hook=null,org='org',flowDivisions=new Map([['inbound:group','G2S']]);
 const divisions=[{id:'g2s',name:'G2S'},{id:'gan',name:'Gan Assurances'},{id:'mut',name:'Mutuaide'}];
 const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
 const fetchImpl=async(url,options={})=>{
  const u=new URL(url),path=u.pathname,method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
  assert.equal(u.origin,'https://api.mypurecloud.ie');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
  const call={path,method,body,options,u};calls.push(call);const intercepted=await hook?.(call,response);if(intercepted)return intercepted;
  if(path==='/api/v2/users/me')return response({id:'operator',organization:{id:org}});
  if(path==='/api/v2/authorization/divisions')return response({entities:divisions,pageNumber:1,pageCount:1});
  if(path.startsWith('/api/v2/authorization/divisions/'))return response(divisions.find(d=>d.id===path.split('/').at(-1))||{},divisions.some(d=>d.id===path.split('/').at(-1))?200:404);
  if(path==='/api/v2/flows/datatables'){
   if(method==='GET')return response({entities:tables.map(({rows,...t})=>t),pageNumber:1,pageCount:1});
   assert.equal(method,'POST');assert.equal(body.name,GOVERNANCE_TABLE_NAME);assert.equal(body.schema.additionalProperties,false);
   const t={...structuredClone(body),id:'records',rows:new Map()};tables.push(t);return response({...body,id:t.id},201);
  }
  const m=path.match(/^\/api\/v2\/flows\/datatables\/([^/]+)(?:\/rows(?:\/(.+))?)?$/);assert.ok(m,`${method} ${path}`);
  const t=tables.find(t=>t.id===m[1]);if(!t)return response({},404);
  assert.equal(t.name,GOVERNANCE_TABLE_NAME,'Never access runtime row endpoints');
  if(!path.includes('/rows')){assert.equal(method,'GET');const {rows,...metadata}=t;return response(metadata);}
  const key=m[2]?decodeURIComponent(m[2]):null;
  if(method==='GET'){
   assert.equal(u.searchParams.get('showbrief'),'false');if(key)return t.rows.has(key)?response(t.rows.get(key)):response({},404);
   const all=[...t.rows.values()].sort((a,b)=>a.key.localeCompare(b.key)),page=Number(u.searchParams.get('pageNumber')),size=paginated?2:100;
   return response({entities:all.slice((page-1)*size,page*size),pageNumber:page,pageCount:Math.max(1,Math.ceil(all.length/size)),nextUri:'https://untrusted.invalid/no'});
  }
  if(method==='DELETE'){assert.ok(key==='write_lock'||key.startsWith('journal:'),'Only temporary operation rows may be deleted');t.rows.delete(key);return response(null,204);}
  assert.ok(['POST','PUT'].includes(method));if(method==='POST'&&t.rows.has(body.key))return response({},409);if(method==='PUT'&&!t.rows.has(key))return response({},404);
  assert.ok(!key||key===body.key);t.rows.set(body.key,structuredClone(body));return response(body,method==='POST'?201:200);
 };
 const client=()=>createGenesysGovernanceClient('test-token',{organizationId:'org',fetchImpl,getFlowDivisions:()=>flowDivisions});
 return {tables,runtime,calls,client,divisions,get table(){return tables.find(t=>t.id==='records');},get rows(){return this.table?.rows;},setHook:v=>hook=v,setOrganization:v=>org=v,setFlowDivisions:v=>flowDivisions=v,
  mutations:()=>calls.filter(c=>c.method!=='GET'),async seed(r=registry()){for(const m of r.coreModels)for(const v of m.versions)flowDivisions.set(v.flowId,'G2S');for(const d of r.declinations)flowDivisions.set(d.flowId,'Gan Assurances');const c=client();await c.initialize(r,'g2s');return c;}};
}
