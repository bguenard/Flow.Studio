import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFields} from '../src/business.js';
import {stepFieldView} from '../src/step-field-view.js';
import {prepareStepDraft} from '../src/step-draft.js';
import {validateV5Edits} from '../src/v5-fields.js';
import {designerOptions,prepareNewBlock} from '../src/flow-designer.js';
import {designerView} from '../src/flow-designer-view.js';
import {buildVoiceInventory} from '../src/data-source.js';

const definition=(key,VALUE_TYPE,options=[])=>({key,LABEL:`Libellé ${key}`,DIVISION:'G2S',DIVISION_ID:'g2s',VALUE_TYPE,DEFAULT_VALUE:'',ALLOWED_VALUES:JSON.stringify(options)});
const snapshot={source:{participantCatalogueRequired:true},tables:[{id:'catalogue',name:'STUDIO_PARTICIPANT_DATA_V5',rows:[
 definition('STATUT','list',[{value:'OUVERTE',label:'Agence ouverte'},{value:'FERME',label:'Agence fermée'}]),
 definition('ACTIVE','boolean'),definition('NOMBRE','integer'),definition('TEXTE','text')
]}]};
const row={key:'decision',DESCRIPTION:'État de l’agence',PARTICIPANT_DATA_TO_CHECK:'STATUT',DECISION_OPERATOR:'==',DECISION_VALUE:'OUVERTE'};
const schema={properties:Object.fromEntries(Object.keys(row).map(key=>[key,{type:'string'}]))};
const node={id:'d:decision',type:'decision',tableName:'W_DECISION_v5',tableId:'d',key:'decision',schema,row};
const field=key=>businessFields(node).find(f=>f.key===key);

test('typed conditions choose catalogue labels and preserve unknown current names without offering free input',()=>{
 const legacy={...node,row:{...row,PARTICIPANT_DATA_TO_CHECK:'ANCIEN'}};
 const html=stepFieldView({...field('PARTICIPANT_DATA_TO_CHECK'),value:'ANCIEN'},0,{node:legacy,snapshot,admin:true,advanced:true});
 assert.match(html,/<select/);assert.match(html,/Libellé STATUT/);assert.match(html,/value="ANCIEN" selected disabled/);assert.doesNotMatch(html,/Saisir un autre attribut/);
 const result=prepareStepDraft({node:legacy,snapshot,pending:{DESCRIPTION:'Nom adapté'}});assert.equal(result.PARTICIPANT_DATA_TO_CHECK,'ANCIEN');
 assert.throws(()=>prepareStepDraft({node:legacy,snapshot,pending:{DECISION_VALUE:'AUTRE'}}),/catalogue/);
});
test('list conditions compare stored values and reject labels, unknown values and incompatible operators',()=>{
 assert.equal(prepareStepDraft({node,snapshot,pending:{DECISION_VALUE:'FERME'}}).DECISION_VALUE,'FERME');
 for(const pending of [{DECISION_VALUE:'Agence fermée'},{DECISION_VALUE:'INCONNU'},{DECISION_OPERATOR:'contains'},{DECISION_OPERATOR:'>'}])assert.throws(()=>prepareStepDraft({node,snapshot,pending}));
 const html=stepFieldView(field('DECISION_VALUE'),1,{node,snapshot,admin:true,advanced:true});
 assert.match(html,/<select/);assert.match(html,/value="FERME"/);assert.match(html,/Agence fermée/);assert.doesNotMatch(html,/type="text"/);
 const operators=stepFieldView(field('DECISION_OPERATOR'),2,{node,snapshot});assert.doesNotMatch(operators,/value="contains"/);
});
test('pending attribute chooses its own value control and validation preserves exact boolean strings',()=>{
 const boolPending={PARTICIPANT_DATA_TO_CHECK:'ACTIVE',DECISION_VALUE:'False'};
 const bool=stepFieldView(field('DECISION_VALUE'),1,{node,snapshot,pending:boolPending,advanced:true,admin:true});assert.match(bool,/role="switch"/);assert.doesNotMatch(bool,/Saisir une autre valeur/);
 assert.equal(prepareStepDraft({node,snapshot,pending:boolPending}).DECISION_VALUE,'False');
 assert.throws(()=>prepareStepDraft({node,snapshot,pending:{...boolPending,DECISION_VALUE:'oui'}}));
 const string=stepFieldView(field('DECISION_VALUE'),1,{node,snapshot,pending:{PARTICIPANT_DATA_TO_CHECK:'TEXTE',DECISION_VALUE:'true'}});assert.doesNotMatch(string,/role="switch"/);assert.match(string,/type="text"/);
});
test('integer comparisons reject fractions, exponents and unsafe values before draft or publication',()=>{
 const numeric={PARTICIPANT_DATA_TO_CHECK:'NOMBRE',DECISION_OPERATOR:'>=',DECISION_VALUE:'12'};
 assert.equal(prepareStepDraft({node,snapshot,pending:numeric}).DECISION_VALUE,'12');
 for(const value of ['1.2','1e3','Infinity','9007199254740993']){
  assert.throws(()=>prepareStepDraft({node,snapshot,pending:{...numeric,DECISION_VALUE:value}}));
  assert.throws(()=>validateV5Edits(node,{...row,...numeric,DECISION_VALUE:value},{snapshot,fields:['DECISION_VALUE']}));
 }
});
test('presence checks omit value controls and preserve the old value without validation or normalization',()=>{
 const html=stepFieldView(field('DECISION_VALUE'),1,{node,snapshot,pending:{DECISION_OPERATOR:'exist'}});assert.match(html,/Aucune valeur de comparaison/);assert.doesNotMatch(html,/data-field="DECISION_VALUE"/);
 const result=prepareStepDraft({node,snapshot,pending:{DECISION_OPERATOR:'exist'}});assert.equal(result.DECISION_VALUE,'OUVERTE');
 const invalidExisting={...node,row:{...row,DECISION_VALUE:'ANCIENNE_VALEUR'}};
 assert.equal(prepareStepDraft({node:invalidExisting,snapshot,pending:{DESCRIPTION:'Libellé adapté'}}).DECISION_VALUE,'ANCIENNE_VALEUR');
 assert.throws(()=>prepareStepDraft({node:invalidExisting,snapshot,pending:{DECISION_OPERATOR:'=='},visibleValues:{DECISION_VALUE:'INVALIDE'}}));
});

