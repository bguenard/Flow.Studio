import {esc} from './ui-kit.js';
const literal=value=>/^(true|false)$/i.test(String(value??''));
/** Preserve string spelling and enum tokens; conversion to a native boolean stays in the schema coercer. */
export function booleanSwitchSpec(value,{kind='text',key='',schema={}}={}){
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 const typed=kind==='boolean'||types.includes('boolean');
 const values=schema.enum;
 if(values&&(!values.some(v=>String(v).toLowerCase()==='true')||!values.some(v=>String(v).toLowerCase()==='false')||values.some(v=>v!==null&&!literal(v))))return null;
 if(!typed&&(!['text','string'].includes(kind)||['DESCRIPTION','PARTICIPANT_DATA_TO_CHECK'].includes(key)||!literal(value)&&!values))return null;
 if(value!=null&&value!==''&&!literal(value))return null;
 const token=String(value??'');
 const format=word=>typed?word:token&&token===token.toUpperCase()?word.toUpperCase():/^[A-Z][a-z]+$/.test(token)?word[0].toUpperCase()+word.slice(1):word;
 return {on:String(values?.find(v=>String(v).toLowerCase()==='true')??format('true')),off:String(values?.find(v=>String(v).toLowerCase()==='false')??format('false')),checked:token.toLowerCase()==='true',empty:value==null||value==='',typed};
}
export function booleanControl({id,attrs,value,spec,label,textAction='',key=''}){
 const inputAttrs=attrs.replace(`id="${id}"`,`id="${id}-value"`);
 return `<div class="boolean-control"><input type="hidden" ${inputAttrs} data-boolean-value value="${esc(value??'')}"><button type="button" id="${id}" class="value-switch" role="switch" aria-label="${esc(label)}" aria-checked="${spec.checked}" data-action="boolean-toggle" data-on="${esc(spec.on)}" data-off="${esc(spec.off)}"><span class="value-switch-track" aria-hidden="true"></span><span class="value-switch-state" aria-hidden="true">${spec.empty?'Non renseigné':spec.checked?'Oui':'Non'}</span></button>${textAction&&!spec.typed?`<button type="button" class="btn quiet small boolean-text-mode" data-action="${textAction}" data-field-key="${esc(key)}">Saisir une autre valeur</button>`:''}</div>`;
}
