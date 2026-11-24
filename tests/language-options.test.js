import test from 'node:test';
import assert from 'node:assert/strict';
import {languageOptions} from '../src/language-options.js';
import {businessFields} from '../src/business.js';
import {stepFieldView} from '../src/step-field-view.js';
import {prepareStepDraft} from '../src/step-draft.js';
test('language choices respect schema enums and preserve exact existing codes',()=>{
 assert.equal(languageOptions({},'fr-fr').find(o=>o.value==='fr-fr').label,'Français');
 assert.deepEqual(languageOptions({enum:['fr-FR']}).map(o=>o.value),['fr-FR']);
 assert.equal(languageOptions({},'ja-jp').find(o=>o.value==='ja-jp').disabled,false);
 assert.equal(languageOptions({enum:['fr-fr']},'en-us').find(o=>o.value==='en-us').disabled,true);
});
test('language editor displays translated options and stores the code rather than its label',()=>{
 const node={tableName:'W_INBOUND_CALL_v5',row:{key:'entry',LANGUAGE:'en-us'},schema:{properties:{key:{type:'string'},LANGUAGE:{type:'string'}}}};
 const field=businessFields(node).find(f=>f.key==='LANGUAGE');
 const html=stepFieldView(field,0,{node});assert.match(html,/<select/);assert.match(html,/value="fr-fr"[^>]*>Français/);
 assert.equal(prepareStepDraft({node,pending:{LANGUAGE:'fr-fr'}}).LANGUAGE,'fr-fr');
});
