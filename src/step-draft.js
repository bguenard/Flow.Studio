import {isV5,immutableV5Field,validateV5Edits} from './v5-fields.js';
import {decisionFields,isV5Decision,validateDecision} from './decision-fields.js';
import { validateResourceChoice } from './genesys-resources.js';
/** Prepare one local step draft across view changes; never mutate input data. */
import { businessFields, humanText } from './business.js';
import { coerceRowValue, isIdentityField } from './draft-fields.js';

const text = value => value == null ? '' : String(value);
const entries = value => value instanceof Map ? [...value] : Object.entries(value || {});

/** Values use the editor representation: plain TTS text, human-readable description. */
export function prepareStepDraft({ node, schema, pending = {}, visibleValues = {}, catalogues = {}, snapshot } = {}) {
  if (!node?.row || typeof node.row !== 'object' || Array.isArray(node.row)) throw Error('L’étape à enregistrer est introuvable.');
  schema = schema || node.schema;
  const row = structuredClone(node.row);
  const editorNode={...node,schema:schema||node.schema};
  const protectedField=key=>isV5(node)&&editorNode.schema?immutableV5Field(node,key):isIdentityField(key);
  const fields = new Map(businessFields(editorNode).filter(field => (field.editable && !protectedField(field.key)) || field.resource).map(field => [field.key, field]));
  // Hidden edits survive a switch of view; the currently visible input wins if
  // the same field has a more recent value in the DOM.
  const values = new Map([...entries(pending), ...entries(visibleValues)]);
  for (const [key, input] of values) {
    const field = fields.get(key);
    if (!field) throw Error('Ce réglage ne peut pas être modifié depuis cet écran. Les références et identifiants doivent être conservés.');
    const hasPending=entries(pending).some(([k])=>k===key);
    // Displaying an optional field must never create or clear a DT value by itself.
    // The editor shows a message without its tts: prefix, and a number control shows nothing for a
    // non-numeric value ($var:…$): neither is an edit.
    const shownAudio=(field.kind==='audio'||field.resource?.audio)&&typeof input==='string'&&/^tts:/i.test(text(node.row[key]))&&text(node.row[key]).slice(4)===input;
    const hiddenNumber=field.kind==='number'&&input===''&&Number.isNaN(Number(text(node.row[key]).trim()||NaN));
    if(!hasPending && ((node.row[key]==null||node.row[key]==='')&&input==='' || String(node.row[key])===String(input) || field.kind==='boolean'&&String(node.row[key]).toLowerCase()===String(input).toLowerCase() || shownAudio || hiddenNumber))continue;
    let value = input;
    try {
      if (field.resource?.external && input && typeof input==='object' && Object.hasOwn(input,'external')) {
        if(typeof input.external!=='string'||!input.external.trim())throw Error('Renseignez l’identifiant du bot externe.');
        row[key]=coerceRowValue(node.row[key],input.external,schema?.properties?.[key]);
        continue;
      }
      if (input && typeof input === 'object' && Object.hasOwn(input,'resource')) {
        row[key]=coerceRowValue(node.row[key],validateResourceChoice(field,node,input.resource,catalogues),schema?.properties?.[key]);
        continue;
      }
      if ((!field.editable && !field.resource?.audio) || protectedField(key)) throw Error('Ce réglage ne peut pas être modifié sans sélection Genesys.');
      if (key.toUpperCase() === 'DESCRIPTION') {
        const original = text(node.row[key]), label = text(input);
        value = label === humanText(original) || !original.trim() && label === field.editorValue ? original : (original.match(/^\[DRAFT_FROM_[^\]]+\]\s*/i)?.[0] || '') + label + (original.match(/\s*\(template\)\s*$/i)?.[0] || '');
      }
      if (input==='' && Array.isArray(schema?.properties?.[key]?.type) && schema.properties[key].type.includes('null')){row[key]=coerceRowValue(node.row[key],null,schema.properties[key]);continue;}
      if (field.kind === 'number') {
        const numeric = text(value).trim();
        if (!numeric || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric) || !Number.isFinite(Number(numeric))) throw Error('Saisissez un nombre valide.');
      }
      if (field.kind === 'boolean' && ![true, false, 'true', 'false'].includes(value)) throw Error('Choisissez Oui ou Non.');
      if (field.kind === 'audio') {
        if (node.row[key] == null && input === '' && !entries(pending).some(([fieldKey]) => fieldKey === key)) continue;
        const plain = text(value);
        if (plain.includes('|') || /\$?var:/i.test(plain)) throw Error('Saisissez uniquement le texte du message à lire au client.');
        value = plain.trim() ? `tts:${plain}` : '';
      }
      row[key] = coerceRowValue(node.row[key], value, schema?.properties?.[key]);
    } catch (error) { throw Error(`${field.label} : ${error.message}`); }
  }
  if(editorNode.schema)validateV5Edits(editorNode,row,{snapshot});
  else if (isV5Decision(node) && decisionFields.some(key => JSON.stringify(row[key]) !== JSON.stringify(node.row[key]))) validateDecision(row,{snapshot});
  return row;
}
