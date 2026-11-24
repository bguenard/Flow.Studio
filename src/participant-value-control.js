import {esc} from './ui-kit.js';
import {booleanControl,booleanSwitchSpec} from './boolean-control.js';
import {participantChoices,validateParticipantValue} from './participant-catalogue.js';
/** Typed UI never silently converts a saved value. Validation also runs before save. */
export function renderParticipantValue({definition,value='',id,attrs=`id="${id}"`,label,allowEmpty=false}){
 let invalid='';try{validateParticipantValue(definition,String(value),{allowEmpty});}catch(error){invalid=error.message;}
 const extra=`${attrs} aria-label="${esc(label||definition?.LABEL||'Valeur')}"${invalid?' aria-invalid="true"':''}`;
 let control;
 if(definition?.VALUE_TYPE==='list'){
  const choices=participantChoices(definition);
  control=`<select ${extra}><option value="">${allowEmpty?'Aucune valeur par défaut':'Choisir une valeur…'}</option>${value&&!choices.some(c=>c.value===value)?`<option value="${esc(value)}" selected disabled>${esc(value)} · valeur actuelle hors liste</option>`:''}${choices.map(c=>`<option value="${esc(c.value)}"${c.value===value?' selected':''}>${esc(c.label)}</option>`).join('')}</select>`;
 }else if(definition?.VALUE_TYPE==='boolean'){
  const spec=booleanSwitchSpec(value,{kind:'boolean'})||{on:'true',off:'false',checked:false,empty:true,typed:true};
  control=booleanControl({id,attrs:extra,value,spec,label:label||definition.LABEL});
 }else if(definition?.VALUE_TYPE==='integer'){
  // Text+inputmode keeps legacy invalid text visible; domain validation rejects decimal/exponent.
  control=`<input ${extra} type="text" inputmode="numeric" pattern="[+-]?[0-9]+" value="${esc(value)}" placeholder="Ex. 3">`;
 }else control=`<input ${extra} type="text" maxlength="4096" value="${esc(value)}">`;
 return control+(invalid&&value!==''?`<small class="field-validation" role="status">Valeur actuelle : « ${esc(value)} ». ${esc(invalid)}</small>`:'');
}
