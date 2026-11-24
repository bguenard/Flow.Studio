import test from 'node:test';
import assert from 'node:assert/strict';
import {businessFields} from '../src/business.js';
import {businessInspectorModel,compareBusinessFields} from '../src/journey-audience.js';
import {prepareStepDraft} from '../src/step-draft.js';
import {decisionOperators} from '../src/decision-fields.js';
const node={id:'decision:qualif',type:'decision',tableName:'W_DECISION_v5',row:{key:'qualif',DESCRIPTION:'Qualification requise',PARTICIPANT_DATA_TO_CHECK:'Qualif Requise',DECISION_OPERATOR:'==',DECISION_VALUE:'True',TRUE_TARGET_TYPE:'service',TRUE_TARGET:'YES',FALSE_TARGET_TYPE:'disconnect',FALSE_TARGET:''}};
const schema={properties:Object.fromEntries(Object.keys(node.row).map(key=>[key,{type:'string'}]))};

test('V5 conditions expose three editable fields in the business and admin models',()=>{
 const fields=businessFields(node),group=businessInspectorModel(node).groups.find(g=>g.fields.some(f=>f.key==='PARTICIPANT_DATA_TO_CHECK'));
 for(const key of ['PARTICIPANT_DATA_TO_CHECK','DECISION_OPERATOR','DECISION_VALUE']){
  assert.equal(fields.find(f=>f.key===key).editable,true);
  assert.ok(group.fields.some(f=>f.key===key));
 }
 assert.equal(fields.find(f=>f.key==='PARTICIPANT_DATA_TO_CHECK').kind,'text');
 assert.deepEqual(fields.find(f=>f.key==='DECISION_OPERATOR').options,decisionOperators);
 const legacy=businessFields({...node,tableName:'W_DECISION_v4'});
 assert.equal(legacy.find(f=>f.key==='DECISION_OPERATOR').editable,false);
});
test('condition edits survive draft serialization without changing identity or branches',()=>{
 const original=structuredClone(node);
 const row=prepareStepDraft({node,schema,pending:{PARTICIPANT_DATA_TO_CHECK:'segment client',DECISION_OPERATOR:'contains'},visibleValues:{DECISION_VALUE:'Premium'}});
 const restored=JSON.parse(JSON.stringify(row));
 assert.equal(restored.PARTICIPANT_DATA_TO_CHECK,'segment client');assert.equal(restored.DECISION_OPERATOR,'contains');assert.equal(restored.DECISION_VALUE,'Premium');
 for(const key of ['key','TRUE_TARGET_TYPE','TRUE_TARGET','FALSE_TARGET_TYPE','FALSE_TARGET'])assert.equal(restored[key],node.row[key]);
 assert.deepEqual(node,original);
});
test('conditions reject invalid operators and missing values while presence checks allow blank values',()=>{
 for(const pending of [{PARTICIPANT_DATA_TO_CHECK:' '},{DECISION_OPERATOR:'!='},{DECISION_VALUE:''}])assert.throws(()=>prepareStepDraft({node,schema,pending}));
 for(const operator of ['exist','empty'])assert.equal(prepareStepDraft({node,schema,pending:{DECISION_OPERATOR:operator,DECISION_VALUE:''}}).DECISION_VALUE,'');
 assert.equal(prepareStepDraft({node,schema,pending:{DECISION_VALUE:'0'}}).DECISION_VALUE,'0');
 assert.equal(prepareStepDraft({node,schema,pending:{DECISION_VALUE:'False'}}).DECISION_VALUE,'False');
 const restricted={properties:{...schema.properties,DECISION_OPERATOR:{type:'string',enum:['==']}}};
 assert.throws(()=>prepareStepDraft({node,schema:restricted,pending:{DECISION_OPERATOR:'contains'}}),/autorisée/);
});
test('an unrelated name edit preserves a legacy condition exactly',()=>{
 const legacy={...node,row:{...node.row,DECISION_OPERATOR:'legacy',DECISION_VALUE:null}};
 assert.equal(prepareStepDraft({node:legacy,schema,pending:{DESCRIPTION:'Nouveau nom'}}).DECISION_OPERATOR,'legacy');
});


test('supported V5 operators produce readable summaries, including checks without a value',()=>{
 for(const [operator,value,expected] of [['contains','Premium','Qualif Requise contient Premium'],['exist',null,'Qualif Requise existe'],['empty','','Qualif Requise est vide']]){
  const model=businessInspectorModel({...node,row:{...node.row,DECISION_OPERATOR:operator,DECISION_VALUE:value}});
  assert.equal(model.summary,expected);assert.equal(model.summaryComplete,true);assert.deepEqual(model.notes,[]);
  assert.ok(model.fields.some(f=>f.key==='DECISION_VALUE'));
 }
});

 test('condition controls stay together before destinations in both inspector modes',()=>{
 const shuffled={...node,schema,row:Object.fromEntries(Object.entries(node.row).reverse())};
 const admin=businessFields(shuffled).sort(compareBusinessFields).map(f=>f.key);
 assert.deepEqual(admin.slice(0,4),['DESCRIPTION','PARTICIPANT_DATA_TO_CHECK','DECISION_OPERATOR','DECISION_VALUE']);
 const business=businessInspectorModel(shuffled);
 assert.deepEqual(business.groups.find(g=>g.id==='condition').fields.map(f=>f.key),['PARTICIPANT_DATA_TO_CHECK','DECISION_OPERATOR','DECISION_VALUE']);
 assert.ok(admin.indexOf('DECISION_VALUE')<admin.indexOf('TRUE_TARGET_TYPE'));
 });
