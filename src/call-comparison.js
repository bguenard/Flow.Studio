import {startSimulation,simulationStep,advanceSimulation,automaticSimulationRoute,simulationReport} from './call-simulator.js';
import {businessFields} from './business.js';
import {fieldLabel} from './draft-fields.js';
export const callScenarios={
 crisis:{label:'Crise',icon:'shield',description:'Calendriers en urgence et attribut CRISE = ACTIF.'},
 closed:{label:'Agence fermée',icon:'clock',description:'Calendriers fermés et attribut CRISE = INACTIF.'},
 saturated:{label:'File saturée',icon:'people',description:'Première équipe indisponible : attente puis sortie configurée. Équipe de secours disponible.'},
};
const branch=r=>r.edge.branch||r.edge.field||r.id;
const phase=s=>s.waiting?'waiting':'routing';
const choiceKey=s=>s.nodeId+'|'+phase(s);
export function createCallComparison(before,after,{scenario='crisis',digit='1',context,now=()=>new Date().toISOString()}={}){
 if(!callScenarios[scenario])throw Error('Scénario inconnu.');
 const startedAt=now();
 return {id:globalThis.crypto.randomUUID(),startedAt,scenario,digit,context:context||{CRISE:scenario==='crisis'?'ACTIF':'INACTIF'},lanes:{before:before?startSimulation(before,{source:'live',now:()=>startedAt}):null,after:startSimulation(after,{source:'draft',now:()=>startedAt})},done:{before:!before,after:false},cursor:before?'before':'after',turn:0,playing:false,audioEnabled:true,audioError:'',choices:{},waitingStages:{before:{},after:{}},events:{before:[],after:[]}};
}
export function comparisonWaitingStage(c,side=c.cursor){
 const session=c.lanes[side],{node,waiting,routes}=simulationStep(session);if(!waiting)return null;
 const start=c.waitingStages[side][node.id]||1;
 for(let i=start;i<=4;i++)if(String(node.row['INQUEUE_AUDIO_'+i]||'').trim()||routes.some(r=>branch(r)==='INQUEUE_MENU_'+i))return i;
 return 5;
}
/** Only literal context supplied for this rehearsal is evaluated, never arbitrary expressions. */
export function evaluateScenarioDecision(row,context){
 const key=String(row.PARTICIPANT_DATA_TO_CHECK||''),op=row.DECISION_OPERATOR;
 const found=Object.keys(context).find(k=>k.toLowerCase()===key.toLowerCase());
 if(!found)return null;
 const value=String(context[found]??''),expected=String(row.DECISION_VALUE??'');
 if(op==='exist')return value!=='';
 if(op==='empty')return value==='';
 if(op==='==')return value===expected;
 if(op==='contains')return value.includes(expected);
 if(!value.trim()||!expected.trim()||!Number.isFinite(Number(value))||!Number.isFinite(Number(expected)))return null;
 return ({'>':()=>+value>+expected,'<':()=>+value<+expected,'>=':()=>+value>=+expected,'<=':()=>+value<=+expected}[op])?.()??null;
}
export function comparisonChoice(comparison,side=comparison.cursor){
 const session=comparison.lanes[side];if(!session||session.status!=='active')return {route:null,reason:session?.outcome||'Version absente'};
 const {node,routes,waiting}=simulationStep(session),pick=(r,reason,effect=false)=>({route:r||null,reason,effect});
 const saved=comparison.choices[choiceKey(session)];
 if(saved){const match=routes.find(r=>branch(r)===saved);if(match)return pick(match,'Même choix explicite dans les deux versions.');return pick(null,'Ce choix n’existe plus dans cette version. Choisissez sa suite.');}
 const auto=automaticSimulationRoute(session);if(auto)return pick(auto,'Suite configurée dans le parcours.');
 const byBranch=b=>routes.find(r=>branch(r)===b);
 if(node.type==='schedulegroup'){
  const b=comparison.scenario==='crisis'?'EMERGENCY':comparison.scenario==='closed'?'CLOSED':'OPEN';
  return pick(byBranch(b),`Hypothèse : calendrier ${b==='EMERGENCY'?'en urgence':b==='CLOSED'?'fermé':'ouvert'}.`,b!=='OPEN');
 }
 if(node.type==='decision'){
  const result=evaluateScenarioDecision(node.row,comparison.context);
  return result===null?pick(null,`Renseignez le contexte ou choisissez le résultat de « ${node.row.PARTICIPANT_DATA_TO_CHECK||'cette condition'} ».`):pick(byBranch(result?'TRUE':'FALSE'),`Contexte simulé : ${node.row.PARTICIPANT_DATA_TO_CHECK} ${node.row.DECISION_OPERATOR} ${node.row.DECISION_VALUE??''} → ${result?'vrai':'faux'}.`,/crise|crisis/i.test(node.row.PARTICIPANT_DATA_TO_CHECK||''));
 }
 if(node.type==='menu'){
  const digit=comparison.digit==='*'?'STAR':comparison.digit==='#'?'DIEZ':comparison.digit;
  return pick(byBranch('OPTION'+digit),`L’appelant compose la touche ${comparison.digit}.`);
 }
 if(node.type==='service'){
  const saturated=(comparison.events[side]||[]).find(e=>e.effect==='saturated');
  if(comparison.scenario==='saturated'&&!saturated){
   if(!waiting){const busy=routes.find(r=>['BUSY','BUSY_QUEUE'].includes(branch(r)));if(busy)return {...pick(busy,'Hypothèse : la première file est saturée.',true),effect:'saturated'};}
   if(waiting){const stage=comparisonWaitingStage(comparison,side);if(stage<5){const menu=byBranch('INQUEUE_MENU_'+stage);return {...pick(menu||{id:'sim:sequence:'+stage,internal:true,nextStage:stage+1,label:'Séquence d’attente '+stage},menu?'Menu configuré de la séquence d’attente '+stage+'.':'Fin de la séquence d’attente '+stage+'.'),nextStage:stage+1};}const exit=byBranch('INQUEUE');return {...pick(exit,'Hypothèse : aucune réponse pendant le cycle d’attente accéléré ; appliquer la sortie configurée.',true),effect:exit?'saturated':false};}
  }
  if(waiting)return pick(routes.find(r=>r.id==='sim:answered'),'Hypothèse : un conseiller répond.');
  return pick(byBranch('QUEUE'),'Entrée dans la file configurée.');
 }
 return pick(null,'Ce résultat nécessite un choix explicite pour cet essai.');
}
export const comparisonComplete=c=>c.done.before&&c.done.after;
export function advanceCallComparison(comparison,manualRouteId){
 if(comparisonComplete(comparison))return comparison;
 const next=structuredClone(comparison),side=next.cursor,session=next.lanes[side];
 if(session.status==='active'){
  const decision=comparisonChoice(next),route=manualRouteId?simulationStep(session).routes.find(r=>r.id===manualRouteId):decision.route;
  if(!route)throw Error('Choisissez une branche pour poursuivre cet appel.');
  if(manualRouteId)next.choices[choiceKey(session)]=branch(route);
  next.events[side].push({nodeId:session.nodeId,choice:route.label,reason:manualRouteId?'Choix explicite partagé avec l’autre version.':decision.reason,effect:manualRouteId?false:decision.effect||false});
  if(decision.nextStage&&!manualRouteId)next.waitingStages[side][session.nodeId]=decision.nextStage;
  if(route.internal){next.events[side].at(-1).internal=true;}
  else{next.lanes[side]=advanceSimulation(session,route.id);if(!session.waiting&&next.lanes[side].waiting)next.waitingStages[side][session.nodeId]=1;}
 }else next.done[side]=true;
 const other=side==='before'?'after':'before';
 if(!next.done[other])next.cursor=other;
 next.turn++;
 if(comparisonComplete(next))next.playing=false;
 return next;
}
export function comparisonDiff(comparison){
 const before=comparison.lanes.before?.flow,after=comparison.lanes.after.flow,changes=[];
 if(!before)return {changes,added:after.nodes.length,removed:0,messages:0,available:false};
 const old=new Map(before.nodes.map(n=>[n.id,n]));
 for(const n of after.nodes){const prev=old.get(n.id);if(!prev)continue;for(const k of new Set([...Object.keys(prev.row||{}),...Object.keys(n.row||{})]))if(JSON.stringify(prev.row[k])!==JSON.stringify(n.row[k]))changes.push({nodeId:n.id,key:k,label:fieldLabel(k),before:prev.row[k],after:n.row[k],audio:businessFields(n).some(f=>f.key===k&&f.kind==='audio')});}
 return {changes,added:after.nodes.filter(n=>!old.has(n.id)).length,removed:before.nodes.filter(n=>!after.nodes.some(a=>a.id===n.id)).length,messages:changes.filter(c=>c.audio).length,available:true};
}
export function callComparisonReport(c){return {format:'wolf-call-comparison/v1',executedInGenesys:false,startedAt:c.startedAt,scenario:c.scenario,assumptions:{...callScenarios[c.scenario],digit:c.digit,context:c.context,waiting:'Un cycle accéléré, sans musique ni reproduction des délais réels.',externalChecks:'Bots, Data Actions et contrôles externes non exécutés.'},complete:comparisonComplete(c),differences:comparisonDiff(c),before:c.lanes.before?simulationReport(c.lanes.before):null,after:simulationReport(c.lanes.after),decisions:c.events};}
