import test from 'node:test';
import assert from 'node:assert/strict';
import {designerView} from '../src/flow-designer-view.js';

const entry={type:'inboundcall',label:'Accueil',tableId:'entries',tableName:'W_INBOUND_CALL_v5',available:true,divisionSchema:{type:'string'},fields:[{key:'LANGUAGE',label:'Langue',schema:{type:'string',enum:['fr-fr','en-us']},default:'fr-fr',required:true}],outlets:[{field:'NEXT_TARGET_TYPE',label:'Puis'}]};
const service={type:'service',label:'Équipe de traitement',tableId:'teams',tableName:'W_SERVICES_v5',available:true,fields:[{key:'QUEUE',label:'File de destination',schema:{type:'string'},required:true},{key:'PRIORITY',label:'Priorité',schema:{type:'integer',minimum:0},default:0,required:true},{key:'WELCOME_AUDIO',label:'Message d’accueil',schema:{type:'string'}}],outlets:[{field:'INQUEUE_TARGET_TYPE',label:'Après l’attente'}]};
const options={catalogue:[entry,service,{type:'bot',label:'Bot vocal',available:false,reason:'Intents à configurer',fields:[],outlets:[]}],placements:[{id:'entry-route',fromId:'entry',field:'NEXT_TARGET_TYPE',label:'Accueil · Puis',currentType:'service',currentTarget:'Équipe actuelle'}],destinations:[{nodeId:'team',type:'service',label:'Équipe cible'}]};
const button=(html,action)=>html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0]||'';

