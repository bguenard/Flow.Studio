/** Pure local comparison decisions. Source rows and remote systems are never changed. */
import { businessFields, describeValue, nodeTitle } from './business.js';
import { coerceRowValue, isIdentityField } from './draft-fields.js';
import { sortDestinations } from './destination-order.js';

const text = (value) => (value == null ? '' : String(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => structuredClone(value);
const canonical = (value) =>
  ({ standardcallflow: 'inboundcall', customcallflow: 'transfercallflow' })[
    text(value).toLowerCase()
  ] || text(value).toLowerCase();
const sameFamily = (left, right) =>
  Boolean(left?.tableName && right?.tableName) &&
  text(left.tableName).toUpperCase() === text(right.tableName).toUpperCase();
const dynamic = (value) =>
  /^variable$/i.test(value) || /^var:/i.test(value) || /\$var:[^$]+\$/i.test(value);
const routeField = (field) => /(^|_)TARGET_TYPE(?:_\d+)?$/.test(text(field));
const routable = new Set([
  'inboundcall',
  'service',
  'schedulegroup',
  'menu',
  'decision',
  'ratiodistrib',
  'bot',
  'transfercallflow',
]);
const noDestination = new Set(['disconnect', 'next', 'enable', 'disable']);
const externalDestination = new Set([
  'queue',
  'number',
  'user',
  'voicemailqueue',
  'voicemailgroup',
  'voicemailuser',
]);
const fieldOf = (node, key) => businessFields(node).find((field) => field.key === key);
const findNode = (flow, id) => (flow?.nodes || []).find((node) => node.id === id);
const editableValue = (field) =>
  field?.kind === 'audio' ? text(field.value).replace(/^tts:/i, '') : clone(field?.value);

function fieldsOf(item) {
  const before = item.beforeEdges || [],
    after = item.afterEdges || [];
  if (before.length > 1 || after.length > 1)
    throw Error(
      'Plusieurs liaisons occupent ce choix. Rapprochez les étapes avant de modifier cette destination.',
    );
  const edge = after[0] || before[0];
  if (!edge || edge.relationship === 'context' || !routeField(edge.field))
    throw Error('Cette liaison ne possède pas de destination simple modifiable ici.');
  const typeField = edge.field,
    targetField = edge.destinationField || typeField.replace('TARGET_TYPE', 'TARGET');
  if ((before[0] && before[0].field !== typeField) || (after[0] && after[0].field !== typeField))
    throw Error('Les deux destinations utilisent des champs différents.');
  if (isIdentityField(typeField) || isIdentityField(targetField))
    throw Error('Les identifiants du parcours sont conservés.');
  if (!own(item.rightNode?.row, typeField) || !own(item.rightNode?.row, targetField))
    throw Error('Les champs de destination sont absents de l’étape cible.');
  return { typeField, targetField, source: before[0], target: after[0] };
}

function mappedNode(source, diff, right) {
  const matches = (diff?.matches || []).filter((match) => match.leftNode.id === source?.id);
  const candidate = matches.length === 1 ? findNode(right, matches[0].rightNode.id) : null;
  if (
    !candidate ||
    (diff.matches || []).filter((match) => match.rightNode.id === candidate.id).length !== 1 ||
    canonical(source.type) !== canonical(candidate.type) ||
    !sameFamily(source, candidate)
  ) {
    throw Error(
      'La destination source n’a pas de correspondance unique dans le parcours cible. Rapprochez les étapes ou choisissez une destination.',
    );
  }
  if (!text(candidate.key) || dynamic(text(candidate.key)))
    throw Error('La clé de l’étape cible ne permet pas une référence statique.');
  return candidate;
}

function remapContext(rawTarget, diff, left, right) {
  const extras = text(rawTarget).split('|').slice(1);
  return extras.map((extra) => {
    if (!/^pdata:/i.test(extra))
      throw Error(
        'La destination contient une option non interprétée. Sa copie automatique est indisponible.',
      );
    const keys = extra.slice(6).split(';');
    if (keys.some((key) => !key))
      throw Error('Le contexte associé à la destination est incomplet.');
    const rewritten = keys.map((key) => {
      const sources = (left?.nodes || []).filter(
        (node) => canonical(node.type) === 'pdata' && text(node.key) === key,
      );
      if (sources.length !== 1)
        throw Error('Le contexte client source doit être résolu et rapproché avant la copie.');
      try {
        return text(mappedNode(sources[0], diff, right).key);
      } catch {
        throw Error(
          'Le contexte client source n’a pas de correspondance unique dans le parcours cible.',
        );
      }
    });
    return `${extra.slice(0, 6)}${rewritten.join(';')}`;
  });
}

function copiedDestination(item, diff, left, right) {
  const fields = fieldsOf(item),
    sourceRow = item.leftNode?.row;
  if (!sameFamily(item.leftNode, item.rightNode))
    throw Error('La copie nécessite la même famille et la même version de table.');
  if (!fields.source || !own(sourceRow, fields.typeField) || !own(sourceRow, fields.targetField))
    throw Error('La branche source est absente ; sa suppression n’est pas automatisée.');
  const rawType = text(sourceRow[fields.typeField]).split('|')[0],
    type = canonical(rawType.trim());
  const rawTarget = text(sourceRow[fields.targetField]),
    main = rawTarget.split('|')[0];
  const extras = remapContext(rawTarget, diff, left, right);
  let key = main,
    destinationLabel = '';
  if (!noDestination.has(type) && !externalDestination.has(type) && !dynamic(main)) {
    const source = findNode(left, fields.source.to);
    if (!source || text(source.key) !== main || canonical(source.type) !== type)
      throw Error(
        'La destination source est introuvable ou ambiguë. Rapprochez les étapes avant de la copier.',
      );
    const mapped = mappedNode(source, diff, right);
    key = text(mapped.key);
    destinationLabel = nodeTitle(mapped);
  }
  if (!rawType.trim()) throw Error('Le type de destination source est absent.');
  return { ...fields, baseType: rawType, rawTarget: [key, ...extras].join('|'), destinationLabel };
}

function destinationType(node, right) {
  const type = canonical(node.type);
  if (text(right?.version) === '4')
    return { inboundcall: 'standardcallflow', transfercallflow: 'customcallflow' }[type] || type;
  return type;
}

function destinationOptions(right) {
  return sortDestinations(
    (right?.nodes || [])
      .filter(
        (node) => routable.has(canonical(node.type)) && text(node.key) && !dynamic(text(node.key)),
      )
      .map((node) => ({
        value: node.id,
        nodeId: node.id,
        label: nodeTitle(node),
        type: destinationType(node, right),
      })),
  );
}

function modifierParts(raw, key) {
  return text(raw)
    .split('|')
    .slice(1)
    .filter((part) => text(part).split(':')[0].toLowerCase() === key);
}

function modifierSource(item) {
  const fields = fieldsOf(item),
    key = item.modifierKey;
  if (!['sub', 'lang'].includes(key))
    throw Error('Cette option complémentaire n’est pas interprétée par le Studio.');
  if (!sameFamily(item.leftNode, item.rightNode))
    throw Error('La copie nécessite la même famille et la même version de table.');
  if (!fields.source || !fields.target || !own(item.leftNode?.row, fields.typeField))
    throw Error('La transition doit exister des deux côtés avant de reprendre cette option.');
  const source = modifierParts(item.leftNode.row[fields.typeField], key),
    target = modifierParts(item.rightNode.row[fields.typeField], key);
  if (source.length > 1 || target.length > 1)
    throw Error(
      'Cette option apparaît plusieurs fois sur la transition ; sa copie serait ambiguë.',
    );
  return { ...fields, key, source };
}

/** Choice descriptions use the current target value; audio edits receive plain TTS text. */
export function comparisonChoices(diff, left, right) {
  return (diff?.items || []).map((item) => {
    let canCopy = false,
      canEdit = false,
      kind = 'unsupported',
      value = clone(item.after),
      notice = '',
      copyReason = '',
      editReason = '';
    let options;
    if (item.field) {
      const source = fieldOf(item.leftNode, item.field),
        target = fieldOf(item.rightNode, item.field);
      kind = target?.kind || source?.kind || 'unsupported';
      value = editableValue(target);
      if (isIdentityField(item.field))
        copyReason = editReason = 'Les identifiants du parcours sont conservés.';
      else if (!target || !own(item.rightNode?.row, item.field))
        copyReason = editReason = 'Ce réglage est absent de l’étape cible.';
      else {
        canEdit = Boolean(target.editable);
        if (!canEdit)
          editReason =
            'Ce réglage se reprend à l’identique ; sa modification libre n’est pas disponible ici.';
        canCopy = Boolean(
          source &&
            own(item.leftNode?.row, item.field) &&
            sameFamily(item.leftNode, item.rightNode),
        );
        if (!canCopy)
          copyReason = !source
            ? 'Ce réglage est absent de la source.'
            : 'La copie nécessite la même famille et la même version de table.';
        if (['reference', 'list'].includes(kind) || (kind === 'audio' && !source?.editable))
          notice =
            'Les références aux ressources et aux contrôles sont reprises à l’identique. Vérifiez qu’elles conviennent à l’entité cible.';
        if (item.field.toUpperCase() === 'MENU_AUDIO')
          notice = `${notice ? notice + ' ' : ''}Vérifiez que le message annonce bien les choix du menu cible.`;
      }
    } else if (item.modifier) {
      kind = 'modifier';
      try {
        modifierSource(item);
        canCopy = true;
      } catch (error) {
        copyReason = error.message;
      }
      editReason = 'Cette option peut être conservée ou reprise à l’identique.';
      notice =
        item.modifierKey === 'sub'
          ? 'Les noms des contrôles sont conservés. Leurs dépendances externes doivent être vérifiées pour l’entité cible.'
          : '';
    } else if (item.structural) {
      kind = 'destination';
      try {
        const fields = fieldsOf(item);
        options = destinationOptions(right);
        canEdit = options.length > 0;
        value = fields.target?.to || '';
        if (!canEdit) editReason = 'Aucune étape cible disponible dans ce parcours.';
      } catch (error) {
        editReason = error.message;
      }
      try {
        copiedDestination(item, diff, left, right);
        canCopy = true;
      } catch (error) {
        copyReason = error.message;
      }
      notice =
        'La destination est adaptée au parcours cible. Les options de la transition cible et son annonce sont conservées ; les références externes restent à vérifier.';
    } else copyReason = editReason = 'Ce changement nécessite un rapprochement préalable.';
    return {
      ...item,
      canCopy,
      canEdit,
      kind,
      value,
      copyReason,
      editReason,
      notice,
      ...(options ? { destinationOptions: options } : {}),
    };
  });
}

function replaceModifier(raw, key, replacements) {
  const [base, ...parts] = text(raw).split('|');
  const position = parts.findIndex((part) => part.split(':')[0].toLowerCase() === key);
  const retained = parts.filter((part) => part.split(':')[0].toLowerCase() !== key);
  retained.splice(position < 0 ? retained.length : position, 0, ...replacements);
  return [base, ...retained].join('|');
}

function validateEdit(choice, value) {
  if (choice.kind === 'audio') {
    const plain = text(value);
    if (plain.includes('|') || /\$?var:/i.test(plain))
      throw Error('Saisissez uniquement le texte du message à lire au client.');
    return plain.trim() ? `tts:${plain}` : '';
  }
  if (
    choice.kind === 'number' &&
    (!text(value).trim() ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text(value).trim()) ||
      !Number.isFinite(Number(value)))
  )
    throw Error('Saisissez un nombre valide.');
  if (choice.kind === 'boolean' && ![true, false, 'true', 'false'].includes(value))
    throw Error('Choisissez Oui ou Non.');
  return value;
}

/** Any error rejects the entire plan. A valid plan contains cloned target rows only. */
export function prepareComparisonPlan({ left, right, diff, decisions = {}, snapshot } = {}) {
  const choices = new Map(
    comparisonChoices(diff, left, right).map((choice) => [choice.id, choice]),
  );
  const pending = new Map(),
    changes = [],
    errors = [];
  const entries = decisions instanceof Map ? [...decisions] : Object.entries(decisions || {});
  for (const [id, decision] of entries) {
    if (!decision || decision.mode === 'keep') continue;
    try {
      const choice = choices.get(id);
      if (!choice)
        throw Error('Ce réglage ne fait plus partie de la comparaison. Recalculez les écarts.');
      const mode = decision.mode;
      if (!['copy', 'edit'].includes(mode)) throw Error('Choix de reprise inconnu.');
      if (mode === 'copy' && !choice.canCopy) throw Error(choice.copyReason);
      if (mode === 'edit' && !choice.canEdit) throw Error(choice.editReason);
      const node = findNode(right, choice.rightNode?.id),
        source = findNode(left, choice.leftNode?.id);
      if (
        !node ||
        !source ||
        !equal(node.row, choice.rightNode.row) ||
        !equal(source.row, choice.leftNode.row)
      )
        throw Error('Le parcours a changé depuis la comparaison. Recalculez les écarts.');
      const row = clone(pending.get(node.id)?.row || node.row);
      const table = (snapshot?.tables || []).find((table) => table.id === node.tableId);
      if (snapshot && !table)
        throw Error(
          'La table cible est absente de l’instantané ; son schéma ne peut pas être vérifié.',
        );
      const write = (field, input) => {
        if (isIdentityField(field) || !own(node.row, field))
          throw Error('Le champ cible est absent ou appartient à l’identité du parcours.');
        row[field] = coerceRowValue(node.row[field], input, table?.schema?.properties?.[field]);
      };
      let before, after, beforeDisplay, afterDisplay;
      if (choice.field) {
        before = clone(node.row[choice.field]);
        write(
          choice.field,
          mode === 'copy' ? source.row[choice.field] : validateEdit(choice, decision.value),
        );
        after = clone(row[choice.field]);
        beforeDisplay = describeValue(choice.field, before);
        afterDisplay = describeValue(choice.field, after);
      } else if (choice.modifier) {
        const config = modifierSource(choice);
        before = modifierParts(node.row[config.typeField], config.key);
        write(config.typeField, replaceModifier(row[config.typeField], config.key, config.source));
        after = modifierParts(row[config.typeField], config.key);
        beforeDisplay = choice.afterDisplay;
        afterDisplay = choice.beforeDisplay;
      } else {
        const config = fieldsOf(choice);
        // This change describes the destination slot only. Language and control
        // modifiers have their own decisions and review entries.
        before = {
          type: text(node.row[config.typeField]).split('|')[0],
          target: node.row[config.targetField],
        };
        let baseType, target;
        if (mode === 'copy') {
          const copied = copiedDestination(choice, diff, left, right);
          baseType = copied.baseType;
          target = copied.rawTarget;
          afterDisplay = copied.destinationLabel || choice.beforeDisplay;
        } else {
          const selected = (choice.destinationOptions || []).find(
            (option) => option.value === decision.value,
          );
          if (!selected) throw Error('Choisissez une étape du parcours cible.');
          const destination = findNode(right, selected.nodeId);
          baseType = selected.type;
          target = [
            text(destination.key),
            ...text(row[config.targetField]).split('|').slice(1),
          ].join('|');
          afterDisplay = selected.label;
        }
        write(
          config.typeField,
          [baseType, ...text(row[config.typeField]).split('|').slice(1)].join('|'),
        );
        write(config.targetField, target);
        after = {
          type: text(row[config.typeField]).split('|')[0],
          target: row[config.targetField],
        };
        beforeDisplay = choice.afterDisplay;
      }
      if (!equal(before, after)) {
        pending.set(node.id, { node, row });
        changes.push({
          id,
          nodeId: node.id,
          label: choice.label,
          before,
          after,
          beforeDisplay,
          afterDisplay,
          mode,
        });
      }
    } catch (error) {
      errors.push({ id, message: error.message });
    }
  }
  return errors.length
    ? { rows: [], changes: [], errors }
    : { rows: [...pending.values()], changes, errors: [] };
}
