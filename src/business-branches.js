import {routeTargetKey,routeTypeLabels} from './v5-fields.js';
import {fieldLabel} from './draft-fields.js';
import {esc} from './ui-kit.js';
const present=value=>value!=null&&String(value).trim()!=='';
const valueOf=(field,pending)=>Object.hasOwn(pending,field.key)?pending[field.key]:field.value;
const branchOrder=['NEXT','OPEN','CLOSED','HOLIDAY','EMERGENCY','TRUE','FALSE','LOGGEDIN','NOTLOGGEDIN','NOT_BUSY','BUSY','LOWER_BOUND','BETWEEN_BOUNDS','UPPER_BOUND','INTENT','NO_MATCH','NO_INPUT','INQUEUE','DEFAULT','BYPASS','ERROR'];
const branchRank=id=>{const prefix=id.replace(/_?TARGET_TYPE(?:_\d+)?$/,'');const i=branchOrder.indexOf(prefix);return i<0?50:i;};
const rank=field=>field.kind==='route-type'?1:field.kind==='route-target'?2:field.kind==='audio'||field.resource?.audio?3:0;

/** Keep each issue's destination, announcement and weight together, without changing source values. */
export function businessBranches(node,fields,pending={},onlyConfigured=true){
 const columns={...node.schema?.properties,...node.row},claimed=new Set();
 const all=fields.filter(f=>f.kind==='route-type').map(type=>{
  const target=routeTargetKey(type.key,columns),prefix=type.key.replace(/_?TARGET_TYPE(?:_\d+)?$/,''),number=type.key.match(/_(\d+)$/)?.[1];
  const keys=new Set([type.key,target,type.key.replace('TARGET_TYPE','TARGET_AUDIO'),type.key.replace('TARGET_TYPE','AUDIO')]);
  if(prefix)keys.add(prefix+'_AUDIO');
  if(/^RATIO\d+$/.test(prefix))keys.add(prefix);
  if(number){keys.add('RATIO'+number);keys.add('RATIO_'+number);}
  if(prefix==='BETWEEN_BOUNDS')keys.add('BETWEEN_BOUND_AUDIO');
  if(!prefix&&!number)keys.add('TARGET_MESSAGE_AUDIO');
  const members=fields.filter(f=>keys.has(f.key)&&!claimed.has(f.key));members.forEach(f=>claimed.add(f.key));
  const label=fieldLabel(type.key).replace(/ · type de destination$/,'').replace(/^Type de destination$/,'Suite du parcours');
  const configured=members.some(f=>present(valueOf(f,pending)))||members.some(f=>Object.hasOwn(pending,f.key));
  const route=String(valueOf(type,pending)||'').split('|')[0].toLowerCase();
  return {id:type.key,label,configured,route,fields:members.sort((a,b)=>rank(a)-rank(b)||a.label.localeCompare(b.label,'fr',{numeric:true}))};
 }).sort((a,b)=>{const option=x=>/^OPTION(?:\d|STAR|DIEZ)/.test(x.id);return Number(option(b))-Number(option(a))||branchRank(a.id)-branchRank(b.id)||a.label.localeCompare(b.label,'fr',{numeric:true});});
 return {all,branches:onlyConfigured?all.filter(b=>b.configured):all,claimed};
}
/** Lecture seule de la suite d'une branche, pour la vue Métier. */
function destination(branch){
 const type=branch.fields.find(f=>f.kind==='route-type'),target=branch.fields.find(f=>f.kind==='route-target');
 const parts=[type?.display,!['disconnect','next','enable','disable'].includes(branch.route)&&present(target?.value)?target.display:''].filter(present);
 return `<p class="business-branch-destination"><span>Suite de l’appel</span>${esc(parts.join(' · ')||'Non renseignée')}<button type="button" class="btn quiet small" data-action="set-audience" data-audience="admin">Modifier en Administration</button></p>`;
}
export function businessBranchView(model,selected,renderField,pending={},{routing=true,admin=false}={}){
 if(!model.all.length)return '';
 const branch=model.branches.find(b=>b.id===selected)||model.branches[0];
 return `<section class="business-setting-group business-branch-editor"><h3>Choix et suites du parcours</h3><p class="helper">Sélectionnez un choix pour modifier uniquement ses réglages.</p>${branch?`<div class="field"><label for="business-branch">${model.all.some(b=>/^OPTION/.test(b.id))?'Choix à modifier':'Situation à modifier'}</label><select id="business-branch">${model.branches.map(b=>`<option value="${esc(b.id)}" ${b.id===branch.id?'selected':''}>${esc(b.label)}${b.configured?'':' · à configurer'}</option>`).join('')}</select></div><div class="business-branch-panel"><h4>${esc(branch.label)}</h4>${routing?'':destination(branch)}${branchParametersView(branch,pending)}<div class="field-grid">${branch.fields.filter(f=>routing?!(f.kind==='route-target'&&['disconnect','next','enable','disable'].includes(branch.route)&&!present(valueOf(f,pending))):f.kind!=='route-type'&&f.kind!=='route-target').map(f=>renderField({...f,label:admin?f.label:f.kind==='route-type'?'Action à effectuer':f.kind==='route-target'?(branch.route==='number'?'Numéro à appeler':'Destination'):f.kind==='audio'||f.resource?.audio?'Message pour ce choix':f.label})).join('')}</div>${routing&&['disconnect','next','enable','disable'].includes(branch.route)?`<p class="helper">${esc(routeTypeLabels[branch.route])} : aucune destination à renseigner.</p>`:''}</div>`:'<p class="helper">Aucun choix renseigné.</p>'}${model.branches.length<model.all.length?'<button type="button" class="btn quiet small" data-action="business-show-choices">Afficher aussi les choix non renseignés</button>':''}</section>`;
}

/** Show the parameters specific to the selected exit, even when destinations match. */
export function branchParametersView(branch,pending={}){
 const type=branch.fields.find(f=>f.kind==='route-type'),target=branch.fields.find(f=>f.kind==='route-target');
 const details=[type,target].filter(Boolean).flatMap(f=>String(valueOf(f,pending)??'').split('|').slice(1)).filter(Boolean).map(part=>{
  const at=part.indexOf(':'),name=at<0?'':part.slice(0,at).toLowerCase(),value=at<0?part:part.slice(at+1);
  const label={pdata:'Contexte transmis',sub:'Contrôle exécuté',lang:'Langue',status:'Statut'}[name]||'Paramètre associé';
  return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
 });
 return details.length?`<section class="branch-parameters" aria-label="Paramètres de cette situation"><h5>Paramètres de cette situation</h5><dl>${details.join('')}</dl><p class="helper">Ces paramètres sont propres à cette situation, même si la destination est commune.</p></section>`:'';
}