test('new flow starts with its name and number, respects schema division and never claims number provisioning',()=>{
 const html=designerView({mode:'create',options,form:{name:'Accueil',phone:'+33123456789'}});
 assert.ok(html.indexOf('id="designer-name"')<html.indexOf('id="designer-phone"'));
 assert.match(html,/data-field="DIVISION"/);assert.match(html,/name="designer-value" data-field="LANGUAGE"/);
 assert.match(html,/ne provisionne pas le numéro/);assert.doesNotMatch(button(html,'designer-review'),/disabled/);
 const minimal=designerView({options:{catalogue:[{...entry,divisionSchema:null}]}});assert.doesNotMatch(minimal,/data-field="DIVISION"/);
});
test('palette explains unavailable blocks and keeps selection explicit',()=>{
 const html=designerView({mode:'insert',options,form:{}});
 assert.match(html,/Choisissez un bloc pour commencer/);assert.match(html,/Intents à configurer/);
 assert.match(button(html,'designer-review'),/disabled/);
 assert.match(html,/<button[^>]*data-type="bot"[^>]*disabled/);
});
test('block placement and continuation are explicit and other exit behavior is stated',()=>{
 const html=designerView({mode:'insert',options,form:{type:'service',tableId:'teams',name:'Nouvelle équipe',placementId:'entry-route',continuationField:'INQUEUE_TARGET_TYPE'}});
 assert.match(html,/id="designer-placement"/);assert.match(html,/id="designer-continuation"/);
 assert.match(html,/Suite actuelle conservée/);assert.match(html,/autres sorties non renseignées termineront l’appel/);
 assert.ok(html.indexOf('id="designer-name"')<html.indexOf('id="designer-placement"'));
});
test('known Genesys resources use searchable native selects with names, not IDs',()=>{
 const html=designerView({mode:'insert',options,form:{tableId:'teams',values:{QUEUE:'Q Sinistres'}},connected:true,resourceStates:new Map([['queues',{status:'ready',entities:[{id:'uuid-1',name:'Q Sinistres'}]}]])});
 assert.match(html,/<select[^>]*name="designer-value" data-field="QUEUE"/);
 assert.match(html,/<option value="Q Sinistres" selected/);assert.doesNotMatch(html,/uuid-1/);
 assert.match(html,/ressources? Genesys · recherche par nom/);
 assert.match(html,/name="designer-value" data-field="PRIORITY" data-value-type="integer"[^>]*value="0"/);
});
test('unavailable catalogues expose retry and never fall back to an arbitrary queue text input',()=>{
 const html=designerView({mode:'insert',options,form:{tableId:'teams'},connected:true,resourceStates:{queues:{status:'error',error:'Accès refusé'}}});
 assert.match(html,/Accès refusé/);assert.match(html,/data-action="designer-resource-load"/);
 assert.match(html,/<select[^>]*data-field="QUEUE"[^>]*disabled/);
 assert.doesNotMatch(html,/<input[^>]*data-field="QUEUE"/);
});
test('recorded and TTS modes remain switchable, with distinct serializable value types',()=>{
 const params={mode:'insert',options,form:{tableId:'teams',values:{WELCOME_AUDIO:'tts:Bonjour <client>'}},connected:true};
 let html=designerView(params);assert.match(html,/data-value-type="audio-tts"/);assert.match(html,/Bonjour &lt;client&gt;/);
 assert.match(html,/data-mode="recorded"/);
 html=designerView({...params,form:{...params.form,audioModes:{WELCOME_AUDIO:'recorded'},values:{WELCOME_AUDIO:'pr:Accueil'}},resourceStates:{prompts:{status:'ready',entities:[{id:'1',name:'Accueil'}]}}});
 assert.match(html,/<option value="pr:Accueil" selected/);assert.match(html,/data-mode="tts"/);
});
test('reconnecting displays current destination and the explicit new target',()=>{
 const html=designerView({mode:'connect',options,form:{placementId:'entry-route',destination:{nodeId:'team'}}});
 assert.match(html,/Destination actuelle/);assert.match(html,/Équipe actuelle/);assert.match(html,/<option value="team" selected/);
 assert.match(html,/Terminer l’appel/);assert.match(html,/remplace celle de cette branche/);
});
test('review escapes data, shows before and after and only applies valid plans',()=>{
 const plan={ok:true,createdRows:[{tableName:'W_SERVICES_v5',row:{key:'NEW',DESCRIPTION:'Équipe <script>',QUEUE:'Q'}}],updatedRows:[{node:{row:{DESCRIPTION:'Accueil',NEXT_TARGET:'OLD'}},row:{DESCRIPTION:'Accueil',NEXT_TARGET:'NEW'}}],summary:{notices:['Réglage à vérifier']}};
 let html=designerView({mode:'insert',options,review:true,plan});
 assert.match(html,/Équipe &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/designer-before">OLD/);assert.match(html,/>NEW<\/strong>/);
 assert.match(html,/Mes changements/);assert.doesNotMatch(button(html,'designer-apply'),/disabled/);
 html=designerView({mode:'insert',options,review:true,plan:{...plan,ok:false,errors:[{message:'Raccordement invalide'}]}});assert.match(button(html,'designer-apply'),/disabled/);assert.match(html,/Raccordement invalide/);
});


test('route selection follows the selected node and field, and next is offered only for an actual waiting return',()=>{
 const opts={...options,placements:[...options.placements,{id:'menu-return',fromId:'waiting-menu',field:'OPTION1_TARGET_TYPE',label:'Menu · Choix 1'}],returnAllowedNodes:['waiting-menu']};
 let html=designerView({mode:'connect',options:opts,form:{placementId:'entry-route',nodeId:'waiting-menu',field:'OPTION1_TARGET_TYPE'}});
 assert.match(html,/<option value="menu-return" selected/);assert.match(html,/Revenir au cycle d’attente/);
 html=designerView({mode:'connect',options:opts,form:{placementId:'entry-route',nodeId:'entry',field:'NEXT_TARGET_TYPE'}});
 assert.doesNotMatch(html,/value="terminal:next"/);
});


test('creation loads Genesys divisions, preserves the selected name and exposes failures',()=>{
 const base={mode:'create',options,form:{division:'Relation client'},connected:true};
 const html=designerView({...base,resourceStates:{divisions:{status:'ready',entities:[{id:'division-id',name:'Relation client'}]}}});
 assert.match(html,/<select[^>]*data-field="DIVISION"/);
 assert.match(html,/<option value="Relation client" selected/);
 assert.doesNotMatch(html,/division-id|<input[^>]*data-field="DIVISION"/);
 const failed=designerView({...base,resourceStates:{divisions:{status:'error',error:'Permission division requise'}}});
 assert.match(failed,/Permission division requise/);
 assert.match(failed,/<select[^>]*data-field="DIVISION"[^>]*disabled/);
 assert.match(failed,/data-kind="divisions"/);
});
