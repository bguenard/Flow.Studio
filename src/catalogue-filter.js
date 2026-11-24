import {normalizeSelectSearch} from './searchable-select.js';
import {esc,icon,btn} from './ui-kit.js';
export const UNASSIGNED_MODEL='unassigned';
export function catalogueModelOptions(flows,registry){
 const ids=new Set(flows.map(f=>f.id)),models=registry.coreModels||[];
 const links=new Map((registry.declinations||[]).filter(d=>models.some(m=>m.id===d.coreModelId)).map(d=>[d.flowId,d.coreModelId]));
 return [{value:'',label:'Tous les parcours',count:ids.size},...models.map(m=>({value:'model:'+m.id,label:m.name,count:[...ids].filter(id=>links.get(id)===m.id).length})).sort((a,b)=>a.label.localeCompare(b.label,'fr',{sensitivity:'base',numeric:true})),{value:UNASSIGNED_MODEL,label:'Sans Core Model',count:[...ids].filter(id=>!links.has(id)).length}];
}
export function filterCatalogueEntries(entries,registry,{model='',query='',title=f=>f.title||f.key}={}){
 const links=new Map((registry.declinations||[]).filter(d=>(registry.coreModels||[]).some(m=>m.id===d.coreModelId)).map(d=>[d.flowId,d.coreModelId]));
 const words=normalizeSelectSearch(query).split(/\s+/).filter(Boolean);
 return entries.filter(({f})=>{
  const parent=links.get(f.id);
  if(model===UNASSIGNED_MODEL&&parent)return false;
  if(model.startsWith('model:')&&parent!==model.slice(6))return false;
  const name=registry.coreModels?.find(m=>m.id===parent)?.name||'';
  const haystack=normalizeSelectSearch([title(f),f.key,f.division,name].join(' '));
  return words.every(word=>haystack.includes(word));
 });
}
export function catalogueFilterView(options,model,query,count){
 const active=options.find(o=>o.value===model)||options[0];
 return `<section class="catalogue-filter-bar ${model?'is-filtered':''}" aria-label="Filtres des parcours"><div class="catalogue-model-filter"><span class="catalogue-filter-symbol" aria-hidden="true">${icon('layers')}</span><div><label for="catalogue-model">Core Model</label><select id="catalogue-model">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===model?'selected':''}>${esc(o.label)} · ${o.count}</option>`).join('')}</select></div></div><div class="catalogue-text-filter"><label for="catalogue-search">Rechercher un parcours</label><div class="search">${icon('search')}<input id="catalogue-search" placeholder="Nom, numéro ou entité…" value="${esc(query)}"></div></div>${btn('Réinitialiser','catalogue-reset','quiet small',`id="catalogue-reset" ${!model&&!query?'disabled':''}`)}</section><div class="catalogue-filter-summary"><span id="catalogue-result-count" role="status" aria-live="polite">${count} parcours affiché${count>1?'s':''}</span>${model?`<span class="catalogue-filter-chip">${icon('layers')} ${esc(active.label)}<button type="button" data-action="catalogue-model-clear" aria-label="Retirer le filtre Core Model">${icon('close')}</button></span>`:''}</div>`;
}
