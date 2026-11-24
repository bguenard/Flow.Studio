import {PARTICIPANT_CATALOGUE,catalogueDefinition,validateParticipantDefinitionChange} from './participant-catalogue.js';
import {participantAdminView,participantEditor,participantEditorRow} from './participant-admin-view.js';
import {prepareParticipantCatalogueImport} from './participant-catalogue-import.js';
import {createParticipantCatalogueClient} from './genesys-participant-catalogue.js';
import {flowDataModel,prepareFlowData} from './flow-data.js';
import {flowDataView} from './flow-data-view.js';
import {allowedDuringSourceLoad} from './source-loading.js';
import {catalogueModelOptions,filterCatalogueEntries,catalogueFilterView} from './catalogue-filter.js';
import {businessBranches,businessBranchView} from './business-branches.js';
import {renameCoreModel,nextVersionLabel,prepareCoreModelCopy,renameCoreModelView,coreModelCopyView} from './core-model-actions.js';
import {coreModelCandidates,validateCoreModelIdentity,prepareCoreModel,removeCoreModel,coreModelWizardView,coreModelDeleteView} from './core-model-wizard.js';
import {createGenesysGovernanceClient} from './genesys-governance.js';
import {durableRegistry,restorePendingRegistry,validateGovernanceMigration} from './governance-projection.js';
import {governanceSettingsView} from './governance-settings-view.js';
import {createCallComparison,advanceCallComparison,comparisonComplete,callComparisonReport} from './call-comparison.js';
import {createComparisonPlayback} from './call-comparison-playback.js';
import {callComparisonView} from './call-comparison-view.js';
import {createLiveActivityController} from './live-activity.js';
import {liveActivityView,liveActivityToggle} from './live-activity-view.js';
import {publicationPreflight} from './publication-preflight.js';
import {configurationFlow,configurationView} from './configuration-view.js';
import {stepFieldView} from './step-field-view.js';
import {wizardOptions,prepareFlowWizard} from './flow-wizard.js';
import {flowWizardView} from './flow-wizard-view.js';
import {designerOptions,prepareNewFlow,prepareNewBlock,prepareRouteEdit} from './flow-designer.js';
import {designerView} from './flow-designer-view.js';
import {applyDesignerDraft} from './designer-draft.js';
import {createSimulationAudio, createPromptResolver, simulationPlaylist, simulationLanguage} from './simulation-audio.js';
import { inspectJourney, qualityView } from './journey-quality.js';
import { createPublicationClient, publicationRows, restorationRows, stable, rebaseDraft } from './publication.js';
import { savePublication, publicationHistory, saveWorkspace, readWorkspace, clearWorkspace } from './studio-storage.js';
import { publicationView } from './publication-view.js';
import { startSimulation, advanceSimulation, rewindSimulation, simulationReport, automaticSimulationRoute, resumeSimulation } from './call-simulator.js';
import { simulatorView } from './simulator-view.js';
import { loadResourceCatalogue, resourceForField } from './genesys-resources.js';
import { audioModeEdit } from './resource-editor.js';
import { selectWolfV5, registryInScope } from './wolf-scope.js';
import { businessWorkspace, businessSteps, taskFields, businessTasks } from './business-workspace.js';
import { businessInspectorModel, adminSourceDetails, audienceNodeTitle, compareBusinessFields, configuredStepFields } from './journey-audience.js';
import { prepareStepDraft } from './step-draft.js';
import { loadJourneyAnalytics } from './analytics.js';
import { analyticsView } from './analytics-view.js';
import { enhanceSelects, normalizeSelectSearch } from './searchable-select.js';
import { normalizeSnapshot, buildVoiceInventory, parseTableFile } from './data-source.js';
import { getAuthConfig, saveAuthConfig, beginLogin, completeLogin, getAccessToken, logout } from './auth.js';
import { loadFromGenesys } from './genesys-direct.js';
import { fieldLabel } from './draft-fields.js';
import { flowTitle, humanText, nodeTitle, businessFields, compareFlows, describeValue, flowRoutes, unresolvedReferences } from './business.js';
import { startGenesysSession } from './startup.js';
import { icon, btn, tag, esc, head, notice, empty, plural } from './ui-kit.js';
import { emptyRegistry, seedFromSource, roleOf, resolveRegistry, declareReference, attachDeclination, removeFromRegistry, setScope, scopeLabel, localGaps, threeWay, declinationSummary, versionDelta, suggestVersionLabel, suggestModelName, registryForExport } from './governance.js';
import { applyDraftRows, workingInventory, withNodeTitles } from './working-inventory.js';
import { comparisonChoices, prepareComparisonPlan } from './comparison-plan.js';
import { comparisonWorkspace } from './comparison-view.js';
import { blockCandidates, prepareBlockPlan } from './block-plan.js';
import { blockComparisonWorkspace } from './block-comparison-view.js';
import { journeyDiagram, diagramLayout, onDiagramReady, retryDiagram } from './journey-diagram.js';
import { sidebarCollapsed, readSidebarPreference, writeSidebarPreference } from './sidebar.js';
import { journeyNavigation, stepList, stepRelations } from './journey-view.js';
import { registryScope, loadRegistry, clearRegistry } from './governance-store.js';
import { coreModelsView, familyView, impactView, declareView } from './governance-views.js';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
// Regroupements secondaires pour la comparaison ; jamais la structure d’un parcours.
const sections = {parcours:['Le parcours','layers'],accueil:['Accueil','message'],horaires:['Disponibilité','clock'],orientation:['Orientation','menu'],equipes:['Équipes','people'],attente:['Attente','clock'],contexte:['Contexte client','building']};
const viewNames={participantadmin:'Catalogue des données',flowdata:'Données du parcours',modelrename:'Renommer le Core Model',coremodel:'Créer un Core Model',coremodeldelete:'Supprimer un Core Model',callcompare:'Comparatif des appels',configuration:'Configurations V5',wizard:'Création guidée',designer:'Designer WOLF V5',quality:'Contrôle du parcours',simulation:'Studio d’appel',publication:'Publication Genesys',catalogue:'Parcours clients',references:'Core Models',flow:'Parcours',activity:'Activité du numéro',compare:'Comparer des parcours',copy:'Reprendre des paramètres',changes:'Mes changements',settings:'Connexion',diagnostic:'Diagnostic',family:'Core Model',impact:'Impact d’une évolution',declare:'Rôle du parcours'};
function initialState(){return {view:'settings',wizard:null,designer:null,simulation:null,publicationPlan:null,publicationRun:null,publicationBusy:false,publicationSelected:new Set(),publicationHistory:[],identity:null,identityError:'',recovery:null,storageError:'',catalogueModel:'',onlyConfigured:true,businessTask:'all',businessQuery:'',activityPeriod:'today',activityData:null,activityLoading:false,activityError:'',activityBaseline:null,activitySource:'local',audience:'business',adminPanel:'settings',adminQuery:'',journeyView:'overview',stepQuery:'',canvasAllLinks:false,navCollapsed:false,flow:0,node:0,zoom:1,query:'',category:'all',picker:null,pickerQuery:'',left:null,right:null,comparisonSessions:new Map(),draftRevision:0,onlyChanges:true,error:'',loading:false,progress:'',drafts:new Map(),pendingFields:new Map(),creations:new Map(),blockCreations:new Map(),audit:[],registry:emptyRegistry(),registrySaved:true,model:null,impactFlow:null,declareFlow:null,declareReturn:'references',snapshot:null,inventory:null,source:'Genesys Dublin · déconnecté'};}
let ui=initialState();
let sourceController=null, sourceGeneration=0;
const sourceIncomplete=()=>Boolean(ui.sourceLoading||ui.snapshot?.source?.partial);
function disablePartialActions(){if(sourceIncomplete())for(const button of $$('button[data-action]'))if(!allowedDuringSourceLoad(button.dataset.action,button.dataset.view)){button.disabled=true;button.title='Disponible après le chargement complet des parcours';}}
const liveActivityController=createLiveActivityController({getToken:getAccessToken,onChange:state=>{ui.liveActivity=state;if(ui.view==='flow')render();}});
let comparisonSpeakerSide=null,comparisonSpeakerState=null;
function paintComparisonAudio(state,side=ui.callComparison?.cursor){
 comparisonSpeakerSide=side;comparisonSpeakerState=state;
 $$('.comparison-lane').forEach(lane=>lane.classList.toggle('is-speaking',lane.dataset.side===side&&state==='speaking'));
 const status=$('#comparison-audio-status');if(status)status.textContent=({loading:'Chargement du message…',speaking:'Lecture des messages…',done:'Messages lus',choice:'Un choix est nécessaire pour poursuivre',muted:'Lecture visuelle, son désactivé'}[state]||'')+' · '+(side==='before'?'Avant':'Après');
}
const comparisonAudio=createSimulationAudio({resolvePrompt:createPromptResolver(getAccessToken),onState:state=>paintComparisonAudio(state,comparisonSpeakerSide)});
const comparisonPlayback=createComparisonPlayback({getState:()=>ui.view==='callcompare'?ui.callComparison:null,update:state=>{ui.callComparison=state;render();},audio:comparisonAudio,onState:paintComparisonAudio});
function resetCallComparison(overrides={}){comparisonPlayback.cancel();const c=ui.callComparison;ui.callComparison={...createCallComparison(c.lanes.before?.flow,c.lanes.after.flow,{scenario:c.scenario,digit:c.digit,context:c.context,...overrides}),audioEnabled:c.audioEnabled,presentation:c.presentation};}
function centerComparisonMaps(){for(const viewport of $$('.comparison-lane .simulation-map-viewport')){const node=viewport.querySelector('.simulation-map-node.current');if(node){viewport.scrollLeft=Math.max(0,node.offsetLeft*.72-viewport.clientWidth/2+node.offsetWidth*.36);viewport.scrollTop=Math.max(0,node.offsetTop*.72-viewport.clientHeight/2+node.offsetHeight*.36);}}}

let simulationTimer=null,audioVisit=null;
const simulationAudio=createSimulationAudio({resolvePrompt:createPromptResolver(getAccessToken),onState:state=>{if(audioVisit){audioVisit.state=state;paintSimulationAudio();}}});
const simulationKey=session=>[session.startedAt,session.source,session.nodeId,session.trail.length,Boolean(session.waiting),session.status].join('|');
function stopSimulationAudio(){if(audioVisit)simulationAudio.cancel();audioVisit=null;}
function paintSimulationAudio(){
 const state=audioVisit?.state;$('.simulation-phone')?.classList.toggle('is-speaking',state==='speaking');
 const label=$('#simulation-audio-status');if(label)label.textContent=ui.simulation?.audioError||({loading:'Chargement du message…',speaking:'Lecture du message…',done:'Messages lus'}[state])||(ui.simulation?.audioEnabled===false?'Son désactivé':'Messages lus automatiquement pendant le déroulement');
}
function scheduleSimulation(){
 clearTimeout(simulationTimer);
 comparisonPlayback.sync();
 if(ui.view==='callcompare')return;
 if(ui.view!=='simulation'||!ui.simulation?.playing||ui.loading){stopSimulationAudio();return;}
 const session=ui.simulation,key=simulationKey(session),route=automaticSimulationRoute(session);
 if(session.audioEnabled!==false){
  if(audioVisit?.key!==key){
   stopSimulationAudio();audioVisit={key,state:'loading'};paintSimulationAudio();
   simulationAudio.play(simulationPlaylist(session),simulationLanguage(session)).then(result=>{
    if(result.cancelled||ui.view!=='simulation'||!ui.simulation?.playing||simulationKey(ui.simulation)!==key)return;
    audioVisit={key,state:'done'};paintSimulationAudio();scheduleSimulation();
   }).catch(error=>{if(ui.view!=='simulation'||simulationKey(ui.simulation)!==key)return;ui.simulation.audioError=error.message;ui.simulation.playing=false;render();});
   return;
  }
  paintSimulationAudio();if(audioVisit.state!=='done')return;
 }else stopSimulationAudio();
 if(route)simulationTimer=setTimeout(()=>{if(ui.view!=='simulation'||ui.simulation!==session)return;ui.simulation=advanceSimulation(session,route.id);render();},900);
}
function centerSimulationMap(){
 const viewport=$('.simulation-map-viewport'),node=$('.simulation-map-node.current');if(!viewport||!node)return;
 const key=simulationKey(ui.simulation);if(viewport.dataset.centered===key)return;viewport.dataset.centered=key;
 viewport.scrollLeft=Math.max(0,node.offsetLeft*.72-viewport.clientWidth/2+node.offsetWidth*.36);viewport.scrollTop=Math.max(0,node.offsetTop*.72-viewport.clientHeight/2+node.offsetHeight*.36);
}
// auth.js persists the OAuth session itself; workspaces and publication journals use IndexedDB.
// This handle only reads the browser-local registry awaiting migration to Genesys.
const storage=(()=>{try{return window.localStorage;}catch{return null;}})();
// Menu latéral : le choix de l'utilisateur (réduit ou déployé) vaut partout ; sans choix, il se réduit là où la place manque.
let sidebarPreference=readSidebarPreference(storage),sidebarShownCollapsed=false;
function menuCollapsed(){return sidebarCollapsed({preference:sidebarPreference,studio:ui.view==='flow'&&!ui.clone&&!ui.loading,width:window.innerWidth});}
function setSource(snapshot,label,sourceMode='local'){if(ui.liveActivity?.enabled)liveActivityController.stop();comparisonPlayback.cancel();cancelActivity();ui.identity=null;ui.identityError='';ui.publicationHistory=[];ui.publicationPlan=null;ui.publicationRun=null;ui.recovery=null;ui.storageError='';const normalized=normalizeSnapshot(selectWolfV5(normalizeSnapshot(snapshot)));if(!normalized.tables.length)throw Error('Aucune table voix WOLF V5 dans cette source. Les tables V4 sont hors périmètre.');const inventory=buildVoiceInventory(normalized);ui.snapshot=normalized;ui.inventory=inventory;ui.catalogueModel='';ui.clone=null;ui.renameModel=null;ui.designer=null;ui.wizard=null;ui.activityBaseline=inventory;ui.activitySource=sourceMode;ui.activityData=null;ui.activityError='';ui.source=label;ui.drafts=new Map();ui.draftRevision++;ui.comparisonSessions=new Map();ui.pendingFields=new Map();ui.creations=new Map();ui.blockCreations=new Map();ui.isolatedCreationBatch=null;ui.audit=[];ui.governance={status:sourceMode==='genesys'?'loading':'offline',migration:loadRegistry(storage,registryScope(normalized.source)),pending:null};ui.registry=sourceMode==='genesys'?emptyRegistry():seedFromSource(normalized.source);ui.registrySaved=false;governanceClient=null;participantCatalogueClient=null;ui.participantCatalogue={status:sourceMode==='genesys'?'loading':'offline'};ui.participantAdmin={query:'',type:'',divisionId:'',editor:null,error:''};ui.model=null;ui.impactFlow=null;ui.declareFlow=null;ui.flow=0;ui.node=0;ui.left=null;ui.right=null;ui.picker=null;ui.view='catalogue';ui.error='';render();}
let participantCatalogueClient=null;
function installParticipantCatalogue(result){
 ui.participantCatalogue=result;
 const tables=ui.snapshot.tables.filter(t=>t.name!==PARTICIPANT_CATALOGUE);
 if(result.table)tables.push(result.table);
 ui.snapshot=normalizeSnapshot({...ui.snapshot,source:{...ui.snapshot.source,participantCatalogueRequired:true},tables});
 if(liveSnapshot)liveSnapshot=normalizeSnapshot({...liveSnapshot,tables:[...liveSnapshot.tables.filter(t=>t.name!==PARTICIPANT_CATALOGUE),...(result.table?[result.table]:[])]});
 workingCache=null;ui.draftRevision++;
}
async function loadParticipantCatalogue(signal){
 const token=getAccessToken(),organizationId=ui.identity?.organizationId;
 if(!organizationId){ui.participantCatalogue={status:'error',error:'Connectez-vous à Genesys pour lire le catalogue.'};return;}
 const client=createParticipantCatalogueClient(token,{organizationId,signal});participantCatalogueClient=client;
 ui.participantCatalogue={status:'loading'};
 try{const result=await client.load();if(getAccessToken()!==token||ui.identity?.organizationId!==organizationId||participantCatalogueClient!==client)return;installParticipantCatalogue(result);}
 catch(error){if(participantCatalogueClient===client){ui.participantCatalogue={status:'error',error:error.message};ui.snapshot=normalizeSnapshot({...ui.snapshot,source:{...ui.snapshot.source,participantCatalogueRequired:true}});}}
}
function hasLocalWork(){return Boolean(ui.governance?.pending||ui.drafts.size||ui.creations.size||ui.blockCreations.size||ui.pendingFields.size||[...ui.comparisonSessions.values()].some(session=>Object.values(session.decisions).some(decision=>decision.mode==='copy'||decision.mode==='edit')||Object.values(session.blockDecisions||{}).some(decision=>decision.mode==='insert')));}
let workingCache = null;
function effectiveInventory(){
 if(!workingCache||workingCache.snapshot!==ui.snapshot||workingCache.revision!==ui.draftRevision||workingCache.drafts!==ui.drafts){
  let inventory=ui.drafts.size?workingInventory(ui.snapshot,ui.drafts):ui.inventory;
  const names=new Map([...ui.blockCreations.values()].flatMap(block=>block.mappings.map(mapping=>[mapping.nodeId,mapping.title||humanText(mapping.oldKey)])));
  inventory=withNodeTitles(inventory,names);
  workingCache={snapshot:ui.snapshot,revision:ui.draftRevision,drafts:ui.drafts,inventory};
 }
 return workingCache.inventory;
}
function workingFlow(index){return effectiveInventory().flows[index]||null;}
const flowAt = i=>workingFlow(Number(i));
const current = ()=>ui.view==='configuration'?configurationFlow(applyDraftRows(ui.snapshot,ui.drafts),ui.configurationTable):flowAt(ui.flow);
const flowIndex = id=>ui.inventory.flows.findIndex(f=>f.id===id);
const flowById = id=>{const index=flowIndex(id);return index<0?null:flowAt(index);};
const workingFlows = ()=>ui.inventory.flows.map((_,i)=>flowAt(i));
const activeRegistry = ()=>registryInScope(ui.registry,ui.snapshot.source);
const role = id=>roleOf(activeRegistry(),id);
const resolved = ()=>resolveRegistry(activeRegistry(),workingFlows());
// Les parcours de référence d'une même famille peuvent porter la même description : leur titre vient du référentiel.
function displayTitle(f){const r=role(f?.id);return r.role==='reference'?`${r.model.name} · version ${r.version.label}`:flowTitle(f);}
let governanceClient=null;
function requireGovernanceReady(){if(ui.activitySource!=='genesys'||!ui.identity||ui.governance?.status!=='ready'||!governanceClient)throw Error('Le référentiel partagé Genesys doit être disponible avant de modifier les rattachements. Ouvrez Core Models.');}
async function commitRegistry(next,message){
 requireGovernanceReady();
 if(ui.governance.pending&&next!==ui.governance.pending.registry)throw Error('Une sauvegarde du référentiel reste à reprendre dans Core Models.');
 const durable=durableRegistry(next,ui.creations.keys());
 ui.governanceBusy=true;render();
 try{
  if(!same(durable,ui.governance.remoteRegistry)){
   const result=await governanceClient.save(durable);ui.governance={...ui.governance,...result,remoteRegistry:result.registry,status:'ready'};
  }
  ui.registry=next;ui.registrySaved=true;ui.governance.pending=null;ui.governance.error='';if(message)record(message);scheduleWorkspaceSave();
 }catch(error){ui.registrySaved=false;ui.governance.pending={registry:next,base:ui.governance.remoteRegistry,error:error.message};scheduleWorkspaceSave();throw error;}
 finally{ui.governanceBusy=false;render();}
}
async function loadGovernance(){
 if(!ui.identity){ui.governance={...ui.governance,status:'error',error:'L’organisation Genesys doit être vérifiée.'};return;}
 const token=getAccessToken(),organizationId=ui.identity.organizationId;
 const client=createGenesysGovernanceClient(token,{organizationId});governanceClient=client;
 const currentSession=()=>governanceClient===client&&getAccessToken()===token&&ui.identity?.organizationId===organizationId;
 ui.governance={...ui.governance,status:'loading',error:''};render();
 try{
  const result=await client.load();if(!currentSession())return;
  if(result.exists){ui.registry=restorePendingRegistry(result.registry,ui.registry,ui.creations.keys());ui.registrySaved=true;ui.governance={...ui.governance,...result,remoteRegistry:result.registry,status:'ready',migration:null};}
  else {ui.governance={...ui.governance,...result,status:'missing'};const entities=await loadResourceCatalogue('divisions',token);if(!currentSession())return;resourceStates.set('divisions',{status:'ready',entities});}
 }catch(error){if(!currentSession())return;governanceClient=null;ui.governance={...ui.governance,status:'error',error:error.message};}
 finally{if(getAccessToken()===token&&ui.identity?.organizationId===organizationId)render();}
}
function governancePanel(){return governanceSettingsView(ui.governance,loadedCatalogues().divisions||[]);}

