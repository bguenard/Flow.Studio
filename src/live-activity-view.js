import {esc,icon,btn} from './ui-kit.js';
import {layoutJourney} from './journey-canvas.js';
import {flowTitle} from './business.js';
import {queueForActivityNode} from './live-activity.js';
const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const number=value=>known(value)?new Intl.NumberFormat('fr-FR').format(value):'—';
const time=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(date):'';};
const duration=value=>known(value)?`${Math.round(value/1000)} s`:'—';
export function liveActivityToggle(enabled=false){return btn(icon('chart')+(enabled?' Masquer l’activité':' Activité sur le parcours'),'live-activity-toggle',enabled?'primary small':'secondary small',`aria-pressed="${enabled}"`);}

function nodeMeasures(node,flow,data){
 if(node?.id===flow.id||node?.type==='inboundcall'){
  // Only the actual entry receives the DNIS aggregate, not subsequent inbound references.
  if(node?.id!==flow.id)return '<p class="live-map-unmeasured">Pas de mesure propre à cette étape</p>';
  const metrics=data?.history?.status==='ready'?data.history.metrics:null;
  return `<div class="live-map-values"><span><strong>${number(metrics?.connected)}</strong><small>connexions aujourd’hui</small></span><span><strong>${duration(metrics?.averageWaitMs)}</strong><small>attente avant réponse</small></span></div><p class="live-map-scope">Périmètre : numéro appelé</p>`;
 }
 if(['service','distribution'].includes(node?.type)){
  const queue=queueForActivityNode(node,data);
  return `<div class="live-map-values"><span class="${known(queue?.waiting)&&queue.waiting>0?'live-map-waiting':''}"><strong>${number(queue?.waiting)}</strong><small>appels en attente</small></span><span><strong>${number(queue?.interacting)}</strong><small>en conversation</small></span></div><p class="live-map-scope">${queue?`${number(queue.onQueue)} ${Number(queue.onQueue)>1?'agents':'agent'} en file · ${number(queue.available)} sans interaction`:'File non résolue ou mesure indisponible'}</p>`;
 }
 return '<p class="live-map-unmeasured">Pas de mesure propre à cette étape</p>';
}
export function liveActivityView(state={}){
 if(!state.enabled)return '';
 const {flow,data,loading,error}=state;
 const history=data?.history,live=data?.live,queues=live?.status==='ready'?live.queues:[];
 const waiting=queues.length&&queues.every(q=>known(q.waiting))?queues.reduce((sum,q)=>sum+q.waiting,0):null;
 const stale=Boolean(error)||!state.visible;
 const summary=`<div class="live-map-kpis"><article><span>Ce numéro · aujourd’hui</span><strong>${number(history?.status==='ready'?history.metrics.connected:null)}</strong><small>connexions voix</small></article><article><span>Files observées</span><strong>${queues.length?number(queues.length):'—'}</strong><small>mesures globales des files</small></article><article><span>Attentes dans ces files</span><strong>${number(waiting)}</strong><small>tous numéros confondus</small></article></div>`;
 const errors=[error,history?.status==='error'?history.error:'',live?.status==='error'?live.error:''].filter(Boolean);
 const issues=[...new Set([...(data?.scopeWarnings||[]),...errors])];
 let map='';
 if(flow){const layout=layoutJourney(flow),scale=.9;
  map=`<div class="live-map-viewport" id="live-map-viewport" role="region" aria-label="Activité sur le parcours chargé depuis Genesys" tabindex="0"><div class="live-map-space" style="width:${layout.width*scale}px;height:${layout.height*scale}px"><div class="live-map-surface" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${scale})"><svg width="${layout.width}" height="${layout.height}" aria-hidden="true"><defs><marker id="live-map-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#a7b3be"/></marker></defs>${layout.edges.map(edge=>`<path d="${edge.path}" marker-end="url(#live-map-arrow)"/><text x="${edge.labelX}" y="${edge.labelY-8}" text-anchor="middle">${esc(edge.label)}</text>`).join('')}</svg>${layout.nodes.map(item=>{const node=flow.nodes.find(n=>n.id===item.id),queue=queueForActivityNode(node,data);return `<article class="live-map-node ${item.entry?'is-entry':''} ${known(queue?.waiting)&&queue.waiting>0?'has-waiting':''}" data-activity-node="${esc(item.id)}" style="left:${item.x}px;top:${item.y}px;width:${item.width}px;height:${item.height}px"><div class="live-map-node-type">${icon(item.icon)}<span>${esc(item.typeLabel)}</span>${known(queue?.waiting)&&queue.waiting>0?'<b>En attente</b>':''}</div><h3 title="${esc(item.title)}">${esc(item.title)}</h3>${nodeMeasures(node,flow,data)}${queue?`<span class="live-map-queue-label" title="${esc(queue.name)}">${esc(queue.name)} · toute la file</span>`:''}</article>`;}).join('')}</div></div></div>`;
 }
 return `<section class="live-activity-map" aria-label="Carte d’activité Genesys"><header class="live-map-heading"><div><div class="eyebrow"><span class="live-map-dot ${stale?'is-stale':''}"></span> GENESYS · ACTIVITÉ DU PARCOURS</div><h2>${esc(flow?flowTitle(flow):'Activité indisponible')}</h2><p>Version chargée depuis Genesys · les brouillons ne changent pas le périmètre mesuré.</p></div><div>${btn(icon('undo')+' Actualiser','live-activity-refresh','secondary small',loading||!flow?'disabled':'')}${btn('Masquer','live-activity-toggle','quiet small')}</div></header><div class="live-map-update" role="status">${loading?'Lecture des mesures Genesys…':!state.visible?'Actualisation en pause':data?`Dernière lecture à ${esc(time(data.updatedAt))}${stale?' · données conservées':state.nextRefreshAt?' · actualisation toutes les 30 secondes':''}`:errors.length?'Lecture indisponible':'En attente des premières mesures'}</div>${summary}${issues.length?`<details class="live-map-issues" ${errors.length?'open':''}><summary>${errors.length?'Certaines mesures sont indisponibles':'Périmètre des mesures'}</summary>${issues.map(message=>`<p>${esc(message)}</p>`).join('')}</details>`:''}${map}<footer><strong>Lire la carte</strong><span>À l’accueil : statistiques du numéro aujourd’hui. Sur les distributions : activité globale de leur file, partagée avec d’autres parcours. Une même file peut apparaître sur plusieurs étapes ; ses mesures ne s’additionnent pas. Les autres étapes n’ont pas de compteur attribuable avec ces API.</span></footer></section>`;
}
