import { flowRoutes,nodeTitle } from './business.js';
import { coerceRowValue } from './draft-fields.js';
import { esc,icon,btn,tag,head } from './ui-kit.js';
export function inspectJourney(flow,snapshot){
 const findings=[],routes=flowRoutes(flow),nodes=new Map(flow.nodes.map(n=>[n.id,n]));
 for(const route of routes){
  if(route.dynamic)findings.push({level:'info',nodeId:route.fromId,title:'Destination calculée pendant l’appel',detail:`${route.label} · ${route.toTitle}`,field:route.edge.field});
  else if(!route.resolved&&String(route.edge.type||'').toLowerCase().split('|')[0]==='callback'&&snapshot?.tables?.some(t=>/^W_CALLBACK_v5$/i.test(t.name)&&t.rows.some(r=>String(r.key)===String(route.edge.target))))findings.push({level:'warning',tag:'Externe',nodeId:route.fromId,title:'Rappel confié au flow de rappel WOLF',detail:`${route.label} · ${route.edge.target||'Valeur vide'} · non vérifiable dans cette source`,field:route.edge.field});
  else if(!route.resolved)findings.push({level:'error',nodeId:route.fromId,title:'Destination introuvable',detail:`${route.label} · ${route.edge.target||'Valeur vide'}`,field:route.edge.field});
 }
 for(const node of nodes.values()){
  const table=snapshot.tables.find(t=>t.id===node.tableId),properties=table?.schema?.properties;
  if(!properties){findings.push({level:'warning',nodeId:node.id,title:'Schéma non disponible',detail:'Les types et contraintes ne peuvent pas être contrôlés.'});continue;}
  for(const [key,value] of Object.entries(node.row))if(properties[key]){
    try{coerceRowValue(value,value,properties[key]);}catch(error){findings.push({level:'error',nodeId:node.id,title:'Valeur incompatible avec le schéma',detail:error.message,field:key});}
  }
  for(const key of table.schema.required||[])if(!Object.hasOwn(node.row,key))findings.push({level:'error',nodeId:node.id,title:'Champ obligatoire absent',detail:key,field:key});
 }
 return {flowId:flow.id,flowName:flow.name,checkedAt:new Date().toISOString(),steps:flow.nodes.length,routes:routes.length,findings,errors:findings.filter(f=>f.level==='error').length,warnings:findings.filter(f=>f.level==='warning').length};
}
export function qualityView(flow,report){return head('QUALITÉ DU PARCOURS','Contrôle de configuration',flow.name||flow.dnis,btn(icon('undo')+' Retour au parcours','quality-back','secondary')+btn(icon('download')+' Exporter le rapport','quality-export','secondary'))+`<section class="simulation-metrics"><article><strong>${report.steps}</strong><span>Étapes examinées</span></article><article><strong>${report.errors}</strong><span>Erreurs détectées</span></article><article><strong>${report.warnings}</strong><span>Contrôles incomplets</span></article></section><p class="helper">Contrôle des références et des schémas chargés. Le fonctionnement des bots, Data Actions et ressources en temps réel nécessite une recette d’appel dans Genesys.</p><section class="publication-rows">${report.findings.map(f=>`<article class="publication-row"><header>${icon(f.level==='error'?'alert':'code')}<div><h2>${esc(f.title)}</h2><p>${esc(nodeTitle(flow.nodes.find(n=>n.id===f.nodeId)))}${f.field?' · '+esc(f.field):''}</p><small>${esc(f.detail)}</small></div>${tag(f.tag||(f.level==='error'?'À corriger':f.level==='warning'?'À vérifier':'Dynamique'),f.level==='info'?'neutral':'amber')}${btn('Ouvrir l’étape','quality-step','secondary small',`data-node="${flow.nodes.findIndex(n=>n.id===f.nodeId)}"`)}</header></article>`).join('')||'<div class="publication-result success"><h2>Aucune anomalie détectée</h2><p>Les références et les contraintes examinées sont cohérentes.</p></div>'}</section>`;}