function summaryOf(item){return item?.flow&&item.base?.flow?declinationSummary(item.base.flow,item.flow,item.latest?.flow||null,item.nodeMappings):null;}
function declinationOf(flowId){for(const model of resolved().models){const item=model.declinations.find(x=>x.flowId===flowId);if(item)return {model,item};}return null;}
const isEntityFlow = f=>{const r=role(f.id).role;return r==='declination'||r==='none'&&f.category!=='template';};
function draftChanges(){const changes=[];for(const d of ui.drafts.values())for(const field of Object.keys(d.row))if(!same(d.original[field],d.row[field]))changes.push({...d,field,before:d.original[field],after:d.row[field]});return changes;}
function affectedFlows(nodeId){return effectiveInventory().flows.filter(f=>f.nodes.some(n=>n.id===nodeId));}
function saveRow(node,row){const original=ui.snapshot.tables.find(t=>t.id===node.tableId)?.rows.find(r=>String(r.key)===node.key);if(!original)throw Error('La configuration d’origine est introuvable.');if(same(original,row))ui.drafts.delete(node.id);else ui.drafts.set(node.id,{nodeId:node.id,tableId:node.tableId,table:node.tableName,key:node.key,original,row:{...row},label:nodeTitle(node)});ui.draftRevision++;}
function record(message){ui.audit.unshift({message,at:new Date().toISOString()});scheduleWorkspaceSave();}
function toast(message){$('#toast').textContent=message;$('#toast').className='toast visible';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').className='toast',4200);}
function go(view,extras={}){if(ui.liveActivity?.enabled)liveActivityController.stop();if(ui.view==='callcompare'&&view!=='callcompare')comparisonPlayback.cancel();if(!ui.inventory)view='settings';if(ui.view==='activity'&&view!=='activity')cancelActivity();if(ui.view==='simulation'&&view!=='simulation')stopSimulationAudio();Object.assign(ui,{view,error:'',picker:null,query:''},extras);render();window.scrollTo({top:0});focusPage();}
// À chaque changement de page, le titre reçoit le focus : la lecture au clavier ou vocale reprend en haut du nouveau contenu.
function focusPage(){const title=$('main h1');if(!title)return;title.setAttribute('tabindex','-1');title.focus({preventScroll:true});}
function flowMeta(f){const number=/^\+?\d[\d ]+$/.test(f.key)?f.key:null;const duplicate=ui.inventory.flows.filter(x=>x.key===f.key).length>1;const homonym=!number&&ui.inventory.flows.some(x=>x.id!==f.id&&flowTitle(x)===flowTitle(f));return [humanText(f.division)||'Entité non renseignée',number,homonym?f.key:null,duplicate?`Version du moteur ${f.version}`:null].filter(Boolean).join(' · ');}
function categoryTag(f){const r=role(f.id).role;return r==='reference'?tag('Parcours de référence','orange'):r==='declination'?tag('Déclinaison','green')+(f.category==='draft'?tag('Brouillon','amber'):''):f.category==='draft'?tag('Brouillon','amber'):f.category==='template'?tag('Rôle à déclarer','amber'):tag('Parcours voix','neutral');}
function inReferenceSpace(){return ['references','family','impact','declare','coremodel','coremodeldelete','modelrename'].includes(ui.view)||ui.view==='flow'&&role(current()?.id).role==='reference';}
function shell(body){const n=draftChanges().length+ui.creations.size+ui.blockCreations.size,collapsed=sidebarShownCollapsed=menuCollapsed();return `<div class="app-shell ${collapsed?'sidebar-collapsed ':''}${ui.view==='flow'&&!ui.clone&&!ui.loading?'is-studio':ui.view==='catalogue'&&!ui.loading?'is-catalogue':ui.view==='activity'&&!ui.loading?'is-analytics':ui.view==='configuration'&&!ui.loading?'is-configuration':['compare','copy'].includes(ui.view)&&!ui.loading?'is-comparison':''}"><aside class="sidebar"><a href="#" class="brand" data-action="nav" data-view="catalogue"><img src="./src/favicon.svg" alt="Orange"><strong>Orange<br>Business</strong></a><div class="studio-name">WOLF Core Studio <span>Parcours voix V5</span></div><div class="nav-label">PARCOURS</div><nav>${[['catalogue','phone'],['references','layers'],['compare','diff'],['changes','clock']].map(([v,i])=>`<button class="nav-item ${(v==='references'?inReferenceSpace():v==='catalogue'?ui.view==='catalogue'||['flow','activity'].includes(ui.view)&&!inReferenceSpace():ui.view===v)?'active':''}" ${(v==='references'?inReferenceSpace():ui.view===v)?'aria-current="page"':''} data-action="nav" data-view="${v}" aria-label="${viewNames[v]}" title="${viewNames[v]}">${icon(i)}<span>${viewNames[v]}</span>${v==='changes'&&n?`<b>${n}</b>`:''}</button>`).join('')}</nav><div class="nav-label">ADMINISTRATION</div><nav>${[['participantadmin','database'],['configuration','code']].map(([v,i])=>`<button class="nav-item ${ui.view===v?'active':''}" data-action="nav" data-view="${v}" aria-label="${viewNames[v]}" title="${viewNames[v]}">${icon(i)}<span>${viewNames[v]}</span></button>`).join('')}</nav><div class="sidebar-bottom"><div class="sidebar-context"><span class="status-dot"></span> Voix<div>Tables WOLF V5</div></div><button class="nav-item ${ui.view==='settings'?'active':''}" data-action="nav" data-view="settings" aria-label="Connexion" title="Connexion">${icon('link')}<span>Connexion</span></button><button class="nav-item ${ui.view==='diagnostic'?'active':''}" data-action="nav" data-view="diagnostic" aria-label="Diagnostic technique" title="Diagnostic technique">${icon('code')}<span>Diagnostic technique</span></button><button class="nav-item sidebar-toggle" data-action="toggle-sidebar" aria-expanded="${!collapsed}" aria-label="${collapsed?'Déployer le menu':'Réduire le menu'}" title="${collapsed?'Déployer le menu':'Réduire le menu'}">${icon('chevron')}<span>Réduire le menu</span></button></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb">WOLF Core Studio ${icon('chevron')}<strong>${viewNames[ui.view]}</strong></div><div class="top-actions">${tag(ui.source,getAccessToken()?'green':'neutral')}<span class="avatar" title="${esc(ui.identity?.userName||'Orange Business')}">${esc(ui.identity?.userName?.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase()||'OB')}</span></div></header><main class="content">${ui.error?`<div class="error-box" role="alert">${esc(ui.error)}</div>`:''}${ui.identityError?notice('Parcours accessibles. La publication et la reprise automatique des brouillons restent indisponibles tant que le compte et l’organisation ne sont pas vérifiés. Exportez vos modifications avant de fermer cette page. <details><summary>Détail de la vérification</summary>'+esc(ui.identityError)+'</details>','warning'):''}${ui.storageError?notice(esc(ui.storageError),'warning'):''}${ui.recovery&&ui.view==='catalogue'?`<div class="workspace-recovery"><div><strong>Brouillons retrouvés</strong><p>Des modifications enregistrées dans ce navigateur peuvent être reprises.</p></div>${btn('Reprendre','workspace-restore','primary small')}${btn('Ignorer','workspace-dismiss','quiet small')}</div>`:''}${sourceLoadingNotice()}${body}<div class="bottom-note">${ui.inventory?'Périmètre : tables voix WOLF V5':'Connexion Genesys'}${draftChanges().length?' · Modifications en brouillon':''}</div></main></div></div>`;}
function catalogueEntries(){return filterCatalogueEntries(ui.inventory.flows.map((_,i)=>({f:flowAt(i),i})).filter(({f})=>isEntityFlow(f)),ui.registry,{model:ui.catalogueModel||'',query:ui.query,title:displayTitle});}
function updateCatalogueResults(){$('#flow-list').innerHTML=flowCards();const count=catalogueEntries().length;$('#catalogue-count').textContent=count;$('#catalogue-result-count').textContent=count+' parcours affiché'+(count>1?'s':'');$('#catalogue-reset').disabled=!ui.catalogueModel&&!ui.query;disablePartialActions();}
function flowCards(){const flows=catalogueEntries();return flows.map(({f,i})=>{const edits=f.nodes.filter(n=>ui.drafts.has(n.id)).length;const ref=role(f.id);return `<article class="flow-card"><div class="flow-card-main"><span class="flow-symbol">${icon('phone')}</span><div>${categoryTag(f)}<h2><button data-action="open-flow" data-index="${i}" title="${esc(displayTitle(f))}">${esc(displayTitle(f))}</button></h2><p>${esc(flowMeta(f))}</p></div></div><div class="flow-card-meta">${sourceIncomplete()?'<span>Détails en cours de chargement</span>':`<span>${icon('menu')} ${f.menus.length} menu${f.menus.length>1?'s':''}</span><span>${icon('people')} ${f.services.length} équipe${f.services.length>1?'s':''}</span>`}${ref.role==='declination'?`<span>${icon('layers')} ${esc(ref.model.name)} · version ${esc(ref.base.label)}${ref.isCurrent?'':' · version '+esc(ref.latest.label)+' disponible'}</span>`:''}${edits?tag('Adaptations en cours','amber'):''}</div><div class="flow-card-actions"><div class="flow-card-links">${btn(icon('chart')+' Activité','open-activity','quiet small',`data-index="${i}" aria-label="Activité de ${esc(displayTitle(f))}"`)}${btn(icon('diff')+' Comparer','compare-flow','quiet small',`data-index="${i}" aria-label="Comparer ${esc(displayTitle(f))}"`)}</div>${btn('Ouvrir le parcours '+icon('chevron'),'open-flow','secondary small',`data-index="${i}"`)}</div></article>`;}).join('')||empty('Aucun parcours trouvé','Modifiez votre recherche ou le filtre Core Model.',btn('Réinitialiser les filtres','catalogue-reset','secondary'));}
// Sans référentiel partagé (export local, lecture refusée), la page reste lisible : les parcours modèles ne figurent pas dans « Parcours clients ».
function referencesPage(){const status=ui.governance?.status,ready=status==='ready';if(status==='loading')return head('RÉFÉRENTIEL','Core Models','Un Core Model est un parcours complet, suivi version après version, avec les déclinaisons des entités qui s’y rattachent.')+governancePanel();const view=resolved();const summaries=new Map(sourceIncomplete()?[]:view.models.flatMap(m=>m.declinations.map(item=>[item.flowId,summaryOf(item)])));return coreModelsView({resolved:view,summaries,meta:flowMeta,isDemo:false,shared:ready,readOnly:!ready||sourceIncomplete(),banner:governancePanel()});}
function familyPage(){const model=resolved().models.find(m=>m.id===ui.model);if(!model)return empty('Core Model introuvable','Il n’est plus déclaré ou ses parcours sont absents de la source courante.',btn('Voir les Core Models','nav','primary','data-view="references"'));const summaries=new Map(model.declinations.map(item=>[item.flowId,summaryOf(item)]));const deltas=model.versions.map((version,index)=>index?versionDelta(model.versions[index-1].flow,version.flow):null);return governancePanel()+familyView({model,summaries,deltas,meta:flowMeta,title:displayTitle,shared:ui.governance?.status==='ready',pendingFlowIds:[...ui.creations.keys()]});}
function impactPage(){const found=declinationOf(ui.impactFlow);if(!found||!found.item.flow||!found.item.base.flow)return empty('Analyse indisponible','Ce parcours n’est pas rattaché à une version de référence présente dans la source courante.',btn('Voir les Core Models','nav','primary','data-view="references"'));const {model,item}=found;const analysis=item.isCurrent||!model.latest.flow?localGaps(item.base.flow,item.flow,{mappings:item.nodeMappings}):threeWay(item.base.flow,model.latest.flow,item.flow,{mappings:item.nodeMappings});return impactView({model,item:model.latest.flow?item:{...item,isCurrent:true},analysis,sections,title:displayTitle});}
function declarePage(){const f=flowById(ui.declareFlow);if(!f)return empty('Parcours introuvable','Revenez à la liste des parcours.');return declareView({flow:f,role:role(f.id),resolved:resolved(),suggestions:{name:suggestModelName(f),version:suggestVersionLabel(f)},meta:flowMeta,title:displayTitle});}
function catalogue(templates=false){if(templates)return referencesPage();const all=workingFlows();const options=catalogueModelOptions(all.filter(isEntityFlow),ui.registry);if(!options.some(o=>o.value===ui.catalogueModel))ui.catalogueModel='';const count=catalogueEntries().length;return head(templates?'RÉFÉRENTIEL':'PARCOURS VOIX · WOLF V5',templates?'Core Models':'Parcours clients',templates?'Un parcours complet à réutiliser et à faire évoluer pour vos entités.':'Parcours voix des entités : consultation, adaptation, simulation et publication.',btn(icon('diff')+' Comparer des parcours','nav','secondary','data-view="compare"')+btn('Création libre','designer-create','secondary')+btn('+ Créer un parcours','wizard-open','primary'))+`<div class="section-heading"><h2>${templates?'Parcours de référence disponibles':'Parcours des entités'} <span class="journey-count" id="catalogue-count">${count}</span></h2></div>${catalogueFilterView(options,ui.catalogueModel,ui.query,count)}<div class="flow-list" id="flow-list">${flowCards()}</div>`;}
function usefulFields(node,section){return businessFields(node).filter(f=>(!section||f.section===section)&&(f.schema||f.resource||f.key.toUpperCase()==='DESCRIPTION'||f.key==='WELCOME_AUDIO'||f.key==='MENU_AUDIO'||f.value!==''&&f.value!==null&&f.value!==undefined)).sort(compareBusinessFields);}
const resourceStates=new Map();
let resourceToken=null;
function syncResourceSession(){const token=getAccessToken();if(token!==resourceToken){resourceToken=token;resourceStates.clear();}return token;}
function loadedCatalogues(){syncResourceSession();return Object.fromEntries([...resourceStates].filter(([,state])=>state.status==='ready').map(([kind,state])=>[kind,state.entities]));}
async function loadResources(kind){
 const token=syncResourceSession();if(!token)return;
 if(resourceStates.get(kind)?.status==='loading')return;
 const state={status:'loading',entities:[]};resourceStates.set(kind,state);render();
 try{state.entities=await loadResourceCatalogue(kind,token);state.status='ready';}
 catch(error){state.status='error';state.error=error.message||'Liste Genesys indisponible.';}
 if(getAccessToken()===token&&resourceStates.get(kind)===state&&(ui.clone||['flow','configuration','designer','wizard'].includes(ui.view)))render();
}
function ensureStepResources(){
 if(ui.clone){if(syncResourceSession()&&!resourceStates.has('divisions'))void loadResources('divisions');return;}
 if(ui.view==='wizard'&&ui.wizard&&ui.wizard.step<4&&syncResourceSession()){
  const {step,form}=ui.wizard,kinds=new Set();
  if(step===0&&wizardContext().options.catalogue.some(e=>e.type==='inboundcall'&&e.divisionSchema))kinds.add('divisions');
  if(step===1&&form.audioModes.WELCOME_AUDIO==='recorded'||step===2&&form.audioModes.menuAudio==='recorded')kinds.add('prompts');
  if(step===2&&form.scheduleEnabled)kinds.add('schedules');
  if(step===3)kinds.add('queues');
  for(const kind of kinds)if(!resourceStates.has(kind))void loadResources(kind);
  return;
 }
 if(ui.view==='designer'&&ui.designer&&!ui.designer.review&&syncResourceSession()){
  const {form}=ui.designer,entry=designerContext().options.catalogue.find(c=>c.tableId===form.tableId);
  const kinds=[...new Set((entry?.fields||[]).map(field=>{const spec=resourceForField(field.key,{tableName:entry.tableName});return spec&&(!spec.audio||form.audioModes[field.key]==='recorded')?spec.catalogue:null;}).filter(Boolean))];
  if(ui.designer.mode==='create'&&entry?.divisionSchema&&!kinds.includes('divisions'))kinds.push('divisions');
  for(const kind of kinds)if(!resourceStates.has(kind))void loadResources(kind);
  return;
 }
 if(!syncResourceSession()||!['flow','configuration'].includes(ui.view)||ui.view==='flow'&&ui.journeyView!=='step')return;
 const node=current()?.nodes[ui.node];if(!node)return;
 const kinds=[...new Set(visibleStepFields(node).filter(field=>field.resource).map(field=>field.resource.catalogue))];
 for(const kind of kinds)if(!resourceStates.has(kind))void loadResources(kind);
}
function fieldInput(field,index){const node=current()?.nodes[ui.node];return stepFieldView(field,index,{node,pending:ui.pendingFields.get(node.id)||{},snapshot:applyDraftRows(ui.snapshot,ui.drafts),resourceStates,connected:!!getAccessToken(),admin:ui.audience==='admin',advanced:ui.advancedFields?.has(node.id+':'+field.key)});}

function visibleStepFields(node){return ui.audience==='admin'?usefulFields(node):businessInspectorModel(node).groups.flatMap(group=>group.fields);}
function nodeEditor(node,f){
 if(!node)return empty('Étape introuvable','Revenez à la vue d’ensemble du parcours.');
 const admin=ui.audience==='admin',model=businessInspectorModel(node);
 const pending=ui.pendingFields.get(node.id)||{};
 const branchFields=admin?usefulFields(node):model.fields;
 const branchModel=businessBranches(node,branchFields,pending,ui.onlyConfigured);
 const allBusinessFields=model.fields;
 model.groups=model.groups.map(group=>({...group,fields:configuredStepFields(group.fields,pending,ui.onlyConfigured)})).filter(group=>group.fields.length);model.fields=model.groups.flatMap(group=>group.fields);
 const fields=admin?configuredStepFields(usefulFields(node),pending,ui.onlyConfigured):model.fields,index=f.nodes.findIndex(n=>n.id===node.id),shared=affectedFlows(node.id),configurationNotes=model.notes;
 const sourceNode=ui.inventory.flows.flatMap(flow=>flow.nodes).find(candidate=>candidate.id===node.id)||node;
 const groupHtml=admin?`<div class="field-grid">${fields.filter(field=>!branchModel.claimed.has(field.key)).map(field=>fieldInput(field,branchFields.findIndex(f=>f.key===field.key))).join('')}</div>`+businessBranchView(branchModel,ui.businessBranches?.[node.id],field=>fieldInput(field,branchFields.findIndex(f=>f.key===field.key)),pending,{admin:true}):model.groups.map(group=>({...group,fields:group.fields.filter(field=>!branchModel.claimed.has(field.key))})).filter(group=>group.fields.length).map(group=>`<section class="business-setting-group"><h3>${esc(group.title)}</h3><div class="field-grid">${group.fields.map(field=>fieldInput(field,allBusinessFields.findIndex(f=>f.key===field.key))).join('')}</div></section>`).join('')+businessBranchView(branchModel,ui.businessBranches?.[node.id],field=>fieldInput(field,allBusinessFields.findIndex(f=>f.key===field.key)),pending,{routing:false});
 return `<section class="editor-card journey-editor ${admin?'admin-editor':'business-editor'}"><header><div><div class="eyebrow">${admin?'CONFIGURATION WOLF':esc(node.label)}</div><h2 id="step-title" tabindex="-1">${esc(audienceNodeTitle(node,ui.audience))}</h2></div><span id="step-save-status">${ui.pendingFields.has(node.id)?tag('À enregistrer','amber'):ui.drafts.has(node.id)?tag('Brouillon','amber'):''}</span></header>
 ${shared.length>1?notice(`Cette étape est utilisée par <strong>${shared.length} parcours</strong>. Une modification concerne chacun d’eux. <details><summary>Voir les parcours concernés</summary>${shared.map(x=>`<div>${esc(displayTitle(x))}</div>`).join('')}</details>`):''}
 ${configurationNotes.length?notice(`<strong>Réglage à vérifier</strong>${configurationNotes.map(note=>`<p>${esc(note.message)}</p>${admin?`<details><summary>Voir la valeur source</summary><code>${esc(note.detail)}</code></details>`:''}`).join('')}${admin?'':btn('Examiner en Administration','set-audience','quiet small','data-audience="admin"')}`,'warning'):''}
 ${admin?`<div class="admin-inspector-tabs" role="group" aria-label="Détail administrateur">${btn('Réglages avancés','admin-panel',ui.adminPanel==='settings'?'active':'',`data-panel="settings" aria-pressed="${ui.adminPanel==='settings'}"`)}${btn('Données WOLF','admin-panel',ui.adminPanel==='source'?'active':'',`data-panel="source" aria-pressed="${ui.adminPanel==='source'}"`)}</div>`:''}
 ${admin&&ui.adminPanel==='source'?adminSourceDetails({node,sourceNode,pending:ui.pendingFields.get(node.id),query:ui.adminQuery}):`${!admin&&model.summary?`<div class="business-step-summary"><span>À cette étape</span><p>${esc(model.summary)}</p></div>`:''}
 ${admin?stepRelations(f,node.id,'incoming',{audience:ui.audience})+stepRelations(f,node.id,'usedBy',{audience:ui.audience}):''}
 ${admin?`<label class="configured-fields-filter"><input type="checkbox" id="configured-fields-only" ${ui.onlyConfigured?'checked':''}> Réglages renseignés uniquement</label><p class="helper">Désactivez pour afficher et renseigner les champs vides.</p>`:''}
 <form class="node-form" data-node="${index}">${admin?'<h3 class="step-settings-heading">Réglages avancés</h3>':''}${fields.length?groupHtml:'<p class="helper">Les suites de cette étape sont présentées ci-dessous.</p>'}</form>
 ${admin?stepRelations(f,node.id,'outgoing',{audience:ui.audience})+stepRelations(f,node.id,'attachments',{audience:ui.audience})+stepRelations(f,node.id,'contexts',{audience:ui.audience}):''}
 ${!admin?`<div class="business-admin-link">${btn(ui.onlyConfigured?'Afficher les réglages vides':'Masquer les réglages vides','toggle-configured','quiet small',`aria-pressed="${!ui.onlyConfigured}"`)}${btn('Voir les détails WOLF','set-audience','quiet small','data-audience="admin" data-panel="source"')}</div>`:''}`}
 </section>`;
}
function audienceSwitch(){return `<div class="audience-switch" role="group" aria-label="Vue du parcours">${[['business','Métier','people'],['admin','Administration','code']].map(([key,label,glyph])=>btn(icon(glyph)+label,'set-audience',ui.audience===key?'active':'',`data-audience="${key}" aria-label="Vue ${label}" aria-pressed="${ui.audience===key}"`)).join('')}</div>`;}
function canvasAllLinks(){return ui.audience==='admin'&&ui.canvasAllLinks;}
function journeyOptions(f){return {audience:ui.audience,selectedId:f.nodes[ui.node]?.id,overview:ui.journeyView==='overview',query:ui.stepQuery,hasDraft:id=>ui.drafts.has(id)};}
function businessOptions(){return {task:ui.businessTask,query:ui.businessQuery,selected:ui.journeyView==='step'?ui.node:-1,pending:ui.pendingFields,drafts:ui.drafts};}
function journeyWorkspace(f){
 const selected=f.nodes[ui.node];
 if(ui.audience==='business')return businessWorkspace(f,businessOptions(),ui.journeyView==='step'?`<aside class="studio-inspector business-quick-editor" aria-label="Réglages de l’étape"><div class="inspector-top"><span>Modifier cette étape</span>${btn(icon('close'),'journey-overview','quiet small','aria-label="Fermer les réglages"')}</div><div class="inspector-body">${nodeEditor(selected,f)}</div><div class="inspector-footer"><span class="helper">Modifications non publiées</span>${btn(icon('check')+' Enregistrer le brouillon','save-node','primary',`data-node="${ui.node}"`)}</div></aside>`:'');
 const layout=diagramLayout(f,{allLinks:canvasAllLinks()});
 return `<div class="studio-workspace audience-${ui.audience} ${ui.navCollapsed?'nav-collapsed':'nav-open'} ${ui.journeyView==='overview'?'inspector-closed':''}">
 ${journeyNavigation(f,journeyOptions(f))}
 <section class="studio-canvas" aria-label="Carte du parcours"><div class="studio-canvas-toolbar"><div class="studio-canvas-title">${btn(icon('menu'),'toggle-steps','quiet small',`aria-label="${ui.navCollapsed?'Afficher':'Masquer'} les étapes" title="${ui.navCollapsed?'Afficher':'Masquer'} les étapes" aria-pressed="${!ui.navCollapsed}"`)}<strong>Carte du parcours</strong><span>${plural(layout.nodes.length,'étape')} visible${layout.nodes.length>1?'s':''}</span></div><div class="studio-canvas-actions">${ui.audience==='admin'?`<div class="canvas-modes" role="group" aria-label="Niveau de détail du parcours">${btn('Parcours','canvas-main',ui.canvasAllLinks?'':'active',`aria-pressed="${!ui.canvasAllLinks}"`)}${btn('Toutes les liaisons','canvas-all',ui.canvasAllLinks?'active':'',`aria-pressed="${ui.canvasAllLinks}"`)}</div>`:''}${btn('−','zoom-out','quiet small','aria-label="Réduire le parcours"')}<span id="zoom-value">${Math.round(ui.zoom*100)} %</span>${btn('+','zoom-in','quiet small','aria-label="Agrandir le parcours"')}${btn('Tout voir','zoom-fit','secondary small')}${btn(icon('search'),'center-step','quiet small','aria-label="Recentrer sur l’étape" title="Recentrer sur l’étape"')}</div></div>
 <div class="studio-canvas-body">${journeyDiagram(f,{selectedIndex:ui.journeyView==='step'?ui.node:null,zoom:ui.zoom,allLinks:canvasAllLinks(),layout})}</div><div class="studio-canvas-footer"><span>${icon('link')} ${ui.audience==='business'?'Messages, conditions et équipes du parcours':layout.hiddenLinksCount?`${layout.hiddenLinksCount} liens de file et d’attente consultables dans les réglages`:'Toutes les liaisons de routage affichées'}</span><span>Glisser pour déplacer la carte · cliquer une étape pour l’ouvrir</span></div></section>
 ${ui.journeyView==='step'?`<aside class="studio-inspector" aria-label="Réglages de l’étape"><div class="inspector-top"><span>${icon(ui.audience==='admin'?'code':'people')} ${ui.audience==='admin'?'Configuration de l’étape':'Réglages de l’étape'}</span>${btn(icon('close'),'journey-overview','quiet small','aria-label="Fermer les réglages"')}</div><div class="inspector-body">${nodeEditor(selected,f)}</div>${selected&&(visibleStepFields(selected).some(x=>x.editable||x.resource)||ui.pendingFields.has(selected.id))&&!(ui.audience==='admin'&&ui.adminPanel==='source')?`<div class="inspector-footer"><span class="helper">Modifications non publiées</span>${btn(icon('check')+' Enregistrer le brouillon','save-node','primary',`data-node="${ui.node}"`)}</div>`:''}</aside>`:''}
 </div>`;
}
function openStep(index){
 const f=current();if(!f.nodes[Number(index)])return;
 ui.node=Number(index);ui.adminQuery='';ui.journeyView='step';if(window.innerWidth<=1000)ui.navCollapsed=true;ui.error='';render();
 const title=$('#step-title');title?.focus({preventScroll:true});
 if($('.inspector-body'))$('.inspector-body').scrollTop=0;
 requestAnimationFrame(()=>centerStep(false));
}
function studioReference(f,r){
 if(r.role==='reference')return `${icon('layers')}<span>Core Model <strong>${esc(r.model.name)}</strong></span>${tag('Version '+r.version.label,'orange')}`;
 if(r.role==='declination')return `${icon('layers')}<span>Référence <strong>${esc(r.model.name)}</strong></span>${tag('Version '+r.base.label,'neutral')}`;
 return `${icon('layers')}<span>Référence du parcours <strong>Non déclarée</strong></span>`;
}
function flowPage(){
 const f=current();if(!f)return empty('Parcours introuvable','Revenez à la liste des parcours.');
 const r=role(f.id),isReference=r.role==='reference',missing=unresolvedReferences(f).length;
 const back=isReference?`data-model="${esc(r.model.id)}"`:`data-view="${r.role==='none'&&f.category==='template'?'references':'catalogue'}"`;
 const draftCount=f.nodes.filter(n=>ui.drafts.has(n.id)).length;
 return `<header class="studio-header"><div class="studio-heading-group">${btn(icon('undo'),isReference?'open-model':'nav','quiet studio-back',back+' aria-label="Revenir aux parcours" title="Revenir aux parcours"')}<div class="studio-heading"><div class="studio-kicker">${isReference?'CORE MODEL':r.role==='declination'?'PARCOURS D’ENTITÉ':'PARCOURS VOIX'}<span>${ui.audience==='admin'?'VUE ADMINISTRATION':'VUE MÉTIER'}</span></div><h1 title="${esc(displayTitle(f))}">${esc(displayTitle(f))}</h1><div class="studio-meta">${esc([humanText(f.division)||'Entité non renseignée',/^\+?\d[\d ]+$/.test(f.key)?f.key:null].filter(Boolean).join(' · '))}</div></div></div><div class="page-actions">${btn(icon('database')+' Données du parcours','flow-data-open','secondary small')}${btn(icon('play')+' Simuler un appel','simulation-open','secondary small')}${btn(icon('diff')+' Avant / après l’appel','call-compare-open','secondary small')}${ui.liveActivity?.enabled?liveActivityToggle(true):''}<details class="action-menu"><summary class="btn secondary small">Plus d’actions ${icon('down')}</summary><div class="action-menu-list">${btn(icon('shield')+' Contrôler la configuration','quality-open','quiet small')}${btn(icon('layers')+' Comparer avec un autre parcours','compare-flow','quiet small',`data-index="${ui.flow}"`)}${ui.liveActivity?.enabled?'':liveActivityToggle(false)}${btn(icon('phone')+' Activité du numéro','open-activity','quiet small',`data-index="${ui.flow}"`)}</div></details>${isReference?btn(icon('copy')+' Créer un parcours','clone-start','primary small'):btn(icon('copy')+' Reprendre depuis…','copy-start','primary small')}</div></header>
 <div class="studio-context"><div class="studio-reference">${studioReference(f,r)}</div>${audienceSwitch()}<div class="studio-context-actions">${draftCount?tag(plural(draftCount,'étape')+' en brouillon','amber'):''}${missing?tag(plural(missing,'destination')+' à vérifier','amber','alert'):''}${r.role==='declination'?btn('Voir l’impact','impact-open','quiet small',`data-id="${esc(f.id)}"`):''}${ui.audience==='admin'?btn(r.role==='none'?'Définir la référence':'Gérer la référence','declare-start','quiet small',`data-id="${esc(f.id)}"`):''}</div></div>
 ${ui.audience==='admin'?`<div class="designer-launchbar"><div><strong>Structure du parcours</strong><span>Ajout d’un bloc ou modification d’une liaison.</span></div><div>${btn('+ Ajouter un bloc','designer-insert','primary small')}${btn(icon('link')+' Raccorder les étapes','designer-connect','secondary small')}</div></div>`:''}
 ${ui.liveActivity?.enabled?`<div class="live-map-workspace">${liveActivityView(ui.liveActivity)}</div>`:journeyWorkspace(f)}`;
}
function centerStep(force=true){
 const viewport=$('#graph-viewport');if(!viewport)return;
 const model=diagramLayout(current(),{allLinks:canvasAllLinks()});if(!model.ready)return;
 const selected=current().nodes[ui.node],owner=current().edges.find(e=>e.to===selected?.id&&model.nodes.some(n=>n.id===e.from)),node=model.nodes.find(n=>n.index===ui.node)||model.nodes.find(n=>n.id===owner?.from)||model.nodes[0];if(!node)return;
 const x=(node.x+(node.width||240)/2)*ui.zoom,y=(node.y+(node.height||130)/2)*ui.zoom;
 if(force||x<viewport.scrollLeft+100||x>viewport.scrollLeft+viewport.clientWidth-100||y<viewport.scrollTop+80||y>viewport.scrollTop+viewport.clientHeight-80)viewport.scrollTo({left:Math.max(0,x-viewport.clientWidth/2),top:Math.max(0,y-viewport.clientHeight/2)});
}
function setCanvasZoom(zoom,minimum=.15){
 const viewport=$('#graph-viewport'),canvas=$('#journey-canvas');if(!viewport||!canvas)return;
 const old=ui.zoom,x=(viewport.scrollLeft+viewport.clientWidth/2)/old,y=(viewport.scrollTop+viewport.clientHeight/2)/old;
 ui.zoom=Math.max(minimum,Math.min(1.5,zoom));const model=diagramLayout(current(),{allLinks:canvasAllLinks()});
 canvas.style.transform=`scale(${ui.zoom})`;canvas.parentElement.style.width=`${model.width*ui.zoom}px`;canvas.parentElement.style.height=`${model.height*ui.zoom}px`;
 $('#zoom-value').textContent=Math.round(ui.zoom*100)+' %';viewport.scrollTo({left:Math.max(0,x*ui.zoom-viewport.clientWidth/2),top:Math.max(0,y*ui.zoom-viewport.clientHeight/2)});
}

function picker(slot,label){const index=ui[slot];const f=index!==null?flowAt(index):null;const side=slot==='left'?'source':'cible';return `<div class="picker-card" data-side="${side}"><div class="picker-copy"><div class="eyebrow">${label}</div><h2>${f?esc(displayTitle(f)):'Choisir un parcours'}</h2><p>${f?esc(flowMeta(f)):slot==='left'?'Le parcours qui fournit les valeurs à copier.':'Le parcours dans lequel préparer les changements.'}</p></div>${btn(f?'Changer':'Choisir','pick-open','secondary small',`data-slot="${slot}" aria-label="${f?'Changer':'Choisir'} le parcours ${side}"`)}</div>`;}
function pickerOptions(){const flows=ui.inventory.flows.map((_,i)=>({f:flowAt(i),i})).filter(({i})=>ui.picker==='left'?i!==ui.right:i!==ui.left).filter(({f})=>normalizeSelectSearch([displayTitle(f),f.key,f.division,f.dnis].join(' ')).includes(normalizeSelectSearch(ui.pickerQuery)));return flows.map(({f,i})=>`<button class="picker-option" data-action="pick-flow" data-index="${i}"><span class="flow-symbol">${icon(role(f.id).role==='reference'?'layers':'phone')}</span><span><strong>${esc(displayTitle(f))}</strong><small>${esc(flowMeta(f))}</small></span><span class="picker-tags">${categoryTag(f)}</span>${icon('chevron')}</button>`).join('')||'<p>Aucun parcours ne correspond à votre recherche.</p>';}
function pickerView(){return `<section class="settings-panel flow-picker-panel"><div class="section-heading"><div><h2>${ui.picker==='left'?'Choisir le parcours source':'Choisir le parcours cible'}</h2><p>${ui.picker==='left'?'Choisissez le parcours qui fournit les blocs et les réglages à reprendre.':'Choisissez le parcours dans lequel préparer vos adaptations.'}</p></div>${btn('Annuler','pick-close','quiet')}</div><div class="search">${icon('search')}<input id="picker-search" aria-label="Rechercher dans les parcours" placeholder="Nom du parcours, entité ou numéro…" value="${esc(ui.pickerQuery)}"></div><div class="flow-picker-list" id="picker-options">${pickerOptions()}</div></section>`;}
function comparisonSession(){
 const left=flowAt(ui.left),right=flowAt(ui.right);if(ui.left===null||ui.right===null||!left||!right)return null;
 const key=JSON.stringify([left.id,right.id]);
 if(!ui.comparisonSessions.has(key))ui.comparisonSessions.set(key,{decisions:{},mappings:{},review:false,reviewSignature:null,mappingOpen:false,query:'',section:'blocks',blockDecisions:{},blockReview:false,blockSignature:null,blockPrefix:'bloc-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)});
 return ui.comparisonSessions.get(key);
}
function comparisonContext(){
 const session=comparisonSession();if(!session)return null;
 const left=flowAt(ui.left),right=flowAt(ui.right);
 const diff=compareFlows(left,right,{seedMatches:Object.entries(session.mappings)});
 const choices=comparisonChoices(diff,left,right);
 const plan=prepareComparisonPlan({left,right,diff,decisions:session.decisions,snapshot:ui.snapshot});
 for(const change of plan.changes)change.sharedNames=affectedFlows(change.nodeId).filter(f=>f.id!==right.id).map(displayTitle);
 return {left,right,diff,choices,session,plan};
}
function mappingRows(context){
 const {left,right,diff,session}=context;
 return left.nodes.map(node=>{const match=diff.matches.find(pair=>pair.leftNode.id===node.id);return {leftId:node.id,leftTitle:nodeTitle(node),typeLabel:node.label,rightId:match?.rightNode.id||'',rightTitle:match?nodeTitle(match.rightNode):'',reason:match?.reason||'',explicitId:session.mappings[node.id]||'',manual:Boolean(session.mappings[node.id]),options:right.nodes.filter(candidate=>candidate.type===node.type).map(candidate=>({id:candidate.id,title:nodeTitle(candidate)}))};});
}
function compareView(){
 const context=comparisonContext();
 const header=head('COMPARAISON','Comparer des parcours','Blocs à insérer et réglages à reprendre d’un parcours source vers un parcours cible.');
 if(ui.picker)return header+pickerView();
 const pickers=`<div class="compare-pickers">${picker('left','SOURCE · COPIER DEPUIS')}${picker('right','CIBLE · MODIFIER CE PARCOURS')}</div>`;
 if(!context)return header+pickers+empty('Choisissez la source et le parcours à adapter','Vous pourrez choisir les blocs à insérer, puis les réglages à reprendre.');
 const {session,left,right,diff,choices,plan}=context;
 const blocks=blockContext(context);
 const section=session.section||'blocks';
 const tabs=`<nav class="comparison-switch" aria-label="Comparer les blocs ou les réglages">${[['blocks','Blocs du parcours',blocks.candidates.length],['values','Réglages',choices.length]].map(([key,label,count])=>`<button class="${section===key?'selected':''}" data-action="comparison-section" data-section="${key}" aria-pressed="${section===key}">${label} <span>${count}</span></button>`).join('')}</nav>`;
 const body=section==='blocks'?blockComparisonWorkspace({left,right,diff,candidates:blocks.candidates,decisions:session.blockDecisions,plans:blocks.plan.plans,plan:blocks.plan,review:session.blockReview})+blockFooter(blocks):comparisonWorkspace({left,right,leftTitle:displayTitle(left),rightTitle:displayTitle(right),diff,choices,decisions:session.decisions,plan,review:session.review,mappingOpen:session.mappingOpen,mappingRows:mappingRows(context),query:session.query});
 return header+pickers+tabs+body;
}
function blockContext(context=comparisonContext()){
 if(!context)return null;
 const {left,right,diff,session}=context;
 const snapshot=applyDraftRows(ui.snapshot,ui.drafts);
 const candidates=blockCandidates({snapshot,left,right,diff});
 const plan=prepareBlockPlan({snapshot,left,right,diff,decisions:session.blockDecisions||{},prefix:session.blockPrefix});
 for(const summary of plan.summaries||[]){const candidate=candidates.find(item=>item.id===summary.sourceNodeId);const label=candidate?.options?.placements.find(item=>item.id===summary.placementId)?.label;if(label){summary.placementLabel=label;if(plan.plans?.[summary.sourceNodeId]?.summary)plan.plans[summary.sourceNodeId].summary.placementLabel=label;}}
 for(const summary of plan.summaries||[])summary.sharedNames=[...new Set((plan.updatedRows||[]).flatMap(({node})=>affectedFlows(node.id).filter(flow=>flow.id!==right.id).map(displayTitle)))];
 return {...context,snapshot,candidates,plan};
}
function blockFooter(context){
 const {session,plan}=context,selected=Object.values(session.blockDecisions||{}).filter(decision=>decision.mode==='insert').length;
 const visibleIds=new Set(context.candidates.map(candidate=>candidate.id));
 const errors=(plan.errors||[]).filter(error=>!visibleIds.has(error.id)||!(plan.plans?.[error.id]?.errors||[]).some(item=>item.message===error.message));
 const shared=[...new Set((plan.summaries||[]).flatMap(summary=>summary.sharedNames||[]))];
 const alerts=(errors.length?`<div class="error-box" role="alert">${errors.map(error=>`<p>${esc(error.message)} ${session.blockDecisions[error.id]?btn('Ignorer ce choix','block-ignore','secondary small',`data-id="${esc(error.id)}"`):''}</p>`).join('')}</div>`:'')+(session.blockReview&&shared.length?notice('Ces raccordements concernent aussi : '+shared.map(esc).join(', '),'warning'):'');
 return alerts+`<div class="comparison-bottom-bar"><div><strong>${selected} bloc${selected>1?'s':''} choisi${selected>1?'s':''}</strong><span>${plan.errors?.length?`${plural(plan.errors.length,'raccordement')} à préciser`:'Les autres blocs de la cible sont conservés.'}</span></div><div>${session.blockReview?btn('Modifier les choix','block-edit','secondary')+btn('Insérer dans le brouillon','block-apply','primary',plan.errors?.length||!selected?'disabled':''):btn('Tout ignorer','block-reset','quiet',!selected?'disabled':'')+btn('Voir les insertions','block-review','primary',!selected?'disabled':'')}</div></div>`;
}
function blockSignature(plan){return JSON.stringify({createdRows:plan.createdRows,updatedRows:(plan.updatedRows||[]).map(({node,row})=>({id:node.id,row}))});}
function chooseBlock(id,insert){
 const context=blockContext();if(!context)throw Error('Choisissez les deux parcours.');
 const session=context.session;
 if(!insert)delete session.blockDecisions[id];
 else {const candidate=context.candidates.find(item=>item.id===id);if(!candidate?.options?.canInsert)throw Error(candidate?.options?.reason||'Ce bloc ne peut pas être inséré ici.');session.blockDecisions[id]||={mode:'insert',placementId:'',connections:{}};}
 session.blockReview=false;session.blockSignature=null;ui.error='';render();
}
function reviewBlocks(){
 const context=blockContext();if(!context)throw Error('Choisissez les deux parcours.');
 if(context.plan.errors.length){ui.error='Précisez les raccordements des blocs choisis.';context.session.blockReview=false;render();return;}
 if(!context.plan.createdRows.length)throw Error('Choisissez au moins un bloc à insérer.');
 context.session.blockReview=true;context.session.blockSignature=blockSignature(context.plan);ui.error='';render();window.scrollTo({top:0});focusPage();
}
function applyBlocks(){
 const context=blockContext();if(!context)throw Error('Choisissez les deux parcours.');
 const {plan,session,right}=context;
 if(!session.blockReview||plan.errors.length||!plan.createdRows.length||session.blockSignature!==blockSignature(plan))throw Error('Les raccordements ont changé. Vérifiez de nouveau les insertions.');
 const nextSnapshot=normalizeSnapshot({...ui.snapshot,tables:ui.snapshot.tables.map(table=>({...table,rows:[...table.rows,...plan.createdRows.filter(addition=>addition.tableId===table.id).map(addition=>addition.row)]}))});
 const nextDrafts=new Map(ui.drafts);
 for(const {node,row} of plan.updatedRows){
  if(ui.pendingFields.has(node.id))throw Error('Enregistrez d’abord la saisie en cours sur « '+nodeTitle(node)+' ».');
  const original=nextSnapshot.tables.find(table=>table.id===node.tableId)?.rows.find(item=>String(item.key)===node.key);
  if(!original)throw Error('Le raccordement d’origine est introuvable. Aucune insertion n’a été appliquée.');
  if(same(original,row))nextDrafts.delete(node.id);else nextDrafts.set(node.id,{nodeId:node.id,tableId:node.tableId,table:node.tableName,key:node.key,original,row:structuredClone(row),label:nodeTitle(node)});
 }
 const projected=workingInventory(nextSnapshot,nextDrafts);
 for(const nodeId of ui.pendingFields.keys())if(effectiveInventory().flows.some(flow=>flow.nodes.some(node=>node.id===nodeId)&&!projected.flows.find(candidate=>candidate.id===flow.id)?.nodes.some(node=>node.id===nodeId)))throw Error('Une étape comporte une saisie non enregistrée. Enregistrez-la avant de modifier les raccordements.');
 ui.snapshot=nextSnapshot;ui.inventory=buildVoiceInventory(nextSnapshot);ui.drafts=nextDrafts;ui.draftRevision++;
 for(const summary of plan.summaries){for(const mapping of summary.mappings){const source=context.left.nodes.find(node=>node.id===mapping.sourceNodeId);mapping.title=source?nodeTitle(source):humanText(mapping.oldKey);}ui.blockCreations.set(summary.mappings[0].nodeId,structuredClone(summary));for(const mapping of summary.mappings)session.mappings[mapping.sourceNodeId]=mapping.nodeId;}
 session.blockDecisions={};session.blockReview=false;session.blockSignature=null;
 record(`${plural(plan.summaries.length,'bloc inséré','blocs insérés')} dans ${displayTitle(right)}`);go('changes');toast('Les blocs choisis et leurs raccordements ont été ajoutés au brouillon.');
}
function insertedBlockViews(){return [...ui.blockCreations.values()].map(block=>`<section class="settings-panel"><div class="eyebrow">BLOC AJOUTÉ · BROUILLON</div><h2>${esc(block.title)}</h2><p>${esc(block.placementLabel)}</p><p>${block.nodeCount} élément${block.nodeCount>1?'s':''} ajouté${block.nodeCount>1?'s':''} au parcours.</p>${block.notices?.length?`<details class="details"><summary>Points à vérifier</summary>${block.notices.map(note=>`<p>${esc(note)}</p>`).join('')}</details>`:''}${btn('Ouvrir le parcours','open-flow','secondary small',`data-index="${ui.inventory.flows.findIndex(flow=>flow.id===block.targetFlowId)}"`)}</section>`).join('');}
function copyView(){return compareView();}
function changeDecision(id,mode){
 const context=comparisonContext();if(!context)throw Error('Choisissez les deux parcours.');
 if(mode==='keep'){delete context.session.decisions[id];context.session.review=false;context.session.reviewSignature=null;ui.error='';render();return;}
 const choice=context.choices.find(item=>item.id===id);if(!choice)throw Error('Cette différence a changé. Reprenez la comparaison.');
 if(mode==='copy'&&!choice.canCopy)throw Error(choice.copyReason||'Cette reprise nécessite un rapprochement des étapes.');
 if(mode==='edit'&&!choice.canEdit)throw Error(choice.editReason||'Ouvrez les réglages de cette étape.');
 const session=context.session;
 session.decisions[id]={mode,...(mode==='edit'?{value:session.decisions[id]?.mode==='edit'?session.decisions[id].value:choice.value}: {})};
 session.review=false;session.reviewSignature=null;ui.error='';render();
 if(mode==='edit')$$('[name="comparison-value"]').find(input=>input.dataset.id===id)?.focus({preventScroll:true});
}
function reviewComparison(){
 const context=comparisonContext();if(!context)throw Error('Choisissez les deux parcours.');
 if(context.plan.errors.length){ui.error='Certains choix doivent être précisés avant de continuer.';context.session.review=false;render();return;}
 if(!context.plan.changes.length)throw Error('Choisissez au moins une modification effective.');
 context.session.review=true;context.session.reviewSignature=JSON.stringify(context.plan.rows);ui.error='';render();window.scrollTo({top:0});focusPage();
}
function applyComparison(){
 const context=comparisonContext();if(!context||!context.session.review)throw Error('Relisez les changements avant de créer le brouillon.');
 const {session,plan,left,right}=context;
 if(plan.errors.length||!plan.changes.length||session.reviewSignature!==JSON.stringify(plan.rows))throw Error('Les réglages ont changé. Revenez à vos choix puis vérifiez à nouveau le résultat.');
 const nextDrafts=new Map(ui.drafts);
 for(const {node,row} of plan.rows){
  if(ui.pendingFields.has(node.id))throw Error('Une saisie est encore en cours sur « '+nodeTitle(node)+' ». Enregistrez-la dans le parcours avant d’appliquer cette sélection.');
  const original=ui.snapshot.tables.find(t=>t.id===node.tableId)?.rows.find(r=>String(r.key)===node.key);
  if(!original)throw Error('La configuration d’origine est introuvable. Aucun changement n’a été appliqué.');
  if(same(original,row))nextDrafts.delete(node.id);
  else nextDrafts.set(node.id,{nodeId:node.id,tableId:node.tableId,table:node.tableName,key:node.key,original,row:structuredClone(row),label:nodeTitle(node)});
 }
 // Validate the whole projected graph before committing any row to this session.
 const projected=workingInventory(ui.snapshot,nextDrafts);
 for(const nodeId of ui.pendingFields.keys()){
  const removedFrom=effectiveInventory().flows.find(flow=>flow.nodes.some(node=>node.id===nodeId)&&!projected.flows.find(candidate=>candidate.id===flow.id)?.nodes.some(node=>node.id===nodeId));
  if(removedFrom)throw Error('Cette adaptation retirerait du parcours une étape avec une saisie non enregistrée. Enregistrez cette saisie avant de poursuivre.');
 }
 ui.drafts=nextDrafts;ui.draftRevision++;session.decisions={};session.review=false;session.reviewSignature=null;
 record(`${plural(plan.changes.length,'adaptation choisie','adaptations choisies')} de ${displayTitle(left)} vers ${displayTitle(right)}`);
 go('changes');toast('Seuls les changements choisis ont été enregistrés dans le brouillon.');
}
function changeValue(change,side){
 if(/_TARGET$/.test(change.field)){
  const inventory=side==='before'?ui.inventory:effectiveInventory();
  const flow=inventory.flows.find(flow=>flow.nodes.some(node=>node.id===change.nodeId));
  const routes=flow?flowRoutes(flow).filter(route=>route.fromId===change.nodeId&&route.edge.destinationField===change.field):[];
  if(routes.length)return routes.map(route=>route.relationship==='context'?'Informations : '+route.toTitle:route.toTitle).join(' · ');
 }
 return describeValue(change.field,change[side]);
}
function changesView(){const changes=draftChanges();return head('BROUILLONS','Mes changements',changes.length||ui.creations.size||ui.blockCreations.size?[ui.creations.size&&plural(ui.creations.size,'parcours créé','parcours créés'),ui.blockCreations.size&&plural(ui.blockCreations.size,'bloc ajouté','blocs ajoutés'),changes.length&&plural(changes.length,'réglage adapté','réglages adaptés')].filter(Boolean).join(' · ')+'.':'Brouillons en attente de publication dans Genesys.',changes.length||ui.creations.size||ui.blockCreations.size?btn(icon('download')+' Exporter','export-changes','secondary')+btn(icon('upload')+' Publier dans Genesys','publication-open','primary'):btn('Historique des publications','publication-open','secondary'))+createdViews()+insertedBlockViews()+(changes.length?`<div class="notice">${icon('clock')}<div><strong>Modifications non publiées.</strong><br>Les parcours en service ne sont pas modifiés.</div></div><div class="diff-heading"><span>Réglage</span><span>Version lue</span><span>Votre brouillon</span></div><section class="diff-group">${changes.map(d=>`<div class="diff-row"><div class="diff-label"><strong>${esc(fieldLabel(d.field))}</strong><small>${esc(d.label)}</small><small>${affectedFlows(d.nodeId).length?plural(affectedFlows(d.nodeId).length,'parcours concerné','parcours concernés'):'Configuration associée · portée à vérifier'}</small></div><div class="diff-before">${esc(changeValue(d,'before'))}</div><div class="diff-after">${esc(changeValue(d,'after'))}</div></div>`).join('')}</section><div class="review-bar"><span>Ces brouillons restent modifiables depuis chaque parcours.</span>${btn('Annuler ces adaptations','discard-start','quiet')}</div>${ui.discard?notice(`Annuler ${plural(changes.length,'modification')}${ui.blockCreations.size?' et '+plural(ui.blockCreations.size,'bloc ajouté','blocs ajoutés'):''} ? ${btn('Conserver','discard-cancel','secondary small')} ${btn('Annuler les adaptations','discard-confirm','small')}`,'warning'):''}`:ui.creations.size||ui.blockCreations.size?`<div class="review-bar">${btn('Annuler ces adaptations','discard-start','quiet')}</div>${ui.discard?notice(`Annuler les créations non publiées ? ${btn('Conserver','discard-cancel','secondary small')} ${btn('Annuler les adaptations','discard-confirm','small')}`,'warning'):''}`:empty('Aucun brouillon en attente','Les réglages modifiés dans un parcours s’affichent ici avant leur publication.',btn('Voir les parcours','nav','primary','data-view="catalogue"')))+(ui.audit.length?`<section class="audit-list"><h2>Activité de cette session</h2>${ui.audit.map(a=>`<div class="audit-entry">${icon('clock')}<div><strong>${esc(a.message)}</strong><small>${new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date(a.at))}</small></div></div>`).join('')}</section>`:'');}
function createdViews(){return [...ui.creations.entries()].map(([id,c])=>`<section class="settings-panel"><div class="eyebrow">NOUVEAU PARCOURS · BROUILLON</div><h2>${esc(c.name)}</h2><p>${c.kind==='new-flow'?'Parcours créé dans le designer WOLF V5.':`${c.nodeCount} étapes et leurs embranchements repris depuis le Core Model.`}</p><p>${plural(c.referencesRetained.length,'ressource associée conservée','ressources associées conservées')} · ${plural(c.needsReview.length,'point')} à vérifier.</p>${btn('Ouvrir le parcours','open-flow','secondary small',`data-index="${ui.inventory.flows.findIndex(f=>f.id===id)}"`)}</section>`).join('');}
function settingsView(){const config=getAuthConfig();return head('SOURCE DES DONNÉES','Connexion à Genesys','Chargement des parcours voix depuis Genesys Cloud ou depuis un export local.')+`<section class="settings-panel"><div class="connection-state">${icon('link')}<div><h2>Genesys Cloud · Dublin</h2><p>${getAccessToken()?'Compte Genesys connecté.':'Connexion avec un compte Genesys autorisé à lire les Data Tables WOLF.'}</p></div>${tag(getAccessToken()?'Connecté':'À connecter',getAccessToken()?'green':'neutral')}</div>${ui.reloadConfirm?notice(`Actualiser remplacera vos brouillons, vos saisies en cours et vos choix de comparaison par les parcours relus dans Genesys. ${btn('Conserver mon travail','refresh-cancel','secondary small')} ${btn('Actualiser et remplacer','refresh-confirm','small')}`,'warning'):''}<div class="page-actions">${getAccessToken()?btn('Actualiser les parcours','refresh','primary')+btn('Déconnecter cette application','logout','quiet'):btn('Se connecter avec Genesys','login','primary')}</div><details class="details"><summary>Configuration de la connexion</summary><div class="field-grid"><div class="field span2"><label for="client-id">Identifiant public de l’application</label><input id="client-id" value="${esc(config.clientId)}"></div><div class="field span2"><label for="redirect-uri">Adresse de retour</label><input id="redirect-uri" value="${esc(config.redirectUri)}"></div></div><p class="helper">Région Dublin · accès selon les autorisations du compte Genesys</p></details></section><section class="settings-panel"><h2>Export local</h2><p>Chargement d’un export JSON ou CSV des tables WOLF V5, pour consulter ses parcours sans connexion.</p><div class="field"><label for="source-files">Fichiers JSON ou CSV</label><input type="file" id="source-files" accept=".json,.csv" multiple></div><details class="details"><summary>Options d’import CSV</summary><div class="field"><label for="source-table">Nom de la table pour un CSV</label><input id="source-table" placeholder="Nom exact de la table exportée"></div></details>${hasLocalWork()?notice('Charger une autre source remplacera les adaptations, saisies et choix de cette session.','warning'):''}${btn('Ouvrir les parcours de l’export','import','secondary')}</section>`;}
function configurationPage(){ui.audience='admin';const f=current();if(!f)return empty('Aucune table V5','Chargez les configurations Genesys.');if(ui.node>=f.nodes.length)ui.node=0;return configurationView(ui.snapshot,f,ui.node,f.nodes[ui.node]?nodeEditor(f.nodes[ui.node],f):'');}
function diagnosticView(){return head('ADMINISTRATION','Diagnostic technique','Périmètre WOLF V5 · les tables V4 sont exclues de cet espace.',btn(icon('download')+' Exporter la source','export-source','secondary'))+governancePanel()+notice(`${ui.snapshot.tables.length} tables · ${ui.snapshot.tables.reduce((n,t)=>n+t.rows.length,0)} lignes · ${plural(ui.inventory.issues.length,'point')} à vérifier.`)+`<section class="settings-panel"><h2>Points à vérifier</h2>${ui.inventory.issues.map(x=>`<p>${esc(x.message)}</p>`).join('')||'<p>Aucune référence manquante détectée.</p>'}</section><section class="settings-panel"><h2>Référentiel de gouvernance</h2><p>${plural(ui.registry.coreModels.length,'Core Model')} · ${plural(ui.registry.declinations.length,'déclinaison')} dans le référentiel du Studio${resolved().missing?` · ${plural(resolved().missing,'entrée')} sans parcours dans la source courante`:''}. ${ui.governance?.status==='ready'?'Référentiel partagé dans Genesys · STUDIO_CORE_MODELS_V5.':'Référentiel Genesys non chargé.'}</p><details class="details"><summary>Contenu du référentiel</summary><pre>${esc(JSON.stringify(registryForExport(ui.registry),null,2))}</pre></details></section><section class="settings-panel"><h2>Source lue</h2>${ui.snapshot.tables.map(t=>`<details class="details"><summary>${esc(t.name)} · ${t.rows.length} lignes</summary><pre>${esc(JSON.stringify(t.rows,null,2))}</pre></details>`).join('')}</section>`;}
function cloneView(){const model=resolved().models.find(m=>m.id===ui.clone.form.modelId);return model?coreModelCopyView({...ui.clone,transientIds:[...ui.creations.keys()]},model,loadedCatalogues().divisions||[],{busy:ui.governanceBusy,resourceState:resourceStates.get('divisions')}):empty('Core Model indisponible','Revenez à la liste des Core Models.');}
function openCoreModelCopy(sourceFlowId,kind='declination'){
 requireGovernanceReady();
 if(ui.governance.pending)throw Error('Reprenez la sauvegarde du référentiel avant de préparer une copie.');
 const r=role(sourceFlowId),flow=flowById(sourceFlowId);
 if(r.role!=='reference'||!flow||ui.creations.has(sourceFlowId))throw Error('Choisissez une version de référence publiée.');
 ui.clone={step:0,form:{kind,modelId:r.model.id,sourceFlowId,name:'',versionLabel:nextVersionLabel(r.model),phone:'',division:flow.division||''},declaredAt:new Date().toISOString()};
 ui.error='';render();window.scrollTo({top:0});
}
function captureCloneForm(){
 if(!ui.clone||ui.clone.step!==0)return;
 for(const [field,id] of [['sourceFlowId','clone-source'],['name','clone-name'],['versionLabel','clone-version'],['phone','clone-phone'],['division','clone-division']])if($('#'+id))ui.clone.form[field]=$('#'+id).value.trim();
}
function planCoreModelCopy(){
 const form=ui.clone.form;
 if(!(loadedCatalogues().divisions||[]).some(d=>d.name===form.division))throw Error('Choisissez une division dans la liste Genesys.');
 return prepareCoreModelCopy({snapshot:ui.snapshot,registry:ui.registry,form,transientIds:ui.creations.keys(),declaredAt:ui.clone.declaredAt});
}
const copySignature=plan=>stable({tables:plan.snapshot.tables,registry:plan.registry});
document.addEventListener('input',event=>{if(ui.clone&&event.target.id?.startsWith('clone-'))captureCloneForm();});
document.addEventListener('change',event=>{if(ui.clone&&event.target.id?.startsWith('clone-'))captureCloneForm();});

function render(){clearTimeout(simulationTimer);if(ui.liveActivity?.enabled&&(ui.view!=='flow'||ui.loading||ui.clone||ui.liveActivity.flow?.id!==current()?.id))liveActivityController.stop();const liveViewport=$('#live-map-viewport'),liveScroll={left:liveViewport?.scrollLeft||0,top:liveViewport?.scrollTop||0};if(!ui.inventory&&!ui.loading)ui.view='settings';let body;if(ui.loading)body=`<div class="loading-view"><span class="loading-dot"></span><h1>Chargement des parcours</h1><p>${esc(ui.progress||'Lecture des configurations voix…')}</p></div>`;else if(ui.clone)body=cloneView();else body=({participantadmin:()=>participantAdminView(ui.participantAdmin||{},{catalogue:ui.participantCatalogue,divisions:loadedCatalogues().divisions||[],snapshot:applyDraftRows(ui.snapshot,ui.drafts),busy:ui.governanceBusy}),modelrename:()=>renameCoreModelView(ui.registry.coreModels.find(m=>m.id===ui.renameModel),ui.renameName,{busy:ui.governanceBusy}),coremodel:()=>coreModelWizardView(ui.coreModelWizard,coreModelCandidates(ui.registry,workingFlows(),ui.creations.keys()),{busy:ui.governanceBusy}),coremodeldelete:()=>coreModelDeleteView(ui.registry.coreModels.find(m=>m.id===ui.deleteModel),{busy:ui.governanceBusy}),catalogue:()=>catalogue(),references:()=>catalogue(true),family:familyPage,impact:impactPage,declare:declarePage,flow:flowPage,flowdata:()=>flowDataView(ui.flowData,displayTitle(current()),{catalogue:ui.participantCatalogue,divisions:loadedCatalogues().divisions||[],busy:ui.governanceBusy}),activity:activityPage,simulation:()=>simulatorView(ui.simulation,{origin:ui.activitySource}),callcompare:()=>callComparisonView(ui.callComparison,{origin:ui.activitySource}),designer:designerPage,wizard:wizardPage,quality:()=>qualityView(current(),ui.qualityReport),publication:publicationPage,compare:compareView,copy:copyView,changes:changesView,settings:settingsView,diagnostic:diagnosticView,configuration:configurationPage})[ui.view]?.()||catalogue();const active=document.activeElement,selection=active&&typeof active.selectionStart==='number'?{start:active.selectionStart,end:active.selectionEnd}:null;const focused=focusKey(active),list=$('#journey-step-list'),listPosition={top:list?.scrollTop||0,left:list?.scrollLeft||0},canvas=$('#graph-viewport'),canvasPosition={top:canvas?.scrollTop||0,left:canvas?.scrollLeft||0},inspector=$('.inspector-body'),inspectorScroll=inspector?.scrollTop||0,storyScroll=$('.business-settings-list')?.scrollTop||0;$('#app').innerHTML=shell(body);if($('.business-settings-list'))$('.business-settings-list').scrollTop=storyScroll;enhanceSelects($('#app'));disablePartialActions();const newList=$('#journey-step-list');if(newList){newList.scrollTop=listPosition.top;newList.scrollLeft=listPosition.left;}const newCanvas=$('#graph-viewport');if(newCanvas){newCanvas.scrollTop=canvasPosition.top;newCanvas.scrollLeft=canvasPosition.left;}if($('.inspector-body'))$('.inspector-body').scrollTop=inspectorScroll;restoreFocus(focused);const restoredLiveViewport=$('#live-map-viewport');if(restoredLiveViewport){restoredLiveViewport.scrollTop=liveScroll.top;restoredLiveViewport.scrollLeft=liveScroll.left;}queueMicrotask(ensureStepResources);scheduleSimulation();if(ui.view==='callcompare'){centerComparisonMaps();if(ui.callComparison?.playing&&comparisonSpeakerState)paintComparisonAudio(comparisonSpeakerState,comparisonSpeakerSide);}if(ui.view==='simulation'){paintSimulationAudio();centerSimulationMap();}if(selection&&document.activeElement?.setSelectionRange){try{document.activeElement.setSelectionRange(selection.start,selection.end);}catch{}}}
// Chaque rendu remplace le contenu de la page : sans cela, le focus clavier serait perdu à chaque action.
function focusKey(el){if(!el||el===document.body||!$('#app').contains(el))return null;if(el.id)return {id:el.id};if(el.dataset.action)return {action:el.dataset.action,data:JSON.stringify({...el.dataset})};if(el.name)return {name:el.name,value:el.value};return el.matches('main h1')?{title:true}:null;}
function restoreFocus(key){if(!key)return;if(key.title)return focusPage();const target=key.id?document.getElementById(key.id):key.action?$$(`[data-action="${key.action}"]`).find(el=>JSON.stringify({...el.dataset})===key.data):$$('input').find(el=>el.name===key.name&&el.value===key.value);target?.focus({preventScroll:true});}
function showError(error){if(error?.status===401){liveActivityController.stop();comparisonPlayback.cancel();logout();ui.publicationPlan=null;ui.source='Genesys Dublin · session expirée';}const message=error?.message||String(error);if(ui.view==='flowdata'&&ui.flowData){ui.flowData.error=message;ui.error='';}else if(ui.view==='participantadmin'&&ui.participantAdmin){ui.participantAdmin.error=message;ui.error='';}else ui.error=message;render();const alert=$('.flow-data-error')||$('.error-box[role="alert"]');if(alert){alert.setAttribute('tabindex','-1');alert.focus({preventScroll:true});alert.scrollIntoView({block:'nearest',behavior:'instant'});}}
function openFlow(index){go('flow',{flow:Number(index),journeyView:ui.audience==='business'?'overview':'step',businessTask:'all',businessQuery:'',stepQuery:'',canvasAllLinks:false,navCollapsed:window.innerWidth<1300,node:0,zoom:0.9,fitPending:true});requestAnimationFrame(()=>{fitGraphOnce();centerStep(false);});}
let activityController=null,activityRequest=0;
function cancelActivity(){activityRequest++;activityController?.abort();activityController=null;ui.activityLoading=false;}
function activityConnection(){
 if(ui.creations.has(current()?.id))return 'local-draft';
 if(ui.activitySource!=='genesys')return 'import';
 return getAccessToken()?'connected':'disconnected';
}
function activityPage(){
 const flow=current();if(!flow)return empty('Parcours introuvable','Revenez à la liste des parcours.');
 return analyticsView({flow,title:displayTitle(flow),period:ui.activityPeriod,data:ui.activityData,loading:ui.activityLoading,error:ui.activityError,connection:activityConnection(),audience:ui.audience,sameNumberCount:ui.activityBaseline?.flows.filter(item=>item.dnis===flow.dnis).length||1,hasDraft:flow.nodes.some(node=>ui.drafts.has(node.id)||ui.pendingFields.has(node.id))});
}
async function openActivity(index){
 const next=Number(index);if(!flowAt(next))throw Error('Ce parcours est absent de la source courante.');
 cancelActivity();if(next!==ui.flow)ui.node=0;
 go('activity',{flow:next,activityData:null,activityError:''});await readActivity();
}
async function readActivity(){
 cancelActivity();ui.activityData=null;ui.activityError='';
 if(activityConnection()!=='connected'){render();return;}
 // The immutable inventory read from Genesys supplies the live queue links.
 // A local modification or cloned number must not redefine live statistics.
 const flow=ui.activityBaseline?.flows.find(item=>item.id===current()?.id);
 if(!flow){ui.activityError='Ce parcours n’est pas présent dans la source Genesys lue.';render();return;}
 const request=activityRequest,controller=new AbortController();activityController=controller;ui.activityLoading=true;render();
 try{
  const data=await loadJourneyAnalytics(getAccessToken(),flow,{period:ui.activityPeriod,signal:controller.signal});
  if(request===activityRequest&&ui.view==='activity')ui.activityData=data;
 }catch(error){if(request===activityRequest&&error.name!=='AbortError')ui.activityError=error?.message||'L’activité est momentanément indisponible.';}
 finally{if(request===activityRequest){ui.activityLoading=false;activityController=null;if(ui.view==='activity')render();}}
}
function fitGraphOnce(){const viewport=$('#graph-viewport');if(!ui.fitPending||!viewport||!current())return;const graph=diagramLayout(current(),{allLinks:canvasAllLinks()});if(!graph.ready)return;ui.fitPending=false;setCanvasZoom(Math.max(.7,Math.min(1,(viewport.clientWidth-48)/graph.width,(viewport.clientHeight-48)/graph.height)));viewport.scrollTo({left:0,top:0});}
function fitGraph(){const viewport=$('#graph-viewport');if(!viewport)return;const graph=diagramLayout(current(),{allLinks:canvasAllLinks()});if(!graph.ready)return;setCanvasZoom(Math.min(1,(viewport.clientWidth-48)/graph.width,(viewport.clientHeight-48)/graph.height),.05);viewport.scrollTo({left:0,top:0});}
// Le placement du diagramme est calculé hors du rendu : à son arrivée, la carte est redessinée, puis ajustée ou recentrée.
onDiagramReady(()=>{if(ui.view!=='flow'||ui.audience!=='admin'||ui.loading||ui.clone||ui.liveActivity?.enabled||!current())return;render();fitGraphOnce();if(ui.journeyView==='step')requestAnimationFrame(()=>centerStep(false));});
function setupCompare(index){const f=flowAt(index);const r=role(f.id);const base=r.role==='declination'?flowIndex(r.base.flowId):-1;go('compare',{left:r.role==='reference'?Number(index):base>=0?base:null,right:r.role==='reference'?null:Number(index)});}
function leaveDeclare(){const index=flowIndex(ui.declareFlow);if(ui.declareReturn==='flow'&&index>=0)openFlow(index);else go('references');}
async function refresh(force=false){
 if(!force&&hasLocalWork())throw Error('Conservez vos adaptations avec un export avant de recharger la source.');
 clearTimeout(workspaceTimer);sourceController?.abort();const controller=new AbortController();sourceController=controller;
 const generation=++sourceGeneration,token=getAccessToken();
 const currentLoad=()=>sourceGeneration===generation&&!controller.signal.aborted;
 const assertCurrent=()=>{if(!currentLoad())throw Object.assign(Error('Chargement remplacé.'),{name:'AbortError'});};
 ui.loading=true;ui.sourceLoading={loaded:0,total:0,error:''};ui.progress='Lecture des entrées et des Core Models…';render();
 // Resolve identity while the table catalogue is fetched; handle rejection immediately.
 const account=createPublicationClient(token).identity().then(identity=>({identity}),error=>({error}));
 let catalogueVisible=false;
 const installCatalogue=async snapshot=>{
  const result=await account;assertCurrent();if(result.error?.status===401)throw result.error;
  const identity=result.identity;
  liveSnapshot=normalizeSnapshot({...snapshot,source:{...snapshot.source,...(identity?{organizationId:identity.organizationId}:{})}});
  setSource(liveSnapshot,'Genesys Dublin · connecté','genesys');ui.identity=identity||null;ui.identityError=result.error?.message||'';
  await loadGovernance();assertCurrent();
  if(identity)try{
   const [history,recovery]=await Promise.all([publicationHistory(identity.organizationId),readWorkspace(workspaceKey())]);assertCurrent();ui.publicationHistory=history;ui.recovery=recovery;
  }catch(error){assertCurrent();ui.storageError=error.message;}
  catalogueVisible=true;ui.loading=false;render();
 };
 try{
  const snapshot=await loadFromGenesys(token,{signal:controller.signal,concurrency:3,onCatalogue:installCatalogue,onProgress:event=>{
   if(!currentLoad())return;
   if(event.totalTables!=null)ui.sourceLoading.total=event.totalTables;
   if(event.phase==='table-complete')ui.sourceLoading.loaded=event.tablesLoaded;
   const count=$('#source-load-count');if(count)count.textContent=`${ui.sourceLoading.loaded} / ${ui.sourceLoading.total} tables voix`;
  }});
  assertCurrent();if(getAccessToken()!==token)throw Object.assign(Error('Votre session Genesys a changé. Reconnectez-vous.'),{status:401});
  if(!catalogueVisible)await installCatalogue(snapshot);
  else {
   liveSnapshot=normalizeSnapshot({...snapshot,source:{...snapshot.source,...(ui.identity?{organizationId:ui.identity.organizationId}:{})}});
   ui.snapshot=liveSnapshot;ui.inventory=buildVoiceInventory(liveSnapshot);ui.activityBaseline=ui.inventory;workingCache=null;ui.draftRevision++;
  }
  await loadParticipantCatalogue(controller.signal);assertCurrent();
  ui.sourceLoading=null;ui.audit.unshift({message:'Parcours chargés depuis Genesys',at:new Date().toISOString()});
 }catch(error){
  if(!currentLoad())return;
  if(!catalogueVisible){ui.sourceLoading=null;throw error;}
  ui.sourceLoading.error=error.message;
 }finally{if(currentLoad()){ui.loading=false;render();}}
}
function sourceLoadingNotice(){
 if(ui.loading||!sourceIncomplete())return '';
 const state=ui.sourceLoading||{};
 const count=`<small id="source-load-count">${state.loaded||0} / ${state.total||0} tables voix</small>`;
 // Un chargement qui se passe bien tient en une ligne discrète ; seul un échec mérite un encadré et une action.
 if(state.error)return `<div class="source-loading-status failed" role="alert"><div><strong>Chargement incomplet</strong><p>${esc(state.error)}</p>${count}</div>${btn('Réessayer','source-retry','secondary small')}</div>`;
 return `<p class="source-loading-status" role="status"><span class="source-loading-spinner" aria-hidden="true"></span><span>Chargement des détails des parcours</span>${count}<span class="source-loading-hint">Réglages et simulation disponibles à la fin du chargement.</span></p>`;
}

function download(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function captureCoreModelForm(){
 if(!ui.coreModelWizard||ui.coreModelWizard.step!==0)return;
 const form=ui.coreModelWizard.form;
 form.name=$('#core-model-name')?.value?.trim()??form.name;
 form.version=$('#core-model-version')?.value?.trim()??form.version;
 form.flowId=$('#core-model-flow')?.value??form.flowId;
 form.mode=$('input[name="core-model-mode"]:checked')?.value||form.mode;
}
document.addEventListener('change',event=>{if(event.target.name==='core-model-mode'){captureCoreModelForm();render();}});
function wizardContext(){return {snapshot:applyDraftRows(ui.snapshot,ui.drafts),options:wizardOptions(applyDraftRows(ui.snapshot,ui.drafts))};}
function openWizard(){
 if(ui.pendingFields.size)throw Error('Enregistrez vos réglages en cours avant de créer un parcours.');
 ui.wizard={step:0,form:{name:'',phone:'',division:'',welcomeValues:{},routing:'direct',scheduleEnabled:false,scheduleGroup:'',queue:'',priority:'0',choices:[{digit:'1',label:'Choix 1',queue:'',priority:'0'},{digit:'2',label:'Choix 2',queue:'',priority:'0'}],menuAudio:'',menuTimeout:'5',audioModes:{WELCOME_AUDIO:'tts',menuAudio:'tts'}},plan:null,error:'',signature:null};
 const catalogue=wizardContext().options.catalogue,entry=catalogue.find(c=>c.type==='inboundcall'),service=catalogue.find(c=>c.type==='service');
 for(const field of entry?.fields||[])if(['LANGUAGE','WELCOME_AUDIO'].includes(field.key)&&Object.hasOwn(field.schema,'default'))ui.wizard.form.welcomeValues[field.key]=field.schema.default;
 ui.wizard.form.audioModes.WELCOME_AUDIO=/^pr:|^prompt:/i.test(ui.wizard.form.welcomeValues.WELCOME_AUDIO||'')?'recorded':'tts';
 ui.wizard.form.waitSeconds=service?.fields.find(f=>f.key==='INQUEUE_HOLD_TIMEOUT_INIT')?.schema?.default??'';
 go('wizard');
}
function captureWizardForm(){
 if(!ui.wizard||ui.wizard.step===4)return;
 const {form}=ui.wizard;
 for(const input of $$('[name="wizard-field"], [name="wizard-welcome"], [name="wizard-choice"]')){
  if(input.disabled)continue;
  const key=input.dataset.field,kind=input.dataset.valueType;
  const value=input.type==='checkbox'?input.checked:kind==='audio-tts'?(input.value?'tts:'+input.value:''):kind==='boolean'?input.value==='true':input.value;
  const target=input.name==='wizard-welcome'?form.welcomeValues:input.name==='wizard-choice'?form.choices[Number(input.dataset.index)]:form;
  if(target)target[key]=value;
 }
 ui.wizard.plan=null;ui.wizard.signature=null;
}
function wizardPage(){
 if(!ui.wizard)return empty('Création guidée','Revenez à la liste des parcours pour commencer.');
 return flowWizardView({...ui.wizard,options:wizardContext().options,resourceStates,connected:!!getAccessToken()});
}
function validateWizardStep(){
 const {step,form}=ui.wizard,options=wizardContext().options;
 if(step===0){form.phone=form.phone.trim();if(!form.name.trim())return 'Donnez un nom à votre parcours.';if(!/^\+[1-9]\d{7,14}$/.test(form.phone.trim()))return 'Saisissez le numéro au format international, par exemple +33123456789.';if(!options.available)return options.reason||'Les tables V5 nécessaires ne sont pas disponibles.';if(options.catalogue.some(e=>e.type==='inboundcall'&&e.divisionSchema)&&!String(form.division||'').trim())return 'Choisissez une division Genesys.';}
 if(step===2){
  if(!['direct','menu'].includes(form.routing))return 'Choisissez le mode d’orientation des appels.';
  if(form.routing==='menu'&&!options.menuAvailable)return 'Le menu vocal n’est pas disponible dans les tables chargées.';
  if(form.scheduleEnabled&&!form.scheduleGroup)return 'Choisissez le calendrier Genesys à utiliser.';
  if(form.routing==='menu'){
   if(!form.menuAudio.trim())return 'Renseignez le message qui annonce les choix du menu.';
   if(form.choices.length<2)return 'Ajoutez au moins deux choix au menu.';
   if(form.choices.some(c=>!c.label.trim()||!options.menuDigits.includes(c.digit)))return 'Précisez le nom et une touche disponible pour chaque choix.';
   if(new Set(form.choices.map(c=>c.digit)).size!==form.choices.length)return 'Chaque choix doit utiliser une touche différente.';
  }
 }
 if(step===3&&String(form.waitSeconds??'').trim()&&(!Number.isInteger(Number(form.waitSeconds))||Number(form.waitSeconds)<0))return 'La durée initiale d’attente doit être un nombre entier de secondes, positif ou nul.';
 if(step===3&&(form.routing==='menu'?form.choices.some(c=>!c.queue):!form.queue))return 'Choisissez une file Genesys pour chaque destination.';
 return '';
}
function reviewWizard(){
 const {snapshot}=wizardContext();ui.wizard.plan=prepareFlowWizard({snapshot,form:ui.wizard.form});
 ui.wizard.signature=stable(ui.wizard.plan);ui.wizard.error=ui.wizard.plan.errors?.map(e=>e.message).join(' ')||'';ui.wizard.step=4;
}
async function applyWizard(){
 if(ui.wizard?.step!==4||!ui.wizard.plan?.ok)throw Error('Vérifiez le parcours avant de le créer.');
 const plan=prepareFlowWizard({snapshot:wizardContext().snapshot,form:ui.wizard.form});
 if(!plan.ok||stable(plan)!==ui.wizard.signature)throw Error('Les données ont changé. Vérifiez à nouveau le parcours.');
 const coreModel=ui.wizard.coreModel;
 let nextRegistry;if(coreModel){requireGovernanceReady();nextRegistry=declareReference(ui.registry,{flowId:plan.flowId,name:coreModel.name,versionLabel:coreModel.version,declaredAt:new Date().toISOString()});}
 const result=applyDesignerDraft({snapshot:ui.snapshot,drafts:ui.drafts,pendingFields:ui.pendingFields,plan});
 ui.snapshot=result.snapshot;ui.inventory=result.inventory;ui.drafts=result.drafts;ui.draftRevision++;
 ui.creations.set(plan.flowId,{...plan.summary,name:ui.wizard.form.name,nodeCount:plan.createdRows.length,referencesRetained:[],needsReview:plan.summary.notices||[],mappings:plan.mappings});
 if(nextRegistry)await commitRegistry(nextRegistry);
 record('Parcours créé avec l’assistant : '+ui.wizard.form.name);
 ui.wizard=null;ui.audience=coreModel?'business':'admin';ui.journeyView='overview';ui.flow=ui.inventory.flows.findIndex(f=>f.id===plan.flowId);
 ui.node=Math.max(0,current().nodes.findIndex(n=>n.id===plan.nodeId));
 go('flow');requestAnimationFrame(()=>centerStep());toast('Parcours créé en brouillon.');
}

function designerContext(){
 const snapshot=applyDraftRows(ui.snapshot,ui.drafts),flow=ui.designer?.mode==='create'?null:current();
 return {snapshot,flow,options:designerOptions({snapshot,flow})};
}
function openDesigner(mode){
 if(ui.pendingFields.size)throw Error('Enregistrez vos réglages en cours avant de modifier la structure du parcours.');
 const snapshot=applyDraftRows(ui.snapshot,ui.drafts),flow=mode==='create'?null:current(),options=designerOptions({snapshot,flow});
 const capability=options.catalogue.find(c=>c.available&&(mode==='create'?c.type==='inboundcall':c.type!=='inboundcall'));
 const selected=current()?.nodes[ui.node];
 const placement=options.placements.find(p=>p.fromId===selected?.id)||options.placements[0];
 ui.designer={mode,returnView:ui.view==='flow'?'flow':'catalogue',form:{type:capability?.type||'',tableId:capability?.tableId||'',name:'',phone:'',division:flow?.division||'',key:'',values:{},audioModes:{},placementId:placement?.id||'',nodeId:placement?.fromId||'',field:placement?.field||'',continuationField:'',destination:null},plan:null,review:false,signature:null};
 go('designer');
}
function captureDesignerForm(){
 if(!ui.designer||ui.designer.review)return;
 const form=ui.designer.form;
 for(const [id,key] of Object.entries({'designer-name':'name','designer-phone':'phone','designer-division':'division','designer-key':'key','designer-table':'tableId','designer-placement':'placementId','designer-continuation':'continuationField'}))if($('#'+id))form[key]=$('#'+id).value;
 const route=$('#designer-route');
 if(route){form.placementId=route.value;const placement=designerContext().options.placements.find(p=>p.id===route.value);form.nodeId=placement?.fromId||'';form.field=placement?.field||'';}
 const destination=$('#designer-destination');
 if(destination)form.destination=destination.value.startsWith('terminal:')?{type:destination.value.slice(9)}:destination.value?{nodeId:destination.value}:null;
 const skills=new Map();
 for(const input of $$('[name="designer-value"]')){
  if(input.disabled)continue;
  const key=input.dataset.field,kind=input.dataset.valueType,value=input.value;
  if(key==='DIVISION'&&ui.designer.mode==='create'){form.division=value;continue;}
  if(kind==='skills'){if(!skills.has(key))skills.set(key,[]);if(value)skills.get(key).push(value);continue;}
  if(value===''){delete form.values[key];continue;}
  form.values[key]=kind==='audio-tts'?'tts:'+value:kind==='boolean'?value==='true':['integer','number'].includes(kind)?Number(value):value;
 }
 for(const [key,values] of skills)if(values.length)form.values[key]=values.join(';');else delete form.values[key];
 ui.designer.plan=null;ui.designer.signature=null;
}
function designerPage(){
 if(!ui.designer)return empty('Designer indisponible','Ouvrez un parcours ou créez-en un nouveau.');
 const {flow,options}=designerContext();
 return designerView({...ui.designer,flow,options,resourceStates,connected:!!getAccessToken(),error:ui.designer.plan?.errors?.map(e=>e.message).join(' ')||''});
}
function makeDesignerPlan(){
 const {snapshot,flow}=designerContext(),{mode,form}=ui.designer;
 return mode==='create'?prepareNewFlow({snapshot,...form}):mode==='insert'?prepareNewBlock({snapshot,flow,...form}):prepareRouteEdit({snapshot,flow,...form});
}
function applyDesign(){
 if(!ui.designer?.review)throw Error('Vérifiez le résultat avant de modifier le parcours.');
 const plan=makeDesignerPlan();
 if(!plan.ok||stable(plan)!==ui.designer.signature)throw Error('Le parcours ou les choix ont changé. Vérifiez de nouveau le résultat.');
 const mode=ui.designer.mode,form=ui.designer.form;
 const result=applyDesignerDraft({snapshot:ui.snapshot,drafts:ui.drafts,pendingFields:ui.pendingFields,plan});
 ui.snapshot=result.snapshot;ui.inventory=result.inventory;ui.drafts=result.drafts;ui.draftRevision++;
 if(mode==='create')ui.creations.set(plan.flowId,{...plan.summary,name:form.name,nodeCount:plan.createdRows.length,referencesRetained:[],needsReview:plan.summary.notices||[],mappings:plan.mappings});
 else if(plan.createdRows.length)ui.blockCreations.set(plan.nodeId,{...plan.summary,title:form.name,placementLabel:designerContext().options.placements.find(p=>p.id===form.placementId)?.label||'Bloc ajouté dans le designer',mappings:plan.mappings});
 record(mode==='create'?'Parcours créé dans le designer : '+form.name:mode==='insert'?'Bloc ajouté dans le designer : '+form.name:'Raccordement du parcours modifié');
 ui.designer=null;ui.audience='admin';ui.journeyView='overview';ui.flow=ui.inventory.flows.findIndex(f=>f.id===plan.flowId);
 const flow=current();ui.node=Math.max(0,flow.nodes.findIndex(n=>n.id===plan.nodeId));
 go('flow');requestAnimationFrame(()=>centerStep());toast('Parcours modifié en brouillon. À contrôler avant publication.');
}

function captureFlowData(){
 if(!ui.flowData||ui.view!=='flowdata')return;
 for(const input of $$('[data-init-id]'))ui.flowData.values[input.dataset.initId]=input.value;
 for(const input of $$('[data-init-new]')){const a=ui.flowData.additions[Number(input.dataset.initNew)];if(a)a[input.dataset.initPart]=input.value;}
 for(const a of ui.flowData.additions)if(a.selection!=='__new_attribute__')a.name=a.selection||'';
}
function flowDataPlan(){return prepareFlowData({snapshot:applyDraftRows(ui.snapshot,ui.drafts),flowId:ui.flowData.model.flowId,signature:ui.flowData.model.signature,values:ui.flowData.values,additions:ui.flowData.additions,divisions:loadedCatalogues().divisions||[]});}

function captureParticipantAdmin(){
 const editor=ui.participantAdmin?.editor;if(ui.view!=='participantadmin'||!editor||editor.review||ui.governanceBusy)return;
 for(const input of $$('[data-admin-field]'))editor[input.dataset.adminField]=input.value;
 for(const input of $$('[data-admin-choice]')){const choice=editor.choices[Number(input.dataset.adminChoice)];if(choice)choice[input.dataset.choicePart]=input.value;}
 const toggle=$('#participant-admin-default-enabled');if(toggle)editor.defaultEnabled=toggle.checked;
}
function assertCatalogueAdministration(){
 if(ui.activitySource!=='genesys'||!ui.identity||!participantCatalogueClient)throw Error('Connectez-vous à Genesys pour gérer les définitions.');
 if([...ui.blockCreations.values(),...ui.creations.values()].some(b=>b.mappings?.some(m=>m.tableName===PARTICIPANT_CATALOGUE)))throw Error('Publiez les créations du catalogue en brouillon avant de modifier ses définitions.');
}
async function openParticipantAdmin(refresh=false){
 if(ui.activitySource!=='genesys')throw Error('Connectez-vous à Genesys pour administrer le catalogue partagé.');
 ui.participantAdmin||={query:'',type:'',divisionId:'',editor:null,error:''};
 if(refresh)ui.participantAdmin.editor=null;ui.participantAdmin.error='';go('participantadmin');ui.governanceBusy=true;render();
 try{const entities=await loadResourceCatalogue('divisions',getAccessToken());resourceStates.set('divisions',{status:'ready',entities});if(refresh||!participantCatalogueClient)await loadParticipantCatalogue();}
 finally{ui.governanceBusy=false;render();}
}

async function action(name,el){if(ui.publicationBusy||ui.governanceBusy)return;if(sourceIncomplete()&&!allowedDuringSourceLoad(name,el.dataset.view)){toast('Les données du parcours doivent être entièrement chargées.');return;}switch(name){
 case 'flow-data-open':{
  if(ui.pendingFields.size)throw Error('Enregistrez les réglages en cours avant d’ouvrir les données du parcours.');
  if(ui.activitySource==='genesys'){const entities=await loadResourceCatalogue('divisions',getAccessToken());resourceStates.set('divisions',{status:'ready',entities});}
  const model=flowDataModel(applyDraftRows(ui.snapshot,ui.drafts),current().id);
  ui.flowData={model,values:{},additions:[],textFields:[]};go('flowdata');break;
 }
 case 'participant-catalogue-reload':{captureFlowData();await loadParticipantCatalogue();if(ui.flowData)ui.flowData.model=flowDataModel(applyDraftRows(ui.snapshot,ui.drafts),ui.flowData.model.flowId);render();break;}
 case 'participant-admin-open':captureFlowData();await openParticipantAdmin();break;
 case 'participant-admin-refresh':captureParticipantAdmin();await openParticipantAdmin(true);break;
 case 'participant-admin-new':ui.participantAdmin.editor=participantEditor();ui.participantAdmin.importPlan=null;ui.participantAdmin.error='';render();break;
 case 'participant-admin-edit':{const row=ui.participantCatalogue?.table?.rows.find(r=>r.key===el.dataset.key);if(!row)throw Error('Rechargez le catalogue.');ui.participantAdmin.editor=participantEditor(row);ui.participantAdmin.error='';render();break;}
 case 'participant-admin-cancel':ui.participantAdmin.editor=null;ui.participantAdmin.error='';render();break;
 case 'participant-admin-choice-add':captureParticipantAdmin();ui.participantAdmin.editor.choices.push({value:'',label:''});render();break;
 case 'participant-admin-choice-remove':captureParticipantAdmin();ui.participantAdmin.editor.choices.splice(Number(el.dataset.index),1);render();break;
 case 'participant-admin-edit-review':ui.participantAdmin.editor.review=null;ui.participantAdmin.error='';render();break;
 case 'participant-admin-initialize':
 case 'participant-admin-upgrade':{
  const divisionId=$('#participant-admin-host')?.value;assertCatalogueAdministration();ui.governanceBusy=true;ui.participantAdmin.error='';render();
  try{const client=participantCatalogueClient;const result=name==='participant-admin-upgrade'?await client.upgrade():await client.initialize(divisionId);if(client!==participantCatalogueClient)throw Error('La session a changé. Rechargez le catalogue.');installParticipantCatalogue(result);toast('Catalogue Genesys prêt. Les données existantes sont conservées.');}
  finally{ui.governanceBusy=false;render();}break;
 }
 case 'participant-admin-review':{
  captureParticipantAdmin();assertCatalogueAdministration();const editor=ui.participantAdmin.editor,row=participantEditorRow(editor,loadedCatalogues().divisions||[]);
  validateParticipantDefinitionChange(editor.before,row,applyDraftRows(ui.snapshot,ui.drafts));
  ui.governanceBusy=true;ui.participantAdmin.error='';render();
  try{editor.review=await participantCatalogueClient.prepareDefinition(row,editor.before);}
  finally{ui.governanceBusy=false;render();}break;
 }
 case 'participant-admin-save':{
  assertCatalogueAdministration();const editor=ui.participantAdmin.editor;if(!editor?.review)throw Error('Vérifiez la définition avant de l’enregistrer.');
  ui.governanceBusy=true;ui.participantAdmin.error='';render();
  try{const client=participantCatalogueClient;const result=await client.saveDefinition(editor.review);if(client!==participantCatalogueClient)throw Error('La session a changé. Rechargez le catalogue.');installParticipantCatalogue(result);ui.participantAdmin.editor=null;record('Définition du catalogue enregistrée : '+editor.key);toast('Définition enregistrée et vérifiée dans Genesys.');}
  catch(error){editor.review=null;throw error;}finally{ui.governanceBusy=false;render();}break;
 }
 case 'participant-admin-import':{
  const divisionId=$('#catalogue-import-division')?.value;assertCatalogueAdministration();
  if(ui.drafts.size||ui.blockCreations.size||ui.creations.size||ui.pendingFields.size)throw Error('Terminez les brouillons avant de préparer cet import séparé.');
  if(!divisionId)throw Error('Choisissez la division des attributs partagés.');ui.governanceBusy=true;render();
  try{await loadParticipantCatalogue();if(ui.participantCatalogue.status!=='ready')throw Error('Le catalogue doit être relu depuis Genesys.');const source={...liveSnapshot,tables:[...liveSnapshot.tables.filter(t=>t.name!==PARTICIPANT_CATALOGUE),ui.participantCatalogue.table]};ui.participantAdmin.importPlan=prepareParticipantCatalogueImport(source,loadedCatalogues().divisions||[],divisionId);ui.participantAdmin.error='';}
  finally{ui.governanceBusy=false;render();}break;
 }
 case 'participant-admin-import-cancel':ui.participantAdmin.importPlan=null;render();break;
 case 'participant-admin-import-stage':{
  const plan=ui.participantAdmin.importPlan;if(!plan?.rows.length)throw Error('Prévisualisez les données à importer.');
  if(ui.drafts.size||ui.blockCreations.size||ui.creations.size||ui.pendingFields.size)throw Error('Les brouillons ont changé. Recommencez la prévisualisation.');
  const tableId=plan.tableId,mappings=plan.rows.map(row=>({tableId,tableName:PARTICIPANT_CATALOGUE,key:row.key,nodeId:`${tableId}:${row.key}`}));
  ui.snapshot=normalizeSnapshot({...ui.snapshot,tables:ui.snapshot.tables.map(t=>t.id===tableId?{...t,rows:[...t.rows,...plan.rows]}:t)});ui.draftRevision++;
  ui.blockCreations.set(`catalogue-import:${tableId}`,{title:'Catalogue des données',placementLabel:'Référencement des attributs existants',mappings});
  ui.participantAdmin.importPlan=null;ui.isolatedCreationBatch=mappings.map(m=>m.nodeId);await openPublication();break;
 }
 case 'flow-data-close':ui.flowData=null;go('flow');break;
 case 'flow-data-add':captureFlowData();ui.flowData.additions.push({selection:'',name:'',value:''});render();break;
 case 'flow-data-remove':captureFlowData();ui.flowData.additions.splice(Number(el.dataset.index),1);render();break;
 case 'flow-data-review':captureFlowData();ui.flowData.error='';ui.error='';ui.flowData.review=flowDataPlan();ui.flowData.reviewSignature=stable(ui.flowData.review);render();window.scrollTo({top:0});break;
 case 'flow-data-edit':ui.flowData.review=null;render();break;
 case 'flow-data-save':{
  ui.flowData.error='';ui.error='';
  if(!ui.flowData?.review)throw Error('Vérifiez les données avant de les enregistrer.');
  const plan=flowDataPlan();if(stable(plan)!==ui.flowData.reviewSignature)throw Error('Les données ont changé. Vérifiez de nouveau le résultat.');
  const result=applyDesignerDraft({snapshot:ui.snapshot,drafts:ui.drafts,pendingFields:ui.pendingFields,plan});
  ui.snapshot=result.snapshot;ui.inventory=result.inventory;ui.drafts=result.drafts;ui.draftRevision++;
  if(plan.createdRows.length)ui.blockCreations.set(plan.createdRows[0].nodeId,{...plan.summary,mappings:plan.mappings,placementLabel:'Initialisation à l’entrée du parcours'});
  record('Données d’entrée du parcours préparées');ui.flowData=null;go('flow');toast('Données enregistrées en brouillon. Publiez-les depuis Mes changements.');break;
 }
 case 'source-retry':await refresh();break;
 case 'boolean-toggle':{
  const input=el.closest('.boolean-control').querySelector('[data-boolean-value]');
  const checked=el.getAttribute('aria-checked')!=='true';
  input.value=checked?el.dataset.on:el.dataset.off;el.setAttribute('aria-checked',String(checked));el.querySelector('.value-switch-state').textContent=checked?'Oui':'Non';
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));break;
 }
 case 'designer-boolean-text':captureDesignerForm();ui.designer.form.booleanTextFields=[...(ui.designer.form.booleanTextFields||[]),el.dataset.fieldKey];render();break;

 case 'governance-load':await loadGovernance();break;
 case 'governance-initialize':{
  if(ui.governance.status!=='missing'||!governanceClient)throw Error('Relisez le référentiel avant de le créer.');
  const divisionId=$('#governance-division')?.value;if(!divisionId)throw Error('Choisissez une division pour la table dédiée.');
  const skipMigration=el.dataset.skipMigration==='true';
  // Les déclarations V4, hors périmètre, restent dans le navigateur sans bloquer la migration des autres.
  const registry=skipMigration?emptyRegistry():validateGovernanceMigration(registryInScope(ui.governance.migration||emptyRegistry(),ui.snapshot.source),ui.inventory);
  ui.governanceBusy=true;render();
  try{const result=await governanceClient.initialize(registry,divisionId);ui.registry=result.registry;ui.registrySaved=true;ui.governance={...result,status:'ready',remoteRegistry:result.registry,migration:null,pending:null};if(!skipMigration)clearRegistry(storage,registryScope(ui.snapshot.source));record(skipMigration?'Référentiel Core Model créé dans Genesys.':'Référentiel Core Model migré dans Genesys.');}
  finally{ui.governanceBusy=false;render();}break;
 }
 case 'governance-retry':{const pending=ui.governance?.pending;if(!pending)break;await loadGovernance();requireGovernanceReady();if(same(durableRegistry(pending.registry,ui.creations.keys()),ui.governance.remoteRegistry)){await commitRegistry(pending.registry,'Sauvegarde Genesys confirmée.');break;}if(!same(pending.base,ui.governance.remoteRegistry))throw Error('Le référentiel partagé a changé. Exportez puis abandonnez la modification en attente avant de la réappliquer sur la version Genesys actuelle.');await commitRegistry(pending.registry,'Référentiel enregistré dans Genesys.');break;}
 case 'governance-pending-export':if(ui.governance?.pending)download('wolf-rattachement-en-attente.json',ui.governance.pending);break;
 case 'governance-pending-discard':ui.governance.pending=null;scheduleWorkspaceSave();render();break;
 case 'governance-export':{requireGovernanceReady();download('wolf-referentiel-genesys.json',{tableId:ui.governance.tableId,organizationId:ui.identity.organizationId,revision:ui.governance.revision,registry:ui.governance.remoteRegistry});break;}

 case 'core-model-open':requireGovernanceReady();ui.coreModelWizard={step:0,form:{name:'',version:'V1',mode:'existing',flowId:''}};go('coremodel');break;
 case 'core-model-cancel':ui.coreModelWizard=null;ui.deleteModel=null;go('references');break;
 case 'core-model-back':ui.coreModelWizard.step=0;go('coremodel');break;
 case 'core-model-next':{
  requireGovernanceReady();captureCoreModelForm();const state=ui.coreModelWizard;
  validateCoreModelIdentity(ui.registry,state.form);
  if(state.form.mode==='new'){const core={name:state.form.name,version:state.form.version};openWizard();ui.wizard.coreModel=core;ui.wizard.form.name=core.name;render();}
  else{prepareCoreModel(ui.registry,state.form,workingFlows(),ui.creations.keys());state.step=1;go('coremodel');}break;
 }
 case 'core-model-create':{
  if(ui.coreModelWizard?.step!==1)throw Error('Vérifiez le Core Model avant de le créer.');
  const next=prepareCoreModel(ui.registry,ui.coreModelWizard.form,workingFlows(),ui.creations.keys(),new Date().toISOString());
  const model=roleOf(next,ui.coreModelWizard.form.flowId).model;
  await commitRegistry(next,'Core Model créé : '+model.name);ui.coreModelWizard=null;go('family',{model:model.id});toast('Core Model enregistré dans Genesys.');break;
 }
 case 'core-model-delete':{
  requireGovernanceReady();removeCoreModel(ui.registry,el.dataset.model);ui.deleteModel=el.dataset.model;go('coremodeldelete');break;
 }
 case 'core-model-delete-confirm':{
  if(ui.view!=='coremodeldelete'||ui.deleteModel!==el.dataset.model)throw Error('Ouvrez la confirmation de suppression.');
  const next=removeCoreModel(ui.registry,ui.deleteModel);await commitRegistry(next,'Déclaration du Core Model supprimée ; parcours WOLF conservés.');ui.deleteModel=null;go('references');toast('Core Model supprimé. Ses parcours sont conservés.');break;
 }
 case 'wizard-open':openWizard();break;
 case 'wizard-cancel':{const core=ui.wizard?.coreModel;ui.wizard=null;if(core){ui.coreModelWizard={step:0,form:{...core,mode:'new',flowId:''}};go('coremodel');}else go('catalogue');break;}
 case 'wizard-next':captureWizardForm();ui.wizard.error=validateWizardStep();if(!ui.wizard.error){if(ui.wizard.step===3)reviewWizard();else ui.wizard.step++;}render();window.scrollTo({top:0});break;
 case 'wizard-back':captureWizardForm();ui.wizard.step=Math.max(0,ui.wizard.step-1);ui.wizard.error='';ui.wizard.plan=null;render();window.scrollTo({top:0});break;
 case 'wizard-review':captureWizardForm();reviewWizard();render();break;
 case 'wizard-apply':await applyWizard();break;
 case 'wizard-add-choice':{captureWizardForm();const digits=wizardContext().options.menuDigits,form=ui.wizard.form,digit=digits.find(d=>!form.choices.some(c=>c.digit===d));if(digit)form.choices.push({digit,label:'Choix '+digit,queue:'',priority:'0'});render();break;}
 case 'wizard-remove-choice':captureWizardForm();if(ui.wizard.form.choices.length>2)ui.wizard.form.choices.splice(Number(el.dataset.index),1);render();break;
 case 'wizard-resource-load':captureWizardForm();await loadResources(el.dataset.kind);break;
 case 'wizard-audio-mode':{captureWizardForm();const field=el.dataset.field;ui.wizard.form.audioModes[field]=el.dataset.mode;if(field==='menuAudio')ui.wizard.form.menuAudio='';else delete ui.wizard.form.welcomeValues[field];render();break;}
 case 'designer-create':openDesigner('create');break;
 case 'designer-insert':openDesigner('insert');break;
 case 'designer-connect':openDesigner('connect');break;
 case 'designer-cancel':{const back=ui.designer?.returnView||'catalogue';ui.designer=null;go(back);break;}
 case 'designer-type':captureDesignerForm();ui.designer.form={...ui.designer.form,type:el.dataset.type,tableId:el.dataset.table,values:{},audioModes:{},continuationField:''};ui.designer.review=false;ui.designer.plan=null;render();break;
 case 'designer-resource-load':captureDesignerForm();await loadResources(el.dataset.kind);break;
 case 'designer-audio-mode':captureDesignerForm();ui.designer.form.audioModes[el.dataset.field]=el.dataset.mode;delete ui.designer.form.values[el.dataset.field];render();break;
 case 'designer-review':captureDesignerForm();ui.designer.plan=makeDesignerPlan();ui.designer.review=ui.designer.plan.ok;ui.designer.signature=stable(ui.designer.plan);ui.error='';render();window.scrollTo({top:0});break;
 case 'designer-edit':ui.designer.review=false;render();break;
 case 'designer-apply':applyDesign();break;


 case 'quality-open':ui.qualityReport=inspectJourney(current(),ui.snapshot);go('quality');break;
 case 'quality-back':go('flow');break;
 case 'quality-step':ui.view='flow';openStep(el.dataset.node);break;
 case 'quality-export':download('wolf-controle-parcours.json',ui.qualityReport);break;
 case 'call-compare-open':{if(ui.pendingFields.size)throw Error('Enregistrez vos réglages pour comparer les deux appels.');stopSimulationAudio();ui.callComparison=createCallComparison(ui.activityBaseline?.flows.find(f=>f.id===current().id),current());go('callcompare');break;}
 case 'call-compare-back':comparisonPlayback.cancel();go('flow');break;
 case 'call-compare-play':{if(comparisonComplete(ui.callComparison))resetCallComparison();ui.callComparison.playing=!ui.callComparison.playing;ui.callComparison.audioError='';render();break;}
 case 'call-compare-sound':comparisonPlayback.cancel();ui.callComparison.audioEnabled=!ui.callComparison.audioEnabled;ui.callComparison.audioError='';render();break;
 case 'call-compare-reset':resetCallComparison();render();break;
 case 'call-compare-scenario':resetCallComparison({scenario:el.dataset.scenario,context:undefined});render();break;
 case 'call-compare-present':ui.callComparison.presentation=!ui.callComparison.presentation;render();break;
 case 'call-compare-route':comparisonPlayback.cancel();ui.callComparison=advanceCallComparison(ui.callComparison,el.dataset.route);ui.callComparison.playing=true;render();break;
 case 'call-compare-export':download('comparatif-appels-wolf.json',callComparisonReport(ui.callComparison));break;
 case 'live-activity-toggle':{if(ui.liveActivity?.enabled)liveActivityController.stop();else{if(ui.activitySource!=='genesys')throw Error('Connectez-vous à Genesys pour lire les données d’activité.');const baseline=ui.activityBaseline?.flows.find(f=>f.id===current().id);if(!baseline)throw Error('Ce parcours n’est pas encore présent dans la version chargée depuis Genesys.');liveActivityController.setVisible(!document.hidden);await liveActivityController.start(baseline);}break;}
 case 'live-activity-refresh':await liveActivityController.refresh();break;
 case 'publication-inspect':{const f=configurationFlow(applyDraftRows(ui.snapshot,ui.drafts),el.dataset.table);go('configuration',{configurationTable:el.dataset.table,node:Math.max(0,f?.nodes.findIndex(n=>n.key===el.dataset.key)??0)});break;}
 case 'publication-impact-flow':{const index=flowIndex(el.dataset.flow);if(index<0)throw Error('Parcours introuvable.');go('flow',{flow:index,node:0});break;}
 case 'simulation-open':{if(ui.pendingFields.size)throw Error('Enregistrez vos réglages pour les inclure dans la simulation.');ui.simulation=startSimulation(current());go('simulation');break;}
 case 'simulation-back':go('flow');break;
 case 'simulation-play':ui.simulation.playing=!ui.simulation.playing;ui.simulation.audioError='';render();break;
 case 'simulation-audio':stopSimulationAudio();ui.simulation.audioEnabled=ui.simulation.audioEnabled===false;ui.simulation.audioError='';render();break;
 case 'simulation-resume':ui.simulation=resumeSimulation(ui.simulation,$('#simulation-destination')?.value);render();break;
 case 'simulation-route':stopSimulationAudio();ui.simulation=advanceSimulation(ui.simulation,el.dataset.route);ui.simulation.audioError='';render();break;
 case 'simulation-rewind':stopSimulationAudio();ui.simulation={...rewindSimulation(ui.simulation),playing:false};render();break;
 case 'simulation-reset':stopSimulationAudio();ui.simulation={...startSimulation(ui.simulation.flow,{source:ui.simulation.source}),presentation:ui.simulation.presentation,playing:ui.simulation.playing,audioEnabled:ui.simulation.audioEnabled};render();break;
 case 'simulation-source':{const source=el.dataset.source;const flow=source==='live'?ui.activityBaseline?.flows.find(f=>f.id===current().id):current();if(!flow)throw Error('Ce parcours n’existe pas encore dans la version lue depuis Genesys.');stopSimulationAudio();ui.simulation=startSimulation(flow,{source});render();break;}
 case 'simulation-export':download('wolf-scenario-appel.json',simulationReport(ui.simulation));break;
 case 'simulation-present':ui.simulation.presentation=!ui.simulation.presentation;ui.error='';render();break;
 case 'simulation-speak':stopSimulationAudio();ui.simulation.audioEnabled=true;ui.simulation.audioError='';ui.simulation.playing=true;render();break;
 case 'workspace-restore':{const recovered=ui.recovery?.data;if(!recovered)break;ui.snapshot=normalizeSnapshot({...recovered.snapshot,source:{...recovered.snapshot.source,participantCatalogueRequired:true},tables:[...recovered.snapshot.tables,...(ui.participantCatalogue?.table&&!recovered.snapshot.tables.some(t=>t.name===PARTICIPANT_CATALOGUE)?[ui.participantCatalogue.table]:[])]});ui.inventory=buildVoiceInventory(ui.snapshot);ui.drafts=new Map(recovered.drafts);ui.pendingFields=new Map(recovered.pendingFields);ui.creations=new Map(recovered.creations);ui.blockCreations=new Map(recovered.blocks);ui.audit=recovered.audit||[];ui.comparisonSessions=new Map(recovered.comparisons||[]);if(recovered.registry&&ui.governance.status==='ready')ui.registry=restorePendingRegistry(ui.governance.remoteRegistry,recovered.registry,ui.creations.keys());if(recovered.registryPending)ui.governance.pending=recovered.registryPending;ui.isolatedCreationBatch=recovered.isolatedCreationBatch||recovered.scenarioFiveBatch||null;ui.draftRevision++;ui.recovery=null;render();toast('Vos modifications ont été reprises. Elles seront contrôlées avant publication.');break;}
 case 'workspace-dismiss':await clearWorkspace(workspaceKey());ui.recovery=null;render();break;
 case 'publication-open':await openPublication();break;
 case 'publication-prepare':await preparePublication();break;
 case 'publication-edit':ui.publicationPlan=null;ui.publicationRun=null;render();break;
 case 'publication-new':await openPublication();break;
 case 'publication-commit':await commitPublication();break;
 case 'publication-export':{const run=ui.publicationRun?.id===el.dataset.id?ui.publicationRun:ui.publicationHistory.find(r=>r.id===el.dataset.id);if(run)download('wolf-publication-'+run.id+'.json',run);break;}
 case 'publication-reconcile':{if(ui.activitySource!=='genesys'||!ui.identity)throw Error('Chargez les parcours depuis Genesys avant de continuer.');const run=ui.publicationHistory.find(r=>r.id===el.dataset.id);if(!run)break;ui.publicationBusy=true;render();try{ui.publicationRun=await createPublicationClient(getAccessToken()).reconcile(run);await savePublication(ui.publicationRun);acceptPublishedRows(ui.publicationRun);ui.publicationHistory=await publicationHistory(ui.identity.organizationId);}finally{ui.publicationBusy=false;render();}break;}
 case 'publication-restore':{if(ui.activitySource!=='genesys'||!ui.identity)throw Error('Chargez les parcours depuis Genesys avant de continuer.');const run=ui.publicationHistory.find(r=>r.id===el.dataset.id);if(!run)break;ui.publicationBusy=true;render();try{publicationClient=createPublicationClient(getAccessToken());ui.publicationPlan=await publicationClient.prepare(restorationRows(run),{organizationId:ui.identity.organizationId,source:'restore:'+run.id});ui.publicationRun=null;ui.publicationRevision=ui.draftRevision;}finally{ui.publicationBusy=false;render();}break;}
 case 'nav':ui.clone=false;if(el.dataset.view==='participantadmin')await openParticipantAdmin();else go(el.dataset.view);break;
 case 'open-flow':openFlow(el.dataset.index);break;
 case 'open-activity':await openActivity(el.dataset.index);break;
 case 'activity-back':go('flow');requestAnimationFrame(()=>centerStep());break;
 case 'activity-refresh':await readActivity();break;
 case 'activity-period':ui.activityPeriod=['today','yesterday','week'].includes(el.dataset.period)?el.dataset.period:'today';await readActivity();break;
 case 'activity-connect':go('settings');break;
 case 'business-show-choices':ui.onlyConfigured=false;render();break;
 case 'toggle-configured':ui.onlyConfigured=!ui.onlyConfigured;render();break;
 case 'catalogue-reset':ui.catalogueModel='';ui.query='';render();break;
 case 'catalogue-model-clear':ui.catalogueModel='';render();break;
 case 'business-task':ui.businessTask=businessTasks.some(task=>task.id===el.dataset.task)?el.dataset.task:'all';ui.journeyView='overview';ui.error='';render();break;
 case 'resource-load':await loadResources(el.dataset.kind);break;
 case 'field-mode':{const node=current().nodes[ui.node],key=node.id+':'+el.dataset.fieldKey;ui.advancedFields??=new Set();ui.advancedFields.has(key)?ui.advancedFields.delete(key):ui.advancedFields.add(key);render();break;}
 case 'resource-external':{const node=current().nodes[ui.node];const pending=ui.pendingFields.get(node.id)||{};pending[el.dataset.fieldKey]={external:String(node.row[el.dataset.fieldKey]||'')};ui.pendingFields.set(node.id,pending);render();break;}
 case 'resource-tts':
 case 'resource-recorded':{const node=current().nodes[ui.node],key=el.dataset.fieldKey;const pending=ui.pendingFields.get(node.id)||{};const edit=audioModeEdit(node.row[key],pending[key],name==='resource-tts'?'tts':'recorded');if(edit===undefined)delete pending[key];else pending[key]=edit;if(Object.keys(pending).length)ui.pendingFields.set(node.id,pending);else ui.pendingFields.delete(node.id);render();if(name==='resource-tts')$$('.node-form textarea[data-field]').find(input=>input.dataset.field===key)?.focus();break;}
 case 'business-edit':openStep(el.dataset.node);$('.story-step.selected')?.scrollIntoView({block:'nearest'});if(ui.businessTask!=='all')requestAnimationFrame(()=>{const key=taskFields(current().nodes[ui.node],ui.businessTask).find(field=>(field.editable||field.resource)&&field.key!=='DESCRIPTION')?.key;const target=key&&$$('.node-form :is([data-field],[data-resource-field],[data-skill-field])').find(input=>[input.dataset.field,input.dataset.resourceField,input.dataset.skillField].includes(key)&&!input.disabled);(target&&document.getElementById(target.id+'--picker')||target)?.focus();});break;
 case 'journey-overview':ui.journeyView='overview';ui.error='';render();break;
 case 'toggle-steps':ui.navCollapsed=!ui.navCollapsed;render();break;
 case 'toggle-sidebar':sidebarPreference=!menuCollapsed();writeSidebarPreference(storage,sidebarPreference);render();break;
 case 'center-step':centerStep();break;
 case 'set-audience':{ui.audience=el.dataset.audience==='admin'?'admin':'business';if(el.dataset.panel)ui.adminPanel=el.dataset.panel;if(ui.audience==='business')ui.journeyView='overview';ui.error='';render();if($('.inspector-body'))$('.inspector-body').scrollTop=0;requestAnimationFrame(()=>{fitGraphOnce();if(ui.journeyView==='step')centerStep(false);});break;}
 case 'admin-panel':ui.adminPanel=el.dataset.panel==='source'?'source':'settings';ui.adminQuery='';render();if($('.inspector-body'))$('.inspector-body').scrollTop=0;break;
 case 'canvas-main':ui.canvasAllLinks=false;render();centerStep();break;
 case 'canvas-all':ui.canvasAllLinks=true;render();centerStep();break;
 case 'select-node':openStep(el.dataset.node);break;
 case 'zoom-fit':fitGraph();break;
 case 'diagram-retry':retryDiagram();render();break;
 case 'zoom-out':setCanvasZoom(ui.zoom-.1);break;
 case 'zoom-in':setCanvasZoom(ui.zoom+.1);break;
 case 'compare-flow':setupCompare(Number(el.dataset.index));break;
 case 'open-flow-id':{const index=flowIndex(el.dataset.id);if(index<0)throw Error('Ce parcours est absent de la source courante.');ui.clone=false;openFlow(index);break;}
 case 'open-model':ui.clone=false;go('family',{model:el.dataset.model});break;
 case 'impact-open':go('impact',{impactFlow:el.dataset.id});break;
 case 'compare-versions':go('compare',{left:flowIndex(el.dataset.left),right:flowIndex(el.dataset.right)});break;
 case 'declare-start':go('declare',{declareFlow:el.dataset.id,declareReturn:ui.view==='flow'?'flow':'references'});break;
 case 'declare-cancel':leaveDeclare();break;
 case 'declare-reference':{const f=flowById(ui.declareFlow);const coreModelId=$('input[name="declare-model"]:checked')?.value||'';const next=declareReference(ui.registry,{flowId:f.id,coreModelId,name:$('#declare-name').value,versionLabel:$('#declare-version').value,declaredAt:new Date().toISOString()});await commitRegistry(next,'Parcours de référence déclaré : '+flowTitle(f));go('family',{model:roleOf(next,f.id).model.id});toast('Parcours de référence enregistré dans Genesys.');break;}
 case 'declare-declination':{const f=flowById(ui.declareFlow);const baseFlowId=$('input[name="declare-base"]:checked')?.value;if(!baseFlowId)throw Error('Choisissez la version de référence de cette déclinaison.');const next=attachDeclination(ui.registry,{flowId:f.id,baseFlowId,origin:'declared',declaredAt:new Date().toISOString()});await commitRegistry(next,'Déclinaison rattachée : '+displayTitle(f));go('family',{model:roleOf(next,f.id).model.id});toast(ui.creations.has(baseFlowId)?'Rattachement préparé. Il sera enregistré dans Genesys à la publication de cette version.':'Rattachement enregistré dans Genesys.');break;}
 case 'declare-remove':{const f=flowById(ui.declareFlow);await commitRegistry(removeFromRegistry(ui.registry,f.id),'Rôle retiré : '+displayTitle(f));ui.error='';render();toast('Parcours retiré du référentiel.');break;}
 case 'set-scope':{await commitRegistry(setScope(ui.registry,el.dataset.id,el.dataset.scope),`Périmètre déclaré « ${scopeLabel(el.dataset.scope)} » : ${displayTitle(flowById(el.dataset.id))}`);const top=window.scrollY;render();window.scrollTo({top});break;}
 case 'clone-from':openCoreModelCopy(el.dataset.id);break;
 case 'pick-open':ui.picker=el.dataset.slot;ui.pickerQuery='';render();$('#picker-search')?.focus();break;
 case 'pick-close':{const slot=ui.picker;ui.picker=null;render();$$('[data-action="pick-open"]').find(button=>button.dataset.slot===slot)?.focus();break;}
 case 'pick-flow':ui[ui.picker]=Number(el.dataset.index);ui.picker=null;ui.error='';render();break;
 case 'save-node':{const f=current(),node=f.nodes[Number(el.dataset.node)],form=el.closest('form')||$('.node-form');const visibleValues=Object.fromEntries([...(form?.querySelectorAll('[data-field]')||[])].map(input=>[input.dataset.field,input.value]));const table=ui.snapshot.tables.find(t=>t.id===node.tableId);const row=prepareStepDraft({node,schema:table?.schema,snapshot:applyDraftRows(ui.snapshot,ui.drafts),catalogues:loadedCatalogues(),pending:ui.pendingFields.get(node.id)||{},visibleValues});saveRow(node,row);ui.pendingFields.delete(node.id);record('Adaptation de '+nodeTitle(node));ui.error='';render();toast('Brouillon enregistré.');break;}
 case 'copy-start':go('compare',{right:ui.flow,left:null});break;
 case 'copy-from-compare':go('compare');break;
 case 'decision-keep':changeDecision(el.dataset.id,'keep');break;
 case 'decision-copy':changeDecision(el.dataset.id,'copy');break;
 case 'decision-edit':changeDecision(el.dataset.id,'edit');break;
 case 'comparison-section':{const session=comparisonSession();if(session){session.section=el.dataset.section;ui.error='';render();}break;}
 case 'block-insert':chooseBlock(el.dataset.id,true);break;
 case 'block-ignore':chooseBlock(el.dataset.id,false);break;
 case 'block-associate':{const session=comparisonSession();if(session){session.section='values';session.mappingOpen=true;render();}break;}
 case 'block-review':reviewBlocks();break;
 case 'block-edit':{const session=comparisonSession();if(session){session.blockReview=false;session.blockSignature=null;render();}break;}
 case 'block-reset':{const session=comparisonSession();if(session){session.blockDecisions={};session.blockReview=false;session.blockSignature=null;ui.error='';render();}break;}
 case 'block-apply':applyBlocks();break;
 case 'comparison-review':reviewComparison();break;
 case 'comparison-edit':{const session=comparisonSession();if(session)session.review=false;ui.error='';render();break;}
 case 'comparison-apply':applyComparison();break;
 case 'comparison-reset':{const session=comparisonSession();if(session){session.decisions={};session.review=false;session.reviewSignature=null;}ui.error='';render();break;}
 case 'comparison-mapping-toggle':{const session=comparisonSession();if(session)session.mappingOpen=!session.mappingOpen;render();break;}
 case 'comparison-open-step':{const context=comparisonContext();if(!context)break;const nodeIndex=context.right.nodes.findIndex(node=>node.id===el.dataset.nodeId);if(nodeIndex<0)throw Error('Cette étape est absente du parcours cible.');const flow=ui.right;openFlow(flow);openStep(nodeIndex);break;}
 case 'discard-start':ui.discard=true;render();break;
 case 'discard-cancel':ui.discard=false;render();break;
 case 'discard-confirm':{const addedIds=new Set([...ui.creations.values(),...ui.blockCreations.values()].flatMap(block=>block.mappings.map(mapping=>mapping.nodeId)));ui.snapshot=normalizeSnapshot({...ui.snapshot,tables:ui.snapshot.tables.map(table=>({...table,rows:table.rows.filter(row=>!addedIds.has(`${table.id}:${row.key}`))}))});ui.inventory=buildVoiceInventory(ui.snapshot);ui.blockCreations.clear();ui.creations.clear();if(ui.governance?.remoteRegistry)ui.registry=ui.governance.remoteRegistry;ui.isolatedCreationBatch=null;ui.comparisonSessions.clear();}ui.drafts.clear();ui.draftRevision++;ui.pendingFields.clear();ui.discard=false;record('Modifications annulées');render();break;
 case 'login':saveAuthConfig({clientId:$('#client-id').value.trim(),redirectUri:$('#redirect-uri').value.trim()});el.disabled=true;await beginLogin();break;
 case 'refresh':if(hasLocalWork()){ui.reloadConfirm=true;render();}else await refresh();break;
 case 'refresh-confirm':ui.reloadConfirm=false;await refresh(true);break;
 case 'refresh-cancel':ui.reloadConfirm=false;render();break;
 case 'logout':sourceGeneration++;sourceController?.abort();sourceController=null;liveActivityController.stop();comparisonPlayback.cancel();clearTimeout(workspaceTimer);publicationClient=null;governanceClient=null;participantCatalogueClient=null;stopSimulationAudio();cancelActivity();logout();ui=initialState();workingCache=null;resourceStates.clear();resourceToken=null;go('settings');break;
 case 'import':{const files=$('#source-files').files;const tableName=$('#source-table')?.value.trim();if(!files.length)throw Error('Choisissez un export JSON ou CSV.');const tables=[];let source;for(const file of files){if(file.size>15*1024*1024)throw Error('Limitez chaque fichier à 15 Mo.');const snap=parseTableFile(await file.text(),file.name,tableName||undefined);tables.push(...snap.tables);source=snap.source;}setSource({tables,source},'Export local');break;}
 case 'export-source':download('wolf-snapshot.json',ui.snapshot);break;
 case 'export-changes':download('wolf-changements.json',{format:'wolf-local-draft/v2',media:'voice',executable:false,generatedAt:new Date().toISOString(),governance:registryForExport(ui.registry),createdBlocks:[...ui.blockCreations.values()].map(block=>({...block,rows:block.mappings.map(mapping=>({tableId:mapping.tableId,table:mapping.tableName,row:ui.snapshot.tables.find(table=>table.id===mapping.tableId)?.rows.find(row=>String(row.key)===mapping.key)}))})),createdJourneys:[...ui.creations.values()].map(c=>({...c,rows:c.mappings.map(m=>({tableId:m.tableId,table:m.tableName,row:ui.snapshot.tables.find(t=>t.id===m.tableId)?.rows.find(r=>String(r.key)===m.key)}))})),changes:draftChanges().map(({tableId,table,key,field,before,after})=>({tableId,table,key,field,before,after}))});toast('Changements exportés.');break;
 case 'model-rename':{requireGovernanceReady();const model=ui.registry.coreModels.find(m=>m.id===el.dataset.model);if(!model)throw Error('Core Model introuvable.');ui.renameModel=model.id;ui.renameName=model.name;go('modelrename');break;}
 case 'model-rename-save':{ui.renameName=$('#model-rename').value;const next=renameCoreModel(ui.registry,ui.renameModel,ui.renameName);await commitRegistry(next,'Core Model renommé : '+ui.renameName.trim());go('family',{model:ui.renameModel});ui.renameModel=null;toast('Nom du Core Model enregistré dans Genesys.');break;}
 case 'model-action-cancel':{const model=ui.renameModel;ui.renameModel=null;go('family',{model});break;}
 case 'model-version':{const model=ui.registry.coreModels.find(m=>m.id===el.dataset.model);if(!model)throw Error('Core Model introuvable.');const source=[...model.versions].reverse().find(v=>flowById(v.flowId)&&!ui.creations.has(v.flowId));if(!source)throw Error('Aucune version publiée disponible.');openCoreModelCopy(source.flowId,'version');break;}
 case 'clone-start':openCoreModelCopy(current()?.id);break;
 case 'clone-cancel':{const model=ui.clone?.form.modelId;ui.clone=null;go('family',{model});break;}
 case 'clone-divisions':captureCloneForm();await loadResources('divisions');break;
 case 'clone-back':ui.clone.step=0;ui.clone.plan=null;ui.error='';render();break;
 case 'clone-review':{captureCloneForm();const plan=planCoreModelCopy();ui.clone.plan=plan;ui.clone.signature=copySignature(plan);ui.clone.step=1;ui.error='';render();window.scrollTo({top:0});break;}
 case 'clone-confirm':{
  requireGovernanceReady();if(ui.governance.pending)throw Error('Terminez la synchronisation du référentiel avant de créer une copie.');if(ui.clone?.step!==1)throw Error('Vérifiez la copie avant de la créer.');
  const result=planCoreModelCopy();if(copySignature(result)!==ui.clone.signature)throw Error('Les données ont changé. Revenez à la préparation de la copie.');
  const kind=ui.clone.form.kind;
  ui.snapshot=result.snapshot;ui.inventory=buildVoiceInventory(ui.snapshot);ui.creations.set(result.flowId,result.summary);ui.draftRevision++;
  await commitRegistry(result.registry);record(kind==='version'?'Nouvelle version du Core Model préparée.':'Parcours créé depuis le Core Model.');
  ui.clone=null;ui.audience='business';openFlow(ui.inventory.flows.findIndex(f=>f.id===result.flowId));toast('Copie prête à personnaliser. Publiez-la depuis Mes changements.');break;
 }
}}
document.addEventListener('click',async event=>{const el=event.target.closest('[data-action]');if(!el||el.disabled)return;event.preventDefault();try{await action(el.dataset.action,el);scheduleWorkspaceSave();}catch(error){showError(error);}});
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('change',event=>{if(event.target.id==='publication-all'){ui.publicationSelected=new Set(event.target.checked?publicationEntries().map(r=>r.id):[]);render();}if(event.target.dataset.publicationRow){event.target.checked?ui.publicationSelected.add(event.target.dataset.publicationRow):ui.publicationSelected.delete(event.target.dataset.publicationRow);render();}if(event.target.id==='configured-fields-only'){ui.onlyConfigured=event.target.checked;render();}});
document.addEventListener('input',event=>{
 const target=event.target,key=target.dataset.resourceField||target.dataset.skillField||target.dataset.externalField;
 if(!key)return;
 const node=current()?.nodes[ui.node];if(!node)return;
 const pending=ui.pendingFields.get(node.id)||{};
 if(target.dataset.externalField){pending[key]={external:target.value};ui.pendingFields.set(node.id,pending);if($('#step-save-status'))$('#step-save-status').innerHTML=tag('À enregistrer','amber');return;}
 if(target.value==='__keep__'){delete pending[key];}
 else {const value=target.dataset.skillField?[...document.querySelectorAll('[data-skill-field]')].filter(el=>el.dataset.skillField===key).map(el=>el.value).filter(value=>value&&value!=='__keep__').join(';'):target.value;pending[key]={resource:value};}
 if(Object.keys(pending).length)ui.pendingFields.set(node.id,pending);else ui.pendingFields.delete(node.id);
 render();
});
document.addEventListener('input',event=>{if(event.target.id==='business-settings-search'){ui.businessQuery=event.target.value;$('#business-steps').innerHTML=businessSteps(current(),businessOptions());}if(event.target.id==='admin-field-search'){ui.adminQuery=event.target.value;render();}if(event.target.matches('.node-form [data-field]')){const node=current()?.nodes[ui.node];if(node){const pending=ui.pendingFields.get(node.id)||{};pending[event.target.dataset.field]=event.target.value;ui.pendingFields.set(node.id,pending);if($('#step-save-status'))$('#step-save-status').innerHTML=tag('À enregistrer','amber');}}if(event.target.id==='catalogue-search'){ui.query=event.target.value;updateCatalogueResults();}if(event.target.id==='step-search'){ui.stepQuery=event.target.value;$('#journey-step-list').innerHTML=stepList(current(),journeyOptions(current()));}if(event.target.id==='picker-search'){ui.pickerQuery=event.target.value;$('#picker-options').innerHTML=pickerOptions();}});
document.addEventListener('input',event=>{if(event.target.id==='business-settings-search'){ui.businessQuery=event.target.value;$('#business-steps').innerHTML=businessSteps(current(),businessOptions());}
 if(event.target.name==='comparison-value'){
  const session=comparisonSession();if(!session)return;
  session.decisions[event.target.dataset.id]={mode:'edit',value:event.target.value};session.review=false;session.reviewSignature=null;ui.error='';render();
 }
 if(event.target.id==='comparison-search'){
  const session=comparisonSession();if(session){session.query=event.target.value;render();}
 }
});
document.addEventListener('change',event=>{
 if(event.target.name!=='comparison-mapping')return;
 try{
  const context=comparisonContext();if(!context)return;
  const {session,left,right}=context,leftId=event.target.dataset.left,rightId=event.target.value;
  const source=left.nodes.find(node=>node.id===leftId),target=right.nodes.find(node=>node.id===rightId);
  if(!source||rightId&&(!target||target.type!==source.type))throw Error('Choisissez une étape de même nature dans le parcours cible.');
  if(rightId&&Object.entries(session.mappings).some(([key,value])=>key!==leftId&&value===rightId))throw Error('Cette étape cible est déjà rapprochée explicitement d’une autre étape.');
  if(rightId)session.mappings[leftId]=rightId;else delete session.mappings[leftId];
  const nextDiff=compareFlows(left,right,{seedMatches:Object.entries(session.mappings)}),ids=new Set(nextDiff.items.map(item=>item.id));
  session.decisions=Object.fromEntries(Object.entries(session.decisions).filter(([id])=>ids.has(id)));
  session.review=false;session.reviewSignature=null;ui.error='';render();toast('Correspondance mise à jour. Les choix des étapes inchangées sont conservés.');
 }catch(error){showError(error);}
});
document.addEventListener('change',event=>{
 if(!['block-placement','block-exit-mode','block-exit-target'].includes(event.target.name))return;
 const session=comparisonSession(),id=event.target.dataset.id,decision=session?.blockDecisions?.[id];if(!decision)return;
 if(event.target.name==='block-placement')decision.placementId=event.target.value;
 else {const outlet=event.target.dataset.outlet;decision.connections[outlet]||={};if(event.target.name==='block-exit-mode'){decision.connections[outlet]={mode:event.target.value};}else decision.connections[outlet].nodeId=event.target.value;}
 session.blockReview=false;session.blockSignature=null;ui.error='';render();
});

let publicationClient=null,liveSnapshot=null,workspaceTimer=null,workspaceSaving=Promise.resolve();
function workspaceKey(){return ui.identity?`${ui.identity.organizationId}:${ui.identity.userId}`:null;}
function scheduleWorkspaceSave(){clearTimeout(workspaceTimer);if(sourceIncomplete()||!workspaceKey()||ui.activitySource!=='genesys'||ui.recovery||ui.publicationBusy)return;const id=workspaceKey();workspaceTimer=setTimeout(()=>{if(sourceIncomplete()||workspaceKey()!==id||ui.publicationBusy||!ui.snapshot)return;const data={snapshot:ui.snapshot,registry:registryForExport(ui.registry),registryPending:ui.governance?.pending||null,isolatedCreationBatch:ui.isolatedCreationBatch||null,comparisons:[...ui.comparisonSessions],drafts:[...ui.drafts],pendingFields:[...ui.pendingFields],creations:[...ui.creations],blocks:[...ui.blockCreations],audit:ui.audit};const hasWork=hasLocalWork();workspaceSaving=workspaceSaving.catch(()=>{}).then(()=>hasWork?saveWorkspace(id,data):clearWorkspace(id)).catch(error=>{ui.storageError=error.message;render();});},350);}
function assertIsolatedCreationBatch(){
 if(!ui.isolatedCreationBatch?.length)return;
 const expected=new Set(ui.isolatedCreationBatch),entries=publicationEntries();
 if(entries.length!==expected.size||entries.some(e=>e.kind!=='create'||!expected.has(e.id)))throw Error('Ce lot de création autorise uniquement ses nouvelles lignes. Une modification extérieure a été détectée : séparez ces changements avant de publier.');
 if(ui.publicationPlan?.entries.some(e=>e.kind!=='create'||!expected.has(e.id)))throw Error('Le contrôle contient une ligne extérieure au lot de création. Relancez la vérification.');
}
function publicationEntries(){return publicationRows(ui.snapshot,ui.drafts,ui.creations,ui.blockCreations);}
function publicationCheck(){return publicationPreflight({snapshot:ui.snapshot,rows:ui.publicationPlan?.entries||publicationEntries(),selected:ui.publicationPlan?new Set(ui.publicationPlan.entries.map(e=>e.id)):ui.publicationSelected,baselineSnapshot:liveSnapshot,plan:ui.publicationPlan,revision:ui.draftRevision,planRevision:ui.publicationRevision});}
function publicationPage(){return publicationView({preflight:ui.publicationRun?null:publicationCheck(),rows:publicationEntries(),plan:ui.publicationPlan,run:ui.publicationRun,history:ui.publicationHistory,busy:ui.publicationBusy,selected:ui.publicationSelected,connected:ui.activitySource==='genesys'&&!!getAccessToken()&&!!ui.identity});}
async function openPublication(){if(ui.pendingFields.size)throw Error('Enregistrez les réglages en cours avant de préparer la publication.');ui.publicationPlan=null;ui.publicationRun=null;ui.publicationSelected=new Set(publicationEntries().map(r=>r.id));if(ui.identity)ui.publicationHistory=await publicationHistory(ui.identity.organizationId);go('publication');}
async function preparePublication(){assertIsolatedCreationBatch();const check=publicationCheck();if(check.errors){const finding=check.findings.find(f=>f.level==='error');throw Error(finding.detail||finding.title);}if(ui.activitySource!=='genesys'||!ui.identity)throw Error('Chargez les parcours depuis Genesys avant de publier.');if(ui.pendingFields.size)throw Error('Enregistrez les réglages en cours.');const entries=publicationEntries().filter(e=>ui.publicationSelected.has(e.id));const newIds=new Set(publicationEntries().filter(e=>e.kind==='create').map(e=>e.id));if(newIds.size&&[...newIds].some(id=>!ui.publicationSelected.has(id)))throw Error('Publiez ensemble toutes les lignes créées et leurs raccordements pour conserver un parcours cohérent.');if(newIds.size&&entries.length!==publicationEntries().length)throw Error('La création de blocs nécessite de sélectionner aussi les raccordements modifiés.');ui.publicationBusy=true;ui.error='';render();try{publicationClient=createPublicationClient(getAccessToken());ui.publicationPlan=await publicationClient.prepare(entries,{organizationId:ui.identity.organizationId});ui.publicationRevision=ui.draftRevision;}finally{ui.publicationBusy=false;render();}}
function acceptPublishedRows(run){const verified=run.entries.filter(e=>e.status==='verified');if(!verified.length)return;const replace=snapshot=>normalizeSnapshot({...snapshot,tables:snapshot.tables.map(table=>{const writes=verified.filter(e=>e.tableId===table.id),keys=new Set(writes.map(e=>e.key));return {...table,rows:[...table.rows.filter(row=>!keys.has(String(row.key))),...writes.map(e=>e.after)]};})});ui.snapshot=replace(ui.snapshot);liveSnapshot=replace(liveSnapshot);ui.inventory=buildVoiceInventory(ui.snapshot);ui.activityBaseline=buildVoiceInventory(liveSnapshot);for(const entry of verified){const draft=rebaseDraft(ui.drafts.get(entry.id),entry.after);if(draft)ui.drafts.set(entry.id,draft);else ui.drafts.delete(entry.id);}const ids=new Set(verified.map(e=>e.id));if(ui.isolatedCreationBatch){ui.isolatedCreationBatch=ui.isolatedCreationBatch.filter(id=>!ids.has(id));if(!ui.isolatedCreationBatch.length)ui.isolatedCreationBatch=null;}for(const map of [ui.creations,ui.blockCreations])for(const [key,item]of map){const mappings=item.mappings.filter(m=>!ids.has(m.nodeId));if(!mappings.length)map.delete(key);else map.set(key,{...item,mappings});}ui.draftRevision++;}
async function commitPublication(){assertIsolatedCreationBatch();const check=publicationCheck();if(check.errors){const finding=check.findings.find(f=>f.level==='error');throw Error(finding.detail||finding.title);}if(!ui.publicationPlan||ui.publicationRevision!==ui.draftRevision)throw Error('Les brouillons ont changé : relancez le contrôle.');if(ui.pendingFields.size)throw Error('Une saisie reste à enregistrer.');if(!navigator.locks)throw Error('Ce navigateur ne permet pas de verrouiller la publication. Utilisez une version récente de Chrome, Edge ou Firefox en HTTPS.');ui.publicationBusy=true;ui.error='';render();try{await navigator.locks.request('wolf-publication:'+ui.identity.organizationId,{ifAvailable:true},async lock=>{if(!lock)throw Error('Une publication est déjà en cours dans un autre onglet.');ui.publicationRun=await publicationClient.publish(ui.publicationPlan,{journal:savePublication,onProgress:run=>{ui.publicationRun=run;render();}});acceptPublishedRows(ui.publicationRun);if(ui.governance?.status==='ready'||ui.registry.coreModels.length)await commitRegistry(ui.registry);ui.publicationHistory=await publicationHistory(ui.identity.organizationId);ui.publicationPlan=null;});}finally{ui.publicationBusy=false;scheduleWorkspaceSave();render();}}
document.addEventListener('input',event=>{if(event.target.closest('.node-form')||ui.view==='compare')scheduleWorkspaceSave();});
document.addEventListener('keydown',event=>{if(ui.view!=='simulation'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.target.matches('input,textarea,select'))return;if(event.key==='Escape'&&ui.simulation?.presentation){ui.simulation.presentation=false;render();return;}if(/^[0-9*#]$/.test(event.key)){const button=$$('.phone-keypad button').find(b=>b.textContent===event.key&&!b.disabled);if(button){event.preventDefault();button.click();}}});
ui.loading=true;ui.progress='Connexion à Genesys Dublin…';render();
try{await startGenesysSession({completeLogin,beginLogin,loadSource:refresh,invalidateSession:logout});}catch(error){ui.loading=false;ui.view='settings';showError(error);}

// Déplacement du canevas à la souris ; les cartes restent des boutons accessibles.
let canvasDrag=null;
document.addEventListener('pointerdown',event=>{const viewport=event.target.closest('#graph-viewport');if(!viewport||event.button!==0||event.target.closest('button'))return;canvasDrag={viewport,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-dragging');event.preventDefault();});
document.addEventListener('pointermove',event=>{if(!canvasDrag)return;canvasDrag.viewport.scrollLeft=canvasDrag.left-(event.clientX-canvasDrag.x);canvasDrag.viewport.scrollTop=canvasDrag.top-(event.clientY-canvasDrag.y);});
const endCanvasDrag=()=>{canvasDrag?.viewport.classList.remove('is-dragging');canvasDrag=null;};
document.addEventListener('pointerup',endCanvasDrag);document.addEventListener('pointercancel',endCanvasDrag);
// Survol d'une carte du diagramme : ses liens ressortent, les autres s'effacent.
document.addEventListener('mouseover',event=>{const surface=$('#journey-canvas');if(!surface)return;const card=event.target.closest?.('.diagram-card'),id=card?.dataset.card||'';if(surface.dataset.hover===id)return;surface.dataset.hover=id;surface.classList.toggle('focus',Boolean(card));for(const edge of surface.querySelectorAll('.canvas-edge'))edge.classList.toggle('on',Boolean(card)&&(edge.dataset.from===id||edge.dataset.to===id));});
document.addEventListener('wheel',event=>{if(!event.target.closest('#graph-viewport')||!event.ctrlKey&&!event.metaKey)return;event.preventDefault();setCanvasZoom(ui.zoom+(event.deltaY<0?.05:-.05));},{passive:false});

// Keep designer inputs across async catalogue loads and dependent-select renders.
document.addEventListener('input',event=>{if(ui.view==='designer'&&(event.target.id?.startsWith('designer-')||event.target.name==='designer-value'))captureDesignerForm();});
document.addEventListener('change',event=>{if(ui.view!=='designer'||!event.target.id?.startsWith('designer-'))return;captureDesignerForm();if(['designer-table','designer-placement','designer-continuation','designer-route','designer-destination'].includes(event.target.id)||event.target.dataset.valueType==='skills')render();});

// Preserve wizard choices through resource loads and conditional step changes.
document.addEventListener('input',event=>{if(ui.view==='wizard'&&event.target.name?.startsWith('wizard-'))captureWizardForm();});
document.addEventListener('change',event=>{if(ui.view!=='wizard'||!event.target.name?.startsWith('wizard-'))return;captureWizardForm();if(['routing','scheduleEnabled'].includes(event.target.dataset.field))render();});

document.addEventListener('change',event=>{if(event.target.id==='configuration-table'){ui.configurationTable=event.target.value;ui.node=0;render();}if(event.target.id==='configuration-row'){ui.node=Number(event.target.value);render();}if(event.target.matches('.node-form [data-field]')&&/(^|_)TARGET_TYPE(?:_\d+)?$/.test(event.target.dataset.field))render();});

document.addEventListener('visibilitychange',()=>{liveActivityController.setVisible(!document.hidden);if(document.hidden&&ui.callComparison?.playing){ui.callComparison.playing=false;comparisonPlayback.cancel();if(ui.view==='callcompare')render();}});
document.addEventListener('change',event=>{if(ui.view!=='callcompare')return;if(event.target.id==='comparison-digit'){resetCallComparison({digit:event.target.value});render();}else if(event.target.hasAttribute('data-comparison-context')){const context={...ui.callComparison.context,[event.target.dataset.comparisonContext]:event.target.value};resetCallComparison({context});render();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&ui.view==='callcompare'&&ui.callComparison?.presentation){ui.callComparison.presentation=false;render();}});

document.addEventListener('change',event=>{if(event.target.id==='business-branch'){const node=current()?.nodes[ui.node];if(node){ui.businessBranches??={};ui.businessBranches[node.id]=event.target.value;render();}}});

document.addEventListener('change',event=>{if(event.target.id==='catalogue-model'){ui.catalogueModel=event.target.value;render();}});
document.addEventListener('change',event=>{if(event.target.id==='business-task-more'){ui.businessTask=businessTasks.some(task=>task.id===event.target.value)?event.target.value:'all';ui.journeyView='overview';ui.error='';render();}});

// Entre 701 et 1000 px, la liste des étapes masque le panneau de réglages : une étape ouverte garde la priorité
// quand la fenêtre rétrécit, au lieu de rester sélectionnée sans rien afficher.
// Franchir un seuil de largeur peut réduire ou déployer le menu : la page n'est redessinée que si c'est le cas.
for(const query of ['(max-width: 1000px)','(max-width: 700px)'])window.matchMedia?.(query)?.addEventListener('change',()=>{if(menuCollapsed()!==sidebarShownCollapsed)render();});
const narrowStudio=window.matchMedia?.('(max-width: 1000px)');
narrowStudio?.addEventListener('change',event=>{if(event.matches&&ui.view==='flow'&&ui.journeyView==='step'&&!ui.navCollapsed){ui.navCollapsed=true;render();}});

// Menu « Plus d’actions » : se referme au clic extérieur et avec Échap, en rendant le focus à son bouton.
document.addEventListener('click',event=>{for(const menu of $$('.action-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const menu=event.target.closest?.('.action-menu[open]');if(menu){menu.open=false;menu.querySelector('summary').focus();}});

// Dependent catalogue controls retain current values until the user chooses replacements.
document.addEventListener('change',event=>{
 if(ui.view==='flowdata'&&event.target.matches('[data-init-part="selection"]')){captureFlowData();const addition=ui.flowData.additions[Number(event.target.dataset.initNew)];if(addition){addition.name=addition.selection;addition.value=catalogueDefinition(ui.snapshot,addition.name)?.DEFAULT_VALUE||'';}render();}
 if(event.target.matches('.node-form [data-field="PARTICIPANT_DATA_TO_CHECK"],.node-form [data-field="DECISION_OPERATOR"]'))render();
 if(ui.view==='designer'&&event.target.name==='designer-value'&&['PARTICIPANT_DATA_TO_CHECK','DECISION_OPERATOR'].includes(event.target.dataset.field)){captureDesignerForm();render();}
 if(ui.view==='participantadmin'&&(event.target.matches('[data-admin-field], [data-admin-choice]')||event.target.id==='participant-admin-default-enabled')){captureParticipantAdmin();ui.participantAdmin.error='';if(['participant-admin-type','participant-admin-default-enabled'].includes(event.target.id)||event.target.matches('[data-admin-choice]'))render();}
 if(event.target.id==='participant-admin-filter-type'){ui.participantAdmin.type=event.target.value;render();}
 if(event.target.id==='participant-admin-filter-division'){ui.participantAdmin.divisionId=event.target.value;render();}
});
document.addEventListener('input',event=>{if(ui.view==='participantadmin'){captureParticipantAdmin();if(event.target.id==='participant-admin-search'){ui.participantAdmin.query=event.target.value;render();}}});
