/** Shared definitions; Architect runtime values remain in their WOLF tables. */
import {participantIdentity,participantAssignments} from './participant-names.js';
export const PARTICIPANT_CATALOGUE='STUDIO_PARTICIPANT_DATA_V5';
export const PARTICIPANT_CATALOGUE_DESCRIPTION='WOLF_STUDIO_PARTICIPANT_CATALOGUE_V1 — Attributs et divisions';
export const PARTICIPANT_TYPES=Object.freeze({text:'Texte',integer:'Entier',boolean:'Oui / Non',list:'Liste de valeurs'});
const baseFields=['key','LABEL','DIVISION','DIVISION_ID','VALUE_TYPE','DEFAULT_VALUE'];
const fields=[...baseFields,'ALLOWED_VALUES'];
const keyValid=name=>typeof name==='string'&&name.trim()&&name===name.trim()&&!/[|;=\r\n]/.test(name)&&!/^(?:variable$|var:)|\$var:/i.test(name);
const serializable=value=>typeof value==='string'&&!/\|\||==|[\r\n]/.test(value)&&value.length<=4096;
export const isParticipantCatalogue=name=>name===PARTICIPANT_CATALOGUE;
export const catalogueRows=snapshot=>snapshot?.tables?.find(t=>isParticipantCatalogue(t.name))?.rows||[];
export const catalogueDefinition=(snapshot,name)=>catalogueRows(snapshot).find(r=>r.key===name)||null;
export function participantCatalogueDefinition(divisionId){
 if(typeof divisionId!=='string'||!/^[a-zA-Z0-9_-]+$/.test(divisionId))throw Error('Choisissez la division du catalogue Genesys.');
 return {name:PARTICIPANT_CATALOGUE,description:PARTICIPANT_CATALOGUE_DESCRIPTION,division:{id:divisionId},schema:{$schema:'http://json-schema.org/draft-04/schema#',type:'object',additionalProperties:false,required:['key'],properties:Object.fromEntries(fields.map((field,index)=>[field,{type:'string',title:field,$id:'/properties/'+field,displayOrder:index,minLength:field==='key'?1:0,maxLength:['DEFAULT_VALUE','ALLOWED_VALUES'].includes(field)?4096:256,...(field!=='key'?{default:''}:{})}]))}};
}
export const catalogueNeedsUpgrade=table=>!table?.schema?.properties?.ALLOWED_VALUES;
export function validateParticipantCatalogueTable(table){
 if(!table?.id||table.name!==PARTICIPANT_CATALOGUE||table.description!==PARTICIPANT_CATALOGUE_DESCRIPTION||!table.schema?.properties||baseFields.some(f=>table.schema.properties[f]?.type!=='string')||Object.keys(table.schema.properties).some(f=>!fields.includes(f))||table.schema.properties.ALLOWED_VALUES&&table.schema.properties.ALLOWED_VALUES.type!=='string')throw Error('La table du catalogue est incompatible. Aucune table existante ne sera modifiée.');
 return table;
}
export function participantChoices(definition){
 if(!definition?.ALLOWED_VALUES)return [];
 let choices;try{choices=JSON.parse(definition.ALLOWED_VALUES);}catch{throw Error('La liste des valeurs autorisées est invalide.');}
 if(!Array.isArray(choices)||choices.length>100)throw Error('Une liste accepte au maximum 100 choix.');
 const seen=new Set();
 for(const choice of choices){
  if(!choice||typeof choice.value!=='string'||!choice.value.trim()||choice.value!==choice.value.trim()||!serializable(choice.value)||choice.value.length>256||typeof choice.label!=='string'||!choice.label.trim()||choice.label.length>256)throw Error('Chaque choix doit avoir un libellé et une valeur technique valides.');
  const identity=participantIdentity(choice.value);if(seen.has(identity))throw Error(`La valeur « ${choice.value} » est présente plusieurs fois dans la liste.`);seen.add(identity);
 }
 return choices;
}
export function validateParticipantValue(definition,value,{allowEmpty=false}={}){
 if(!definition)throw Error('Choisissez une donnée du catalogue administrateur.');
 if(!serializable(value))throw Error(`${definition.LABEL||definition.key} : valeur invalide ou séparateur WOLF interdit.`);
 if(value===''&&allowEmpty)return value;
 switch(definition.VALUE_TYPE){
  case 'text':return value;
  case 'boolean':if(!/^(true|false)$/i.test(value))throw Error(`${definition.LABEL||definition.key} : choisissez Oui ou Non.`);break;
  case 'integer':if(!/^[+-]?\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error(`${definition.LABEL||definition.key} : saisissez un entier valide, sans décimale.`);break;
  case 'list':if(!participantChoices(definition).some(c=>c.value===value))throw Error(`${definition.LABEL||definition.key} : choisissez une valeur autorisée dans la liste.`);break;
  default:throw Error('Type de donnée inconnu.');
 }
 return value;
}
export function participantOperators(definition){
 return definition?.VALUE_TYPE==='integer'?['exist','empty','==','>=','<=','>','<']:definition?.VALUE_TYPE==='text'?['exist','empty','contains','==']:['exist','empty','=='];
}
export function validateParticipantDefinition(row){
 if(!row||!keyValid(row.key)||row.key.length>256)throw Error('Nom de donnée invalide.');
 if(baseFields.some(f=>typeof row[f]!=='string')||row.ALLOWED_VALUES!==undefined&&typeof row.ALLOWED_VALUES!=='string')throw Error('Définition du catalogue incomplète.');
 if(!row.LABEL.trim()||row.LABEL.length>256||!row.DIVISION.trim()||!/^[a-zA-Z0-9_-]+$/.test(row.DIVISION_ID))throw Error('Libellé et division Genesys obligatoires.');
 if(!Object.hasOwn(PARTICIPANT_TYPES,row.VALUE_TYPE))throw Error('Type de donnée inconnu.');
 const choices=participantChoices(row);
 if(row.VALUE_TYPE==='list'&&!choices.length)throw Error('Ajoutez au moins un choix à la liste.');
 if(row.VALUE_TYPE!=='list'&&choices.length)throw Error('Les choix sont réservés au type Liste de valeurs.');
 if((row.ALLOWED_VALUES||'').length>4096)throw Error('La liste dépasse la taille maximale du catalogue (4096 caractères).');
 validateParticipantValue(row,row.DEFAULT_VALUE,{allowEmpty:true});return row;
}
export function validateParticipantDefinitions(rows){
 const seen=new Set();for(const row of rows){validateParticipantDefinition(row);const key=participantIdentity(row.key);if(seen.has(key))throw Error(`Plusieurs données portent le nom « ${row.key} » dans le catalogue.`);seen.add(key);}return rows;
}
export function participantDefinition(name,value,division){
 return validateParticipantDefinition({key:name,LABEL:name,DIVISION:division?.name||'',DIVISION_ID:division?.id||'',VALUE_TYPE:/^(true|false)$/i.test(value)?'boolean':'text',DEFAULT_VALUE:value});
}
export function participantUsage(snapshot,name){
 const uses=[];
 for(const table of snapshot?.tables||[]){
  if(/^W_PARTICIPANT_DATA_v5$/i.test(table.name))for(const row of table.rows){
   for(const item of participantAssignments(row))if(item.name===name)uses.push({table:table.name,key:row.key,kind:'initialization',value:item.value,dynamic:/\$var:|^var:/i.test(item.value)});
  }
  if(/^W_DECISION_v5$/i.test(table.name))for(const row of table.rows)if(row.PARTICIPANT_DATA_TO_CHECK===name)uses.push({table:table.name,key:row.key,kind:'condition',operator:row.DECISION_OPERATOR,value:String(row.DECISION_VALUE??''),dynamic:/\$var:|^var:/i.test(String(row.DECISION_VALUE??''))});
 }
 return uses;
}
export function validateParticipantDefinitionChange(before,after,snapshot){
 validateParticipantDefinition(after);
 if(before&&before.key!==after.key)throw Error('La clé technique est immuable. Modifiez uniquement son libellé.');
 if(before&&before.VALUE_TYPE===after.VALUE_TYPE&&JSON.stringify(participantChoices(before).map(c=>c.value).sort())===JSON.stringify(participantChoices(after).map(c=>c.value).sort()))return [];
 const uses=participantUsage(snapshot,after.key);
 for(const use of uses){
  try{
   if(use.kind==='condition'&&!participantOperators(after).includes(use.operator))throw Error('Opérateur existant incompatible avec ce type.');
   if(!use.dynamic&&!(use.kind==='condition'&&['exist','empty'].includes(use.operator)))validateParticipantValue(after,use.value);
  }catch(error){throw Error(`${use.table} · ${use.key} : ${error.message} La définition existante est conservée.`);}
 }
 return uses.filter(u=>u.dynamic);
}
