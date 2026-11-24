import test from 'node:test';
import assert from 'node:assert/strict';
import {FLOW_INITIALIZATION,FLOW_INITIALIZATION_FIELDS,flowInitializationDefinition,validateFlowInitializationTable,validateFlowInitializationRow,validateFlowInitializationCatalogue,initializationAttributes,createFlowInitializationRow,prepareFlowInitializationMigration} from '../src/flow-initialization.js';
import {participantCatalogueDefinition} from '../src/participant-catalogue.js';
const definition=(key,type='text',extra={})=>({key,LABEL:key,DIVISION:'G2S',DIVISION_ID:'g2s',VALUE_TYPE:type,DEFAULT_VALUE:'',ALLOWED_VALUES:'',...extra});
function fixture(){return {source:{partial:false},tables:[
 {id:'entries',name:'W_INBOUND_CALL_V5',rows:[{key:'+33999999501',DESCRIPTION:'Gan · Relation client',DIVISION:'Gan',NEXT_TARGET:'MENU|audio:keep|pdata:BASE;LOCAL|extra:untouched',NEXT_TARGET_TYPE:'menu',CLOSED_TARGET:'X|pdata:LATER'}]},
 {id:'pdata',name:'W_PARTICIPANT_DATA_v5',rows:[{key:'BASE',PDATA_LIST_1:'ACTIVE==TRUE||COUNT==+003',UNRELATED:'keep'},{key:'LOCAL',PDATA_LIST_1:'STATUS==OPEN',PDATA_LIST_2:'NOTE==  exact  '},{key:'LATER',PDATA_LIST_1:'NEVER_ENTRY==later'},{key:'BROKEN_UNRELATED',PDATA_LIST_1:'malformed'}]},
 {id:'catalogue',...participantCatalogueDefinition('g2s'),rows:[definition('ACTIVE','boolean'),definition('COUNT','integer'),definition('STATUS','list',{ALLOWED_VALUES:JSON.stringify([{value:'OPEN',label:'Ouverte'},{value:'CLOSED',label:'Fermée'}])}),definition('NOTE')]}
]};}
const migrate=snapshot=>prepareFlowInitializationMigration(snapshot||fixture());
const target=rows=>({id:'init',...flowInitializationDefinition('g2s'),rows});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('dedicated schema owns exactly 48 strings and fifteen distinct triplets',()=>{
 const table=target([]);assert.equal(table.name,FLOW_INITIALIZATION);assert.equal(Object.keys(table.schema.properties).length,48);
 assert.deepEqual(Object.keys(table.schema.properties),FLOW_INITIALIZATION_FIELDS);assert.equal(table.schema.properties.ATTRIBUTE_15_VALUE.type,'string');assert.equal(validateFlowInitializationTable(table),table);
 for(const field of FLOW_INITIALIZATION_FIELDS)assert.equal(table.schema.properties[field].type,'string');
 assert.throws(()=>flowInitializationDefinition(''),/division/);
});
test('foreign, narrowed and ambiguous schemas cannot receive initialization writes',()=>{
 for(const mutation of [t=>t.description='foreign',t=>delete t.schema.properties.ATTRIBUTE_15_VALUE,t=>t.schema.properties.SURPRISE={type:'string'},t=>t.schema.properties.ATTRIBUTE_01_VALUE.type='boolean',t=>t.schema.properties.ATTRIBUTE_01_VALUE.readOnly=true,t=>t.schema.required.push('DESCRIPTION'),t=>t.schema.additionalProperties=true]){const t=target([]);mutation(t);assert.throws(()=>validateFlowInitializationTable(t),/incompatible/);}
});
test('migration preserves exact numbers, types, values and legacy source without traversing later branches',()=>{
 const source=fixture(),before=structuredClone(source);freeze(source);const plan=migrate(source);
 assert.equal(plan.ok,true);assert.equal(plan.legacyPreserved,true);assert.equal(plan.rows.length,1);assert.equal(plan.rows[0].key,'+33999999501');
 assert.deepEqual(initializationAttributes(plan.rows[0]).map(({name,type,value})=>({name,type,value})),[{name:'ACTIVE',type:'bool',value:'TRUE'},{name:'COUNT',type:'int',value:'+003'},{name:'STATUS',type:'string',value:'OPEN'},{name:'NOTE',type:'string',value:'  exact  '}]);
 assert.equal(plan.rows[0].DIVISION,'Gan');assert.equal(plan.rows[0].DESCRIPTION,'Gan · Relation client');assert.equal(plan.rows[0].ATTRIBUTE_15_NAME,'');assert.deepEqual(source,before);
 assert.equal(plan.rows[0].ATTRIBUTE_01_VALUE,'TRUE');assert.equal(plan.rows[0].ATTRIBUTE_02_VALUE,'+003');assert.equal(plan.report[0].attributes,4);
});
test('all numbered entries have independent rows, empty starts stay empty, symbolic roots are skipped',()=>{
 const s=fixture();s.tables[0].rows.push({key:'00123',DIVISION:'CR',DESCRIPTION:'Vide',NEXT_TARGET:'MENU'},{key:'ROOT',NEXT_TARGET:'MENU|pdata:BASE'},{key:'123',NEXT_TARGET:'MENU|pdata:BASE'},{key:'+123',NEXT_TARGET:'MENU|pdata:BASE'});
 const p=migrate(s);assert.equal(p.ok,true);assert.deepEqual(p.rows.map(r=>r.key),['+123','+33999999501','00123','123']);assert.equal(initializationAttributes(p.rows.find(r=>r.key==='00123')).length,0);assert.deepEqual(p.skipped,[{key:'ROOT',reason:'Entrée non numérotée'}]);
 const sibling=p.rows.find(r=>r.key==='123');sibling.ATTRIBUTE_01_VALUE='false';assert.equal(p.rows.find(r=>r.key==='+123').ATTRIBUTE_01_VALUE,'TRUE');
});
test('existing dedicated rows are compared and never returned as writes',()=>{
 const s=fixture(),row=migrate(s).rows[0];s.tables.push(target([structuredClone(row)]));const identical=migrate(s);
 assert.equal(identical.ok,true);assert.equal(identical.rows.length,0);assert.equal(identical.existing[0].status,'identical');
 s.tables.at(-1).rows[0].ATTRIBUTE_01_VALUE='false';const before=structuredClone(s),different=migrate(s);
 assert.equal(different.ok,false);assert.equal(different.rows.length,0);assert.equal(different.existing[0].status,'different');assert.deepEqual(different.existing[0].differences,[{field:'ATTRIBUTE_01_VALUE',before:'false',after:'TRUE'}]);assert.deepEqual(s,before);
});
test('omitted empty slots compare equal to default empty fields',()=>{
 const s=fixture(),row=migrate(s).rows[0];for(const key of Object.keys(row))if(row[key]==='')delete row[key];s.tables.push(target([row]));assert.equal(migrate(s).existing[0].status,'identical');
});
test('duplicate attributes or repeated entry groups reject the affected row without guessing precedence',()=>{
 for(const value of ['MENU|pdata:BASE;BASE','MENU|pdata:BASE;DUP']){const s=fixture();s.tables[0].rows[0].NEXT_TARGET=value;s.tables[1].rows.push({key:'DUP',PDATA_LIST_1:'active==true'});const p=migrate(s);assert.equal(p.ok,false);assert.equal(p.rows.length,0);assert.match(p.errors[0].message,/plusieurs fois/);}
});
test('unknown attributes, invalid list choices and type-invalid values are reported',()=>{
 for(const assignment of ['UNKNOWN==x','STATUS==open','COUNT==1.5','COUNT==1e3','ACTIVE==yes']){const s=fixture();s.tables[1].rows[0].PDATA_LIST_1=assignment;const p=migrate(s);assert.equal(p.ok,false,assignment);assert.equal(p.rows.length,0);assert.equal(p.errors[0].key,'+33999999501');}
});
test('dynamic values and dynamic, empty or missing entry group references cannot be migrated',()=>{
 for(const assignment of ['NOTE==$var:CLIENT$','NOTE==var:CLIENT','NOTE==variable']){const s=fixture();s.tables[1].rows[0].PDATA_LIST_1=assignment;s.tables[0].rows[0].NEXT_TARGET='MENU|pdata:BASE';assert.match(migrate(s).errors[0].message,/calculée/);}
 for(const route of ['MENU|pdata:','MENU|pdata:BASE;','MENU|pdata:$var:GROUP$','MENU|pdata: MISSING','MENU|pdata:MISSING']){const s=fixture();s.tables[0].rows[0].NEXT_TARGET=route;const p=migrate(s);assert.equal(p.ok,false,route);assert.equal(p.rows.length,0);}
});
test('malformed referenced rows fail but unrelated historical malformed groups are untouched',()=>{
 const s=fixture();assert.equal(migrate(s).ok,true);s.tables[0].rows[0].NEXT_TARGET='MENU|pdata:BROKEN_UNRELATED';assert.equal(migrate(s).ok,false);
});
test('capacity accepts exactly fifteen and rejects a sixteenth rather than truncating',()=>{
 const s=fixture(),attributes=Array.from({length:16},(_,i)=>({name:'ATTR_'+i,value:String(i)}));s.tables[2].rows.push(...attributes.map(a=>definition(a.name)));
 const row=createFlowInitializationRow({key:'100',attributes:attributes.slice(0,15)},s);assert.equal(initializationAttributes(row).length,15);assert.equal(row.ATTRIBUTE_15_NAME,'ATTR_14');
 assert.throws(()=>createFlowInitializationRow({key:'100',attributes},s),/maximum 15/);
 s.tables[1].rows[0].PDATA_LIST_1=attributes.map(a=>`${a.name}==${a.value}`).join('||');assert.match(migrate(s).errors[0].message,/maximum 15/);
});
test('row validation rejects orphan triplets, extra fields, nonstrings, ambiguous names and unsafe numbers',()=>{
 const good=migrate().rows[0];
 for(const patch of [{key:' ROOT '},{ATTRIBUTE_01_NAME:''},{ATTRIBUTE_01_VALUE:true},{ATTRIBUTE_02_VALUE:'9007199254740992'},{ATTRIBUTE_01_TYPE:'boolean'},{ATTRIBUTE_15_NAME:'NEW'},{ATTRIBUTE_16_NAME:'TOO_MANY'},{ATTRIBUTE_02_NAME:'active'},{EXTRA:'x'}])assert.throws(()=>validateFlowInitializationRow({...good,...patch}));
 const blank={key:'00100',ATTRIBUTE_01_NAME:'NOTE',ATTRIBUTE_01_TYPE:'string',ATTRIBUTE_01_VALUE:''};assert.equal(validateFlowInitializationRow(blank),blank);
});
test('catalogue matching is exact and verifies declared runtime type',()=>{
 const s=fixture(),row=migrate(s).rows[0];assert.equal(validateFlowInitializationCatalogue(row,s),row);
 assert.throws(()=>validateFlowInitializationCatalogue({...row,ATTRIBUTE_01_TYPE:'string'},s),/type/);
 assert.throws(()=>validateFlowInitializationCatalogue({...row,ATTRIBUTE_01_NAME:'active'},s),/absent/);
});
test('missing or invalid catalogue, duplicate source tables and partial snapshots block planning',()=>{
 const missing=fixture();missing.tables.pop();assert.throws(()=>migrate(missing),/catalogue|STUDIO_PARTICIPANT/);
 const bad=fixture();bad.tables[2].rows[0].VALUE_TYPE='unknown';assert.throws(()=>migrate(bad),/Type/);
 const duplicate=fixture();duplicate.tables.push(structuredClone(duplicate.tables[0]));assert.throws(()=>migrate(duplicate),/Une seule table/);
 const partial=fixture();partial.source.partial=true;assert.throws(()=>migrate(partial),/chargement complet/);
});
test('duplicate numbered entries and ambiguous runtime rows cannot yield creation candidates',()=>{
 const s=fixture();s.tables[0].rows.push(structuredClone(s.tables[0].rows[0]));const p=migrate(s);assert.equal(p.ok,false);assert.equal(p.rows.length,0);
 const runtime=fixture();runtime.tables[1].rows.push(structuredClone(runtime.tables[1].rows[0]));assert.match(migrate(runtime).errors[0].message,/ambigu/);
});
test('pre-existing incompatible dedicated tables and duplicate rows are never treated as new',()=>{
 const s=fixture();s.tables.push({...target([]),description:'FOREIGN'});assert.throws(()=>migrate(s),/incompatible/);
 const duplicate=fixture(),row=migrate(duplicate).rows[0];duplicate.tables.push(target([row,structuredClone(row)]));assert.throws(()=>migrate(duplicate),/Plusieurs lignes/);
});
test('planning is deterministic and catalogue defaults never replace original flow values',()=>{
 const s=fixture();s.tables[2].rows[0].DEFAULT_VALUE='false';const a=migrate(s),b=migrate(s);assert.deepEqual(a,b);assert.equal(a.rows[0].ATTRIBUTE_01_VALUE,'TRUE');
 const entry=s.tables[0].rows[0];entry.NEXT_TARGET='MENU';assert.equal(initializationAttributes(migrate(s).rows[0]).length,0);
});