function designerFixture(){
 const str={type:'string'},schema=fields=>({required:['key'],properties:Object.fromEntries(fields.map(k=>[k,str]))});
 const source=structuredClone(snapshot);
 source.tables.push({id:'entry',name:'W_INBOUND_CALL_v5',schema:schema(['key','DESCRIPTION','NEXT_TARGET_TYPE','NEXT_TARGET']),rows:[{key:'+33123456789',DESCRIPTION:'Accueil',NEXT_TARGET_TYPE:'disconnect',NEXT_TARGET:''}]});
 source.tables.push({id:'decision',name:'W_DECISION_v5',schema:schema(['key','DESCRIPTION','PARTICIPANT_DATA_TO_CHECK','DECISION_OPERATOR','DECISION_VALUE','TRUE_TARGET_TYPE','TRUE_TARGET','FALSE_TARGET_TYPE','FALSE_TARGET']),rows:[]});
 const flow=buildVoiceInventory(source).flows[0],options=designerOptions({snapshot:source,flow});
 return {snapshot:source,flow,options,form:{type:'decision',tableId:'decision',name:'État',key:'NEW',placementId:options.placements[0].id,continuationField:'TRUE_TARGET_TYPE',values:{PARTICIPANT_DATA_TO_CHECK:'STATUT',DECISION_OPERATOR:'==',DECISION_VALUE:'FERME'}}};
}
test('new decision blocks use the same catalogue and reject invalid values before changing routing',()=>{
 const fixture=designerFixture(),before=structuredClone(fixture.snapshot);
 const prepare=values=>prepareNewBlock({snapshot:fixture.snapshot,flow:fixture.flow,...fixture.form,values:{...fixture.form.values,...values}});
 assert.equal(fixture.options.participantData.definitions.length,4);
 assert.equal(prepare({}).ok,true);
 for(const values of [{DECISION_VALUE:'Agence fermée'},{PARTICIPANT_DATA_TO_CHECK:'INCONNU'},{DECISION_OPERATOR:'contains'},{PARTICIPANT_DATA_TO_CHECK:'NOMBRE',DECISION_VALUE:'2.5'}]){
  const plan=prepare(values);assert.equal(plan.ok,false);assert.deepEqual(plan.createdRows,[]);assert.deepEqual(plan.updatedRows,[]);
 }
 assert.deepEqual(fixture.snapshot,before);
});
test('designer shows labels and typed comparison choices, with no value input for presence checks',()=>{
 const {options,form}=designerFixture();
 const html=designerView({mode:'insert',options,form});
 assert.match(html,/<select[^>]*data-field="PARTICIPANT_DATA_TO_CHECK"/);assert.match(html,/Libellé STATUT/);
 assert.match(html,/<select[^>]*data-field="DECISION_VALUE"/);assert.match(html,/Agence fermée/);
 assert.doesNotMatch(html,/value="contains"/);
 const presence=designerView({mode:'insert',options,form:{...form,values:{...form.values,DECISION_OPERATOR:'exist'}}});
 assert.doesNotMatch(presence,/data-field="DECISION_VALUE"/);assert.match(presence,/Aucune valeur de comparaison/);
 const empty=designerView({mode:'insert',options:{...options,participantData:{required:true,definitions:[]}},form:{...form,values:{}}});
 assert.match(empty,/<select[^>]*data-field="PARTICIPANT_DATA_TO_CHECK"/);assert.doesNotMatch(empty,/<input[^>]*data-field="PARTICIPANT_DATA_TO_CHECK"/);
});
