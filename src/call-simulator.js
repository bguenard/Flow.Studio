/** Guided rehearsal over actual V5 routes. No Genesys or Data Action execution. */
import { flowRoutes, businessFields, nodeTitle } from './business.js';
const typeOf=route=>String(route?.edge.type||'').toLowerCase().split('|')[0];
const synthetic=(id,label,toTitle)=>({id,label,toTitle,resolved:true,edge:{branch:id},simulated:true});
const stateOf=session=>({nodeId:session.nodeId,status:session.status,outcome:session.outcome,waiting:structuredClone(session.waiting||null),returns:structuredClone(session.returns||[])});
export function startSimulation(flow,{source='draft',now=()=>new Date().toISOString()}={}) {
 const entry=flow.nodes.find(n=>n.id===flow.id)||flow.nodes.find(n=>n.type==='inboundcall');
 if(!entry)throw Error('Ce parcours ne possède pas d’entrée simulable.');
 return {flow:structuredClone(flow),source,startedAt:now(),nodeId:entry.id,trail:[],status:'active',outcome:null,waiting:null,returns:[]};
}
export function simulationStep(session){
 const node=session.flow.nodes.find(n=>n.id===session.nodeId),all=flowRoutes(session.flow);
 const waiting=session.waiting?.nodeId===node?.id;
 let routes=all.filter(r=>r.fromId===node?.id&&r.relationship!=='context');
 if(waiting)routes=[synthetic('sim:answered','Un conseiller répond','Conversation avec un conseiller'),...routes.filter(r=>r.edge.branch!=='QUEUE'),synthetic('sim:abandon','L’appelant raccroche','Fin d’appel')];
 const messages=businessFields(node).filter(f=>f.kind==='audio'&&f.value!=null&&String(f.value).trim()&&(waiting?/^INQUEUE_(?:AUDIO_[1-4]|REPEAT_AUDIO|HOLD_MUSIC_(?:INIT|[1-4]))$/.test(f.key):(['WELCOME_AUDIO','MENU_AUDIO','ANNOUNCE_AUDIO','AUDIO'].includes(f.key)||['RECORDING_ANNOUNCE','RECORDING_ANNOUNCE_AUDIO'].includes(f.key)&&[true,'true','1',1].includes(node?.row.RECORDING_ENABLE)))).sort((a,b)=>a.key.localeCompare(b.key,'fr',{numeric:true}));
 return {node,routes,messages,title:nodeTitle(node),waiting,contexts:all.filter(r=>r.fromId===node?.id&&r.relationship==='context')};
}
export function automaticSimulationRoute(session){
 if(session.status!=='active')return null;
 const {node,routes,waiting}=simulationStep(session);
 if(waiting||['menu','decision','schedulegroup','ratiodistrib','bot','service','transfercallflow'].includes(node?.type))return null;
 const normal=routes.filter(r=>r.edge.branch!=='DEFAULT'&&r.edge.branch!=='BYPASS');
 if(normal.length!==1)return null;
 const route=normal[0];
 return route.resolved&&!route.dynamic&&!route.edge.conditional&&(route.edge.branch==='NEXT'||routes.length===1)?route:null;
}
/** A step without any outgoing route (a transfer to another flow, for instance) is where this call ends. */
function arrive(next){
 if(next.status!=='active'||next.waiting)return next;
 const step=simulationStep(next);
 if(step.node&&!step.routes.length){next.status='complete';next.outcome=step.title;}
 return next;
}
export function advanceSimulation(session,routeId){
 if(session.status!=='active')throw Error('Relancez la simulation pour poursuivre.');
 const {routes,node}=simulationStep(session),route=routes.find(r=>r.id===routeId);
 if(!route)throw Error('Ce choix n’appartient pas à l’étape courante.');
 const next=structuredClone(session),type=typeOf(route);
 const language=(route.edge.parameters||[]).map(parameter=>/^\s*lang:\s*(\S+)\s*$/i.exec(String(parameter))?.[1]).find(Boolean);
 next.trail.push({nodeId:node.id,title:nodeTitle(node),routeId:route.id,choice:route.label,destination:route.toTitle,field:route.edge.field,audio:route.edge.audio||null,...(language?{language}:{}),assumption:true,previous:stateOf(session)});
 if(route.simulated){next.status='complete';next.outcome=route.toTitle;}
 else if(type==='queue'&&node.type==='service'&&route.edge.branch==='QUEUE'&&(route.resolved||route.dynamic)){
  next.waiting={nodeId:node.id,queue:route.toTitle};
  next.trail.at(-1).destination='En attente · '+route.toTitle;
 }else if(type==='next'&&next.returns.length){
  const frame=next.returns.pop();next.nodeId=frame.nodeId;next.waiting=frame.waiting;
  next.trail.at(-1).destination='Retour à l’attente · '+nodeTitle(session.flow.nodes.find(n=>n.id===frame.nodeId));
 }else if(route.dynamic){next.status='boundary';next.outcome='Destination calculée pendant l’appel : choisissez une hypothèse pour poursuivre.';}
 else if(type==='callback'){next.status='complete';next.outcome='Rappel confié au flow de rappel WOLF (non simulé)';}
 else if(!route.resolved){next.status='blocked';next.outcome='Cette destination n’est pas résolue dans les Data Tables chargées.';}
 else if(route.toId&&session.flow.nodes.some(n=>n.id===route.toId)){
  if(node.type==='service'&&/^INQUEUE_(?:MENU_[1-4]|REPEAT_MENU)$/.test(route.edge.branch||''))next.returns.push({nodeId:node.id,waiting:session.waiting||{nodeId:node.id,queue:String(node.row.QUEUE||'File du parcours')}});
  if(session.flow.nodes.find(n=>n.id===route.toId)?.type==='service')next.returns=[];
  next.nodeId=route.toId;next.waiting=null;
 }else if(type==='next'){
  next.status='boundary';next.outcome='Cette étape rend la main au parcours appelant. Choisissez la suite à simuler.';
 }else if(route.terminal){next.status='complete';next.outcome=route.toTitle;}
 else{next.status='boundary';next.outcome='Cette étape nécessite un résultat de simulation pour poursuivre.';}
 if(next.trail.length>=80&&next.status==='active'){next.status='boundary';next.outcome='Limite de 80 transitions atteinte. Vérifiez la boucle de ce parcours.';}
 return arrive(next);
}
/** Explicitly selected hypothesis: never infer a dynamic result or change routing. */
export function resumeSimulation(session,nodeId){
 if(!['boundary','blocked'].includes(session.status)||session.trail.length>=80)throw Error('Cette simulation ne peut pas être reprise ici.');
 const node=session.flow.nodes.find(n=>n.id===nodeId&&n.type!=='pdata');
 if(!node)throw Error('Choisissez une étape de ce parcours.');
 const next=structuredClone(session);
 next.trail.push({nodeId:session.nodeId,title:'Hypothèse de simulation',choice:'Poursuivre vers une étape choisie',destination:nodeTitle(node),assumption:true,override:true,previous:stateOf(session)});
 next.nodeId=nodeId;next.status='active';next.outcome=null;next.waiting=null;next.returns=[];
 return arrive(next);
}
export function rewindSimulation(session){
 if(!session.trail.length)return session;
 const next=structuredClone(session),last=next.trail.pop();Object.assign(next,last.previous||{nodeId:last.nodeId,status:'active',outcome:null,waiting:null,returns:[]});return next;
}
export function simulationReport(session){return {format:'wolf-simulation/v1',executedInGenesys:false,mode:'guided',flowId:session.flow.id,flowName:session.flow.name,source:session.source,startedAt:session.startedAt,status:session.status,outcome:session.outcome,transitions:session.trail.map(({previous,...entry})=>entry)};}
export function journeyHealth(flow){
 const routes=flowRoutes(flow),unresolved=routes.filter(r=>!r.resolved&&!r.dynamic),dynamic=routes.filter(r=>r.dynamic);
 return {steps:flow.nodes.filter(n=>n.type!=='pdata').length,routes:routes.filter(r=>r.relationship!=='context').length,unresolved,dynamic,issues:flow.issues||[]};
}
