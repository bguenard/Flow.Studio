import { MESSAGE_ROUTE_TABLES, MESSAGE_TABLES, messageLocalReference } from './media-profiles.js';
/** Local insertion of one WOLF block and its attached dependencies. No remote writes. */
import { normalizeSnapshot, buildJourneyInventory } from './data-source.js';
import { nodeTitle, branchLabel, humanText } from './business.js';
import { coerceRowValue } from './draft-fields.js';
import { sortDestinations } from './destination-order.js';

const text = (value) => (value == null ? '' : String(value));
const own = (row, field) => Object.prototype.hasOwnProperty.call(row || {}, field);
const clone = (value) => structuredClone(value);
const idFor = (nodeId, field) => JSON.stringify([nodeId, field]);
const typeOf = (value) =>
  ({ standardcallflow: 'inboundcall', customcallflow: 'transfercallflow' })[value] || value;
const isTarget = (field) => /(^|_)TARGET_TYPE(?:_\d+)?$/.test(field);
const dynamic = (value) =>
  /^variable$/i.test(value) || /^var:/i.test(value) || /\$var:[^$]+\$/i.test(value);
const terminal = new Set(['disconnect', 'next', 'enable', 'disable']);
const external = new Set([
  'queue',
  'number',
  'user',
  'voicemailqueue',
  'voicemailgroup',
  'voicemailuser',
]);
const tableTypes = {
  1: MESSAGE_ROUTE_TABLES,
  4: {
    inboundcall: 'W_INBOUND_CALL_v4',
    service: 'W_DISTRIBUTION_v4',
    schedulegroup: 'W_SCHEDULE_GROUP_v4',
    menu: 'W_MENU_v4',
    decision: 'W_DECISION_v4',
    ratiodistrib: 'W_RATIO_DISTRIB_v4',
    transfercallflow: 'W_TRF_FLOW_v4',
  },
  5: {
    inboundcall: 'W_INBOUND_CALL_v5',
    service: 'W_SERVICES_v5',
    schedulegroup: 'W_SCHEDULE_GROUP_v5',
    menu: 'W_MENU_v5',
    decision: 'W_DECISION_v5',
    ratiodistrib: 'W_RATIO_DISTRIB_v5',
    bot: 'W_BOT_v5',
    transfercallflow: 'W_TRANSFER_CALLFLOW_v5',
  },
};
const aliases = {
  service: 'SERVICE',
  menu: 'MENU_NAME',
  schedulegroup: 'SCHEDULE_GROUP_KEY',
  decision: 'DECISION_NAME',
  ratiodistrib: 'RATIO_NAME',
  pdata: 'PDATA_NAME',
};
const menuFields =
  /^(?:INQUEUE_MENU_[1-4]|INQUEUE_REPEAT_MENU|RECORDING_CONSENT_MENU|CONSENT_MENU|CONFIRMATION_ANI_MENU|CONFIRMATION_DIAL_MENU)$/;
const resources =
  /^(?:QUEUE|CALLBACK_QUEUE|SCHEDULE_GROUP|EMERGENCY_GROUP|DIRECT_USER|FLOW_NAME|BOT_NAME|ID_BOT|SKILLS|LANGUAGE_SKILL|SCRIPT)$|AUDIO|HOLD_MUSIC/;
const branchOf = (field) =>
  /^TARGET_TYPE_\d+$/.test(field)
    ? `RATIO${field.match(/\d+$/)[0]}`
    : field === 'TARGET_TYPE'
      ? ''
      : field.replace(/_TARGET_TYPE$/, '');
const rawType = (node, version) =>
  version === '4'
    ? { inboundcall: 'standardcallflow', transfercallflow: 'customcallflow' }[node.type] ||
      node.type
    : node.type;
function replaceTypeBase(raw, requested) {
  const [base, ...options] = text(raw).split('|');
  const equivalent =
    typeOf(base.trim().toLowerCase()) === typeOf(text(requested).trim().toLowerCase());
  return [equivalent ? base : requested, ...options].join('|');
}

function collect(input) {
  const { left, right, sourceNodeId } = input;
  const snapshot = normalizeSnapshot(input.snapshot);
  const sourceNode = left?.nodes?.find((node) => node.id === sourceNodeId);
  if (!sourceNode) throw Error('Choisissez un bloc du parcours source.');
  if (!right?.id || left.id === right.id) throw Error('Choisissez un autre parcours cible.');
  const version = text(right.version);
  if (
    !tableTypes[version] ||
    text(left.version) !== version ||
    text(sourceNode.version || version) !== version
  )
    throw Error('L’insertion nécessite la même version WOLF des deux côtés.');
  const kind = sourceNode.type === 'pdata' ? 'context' : 'route';
  if (
    kind === 'route' &&
    (!tableTypes[version][sourceNode.type] || ['inboundcall', 'segment'].includes(sourceNode.type))
  )
    throw Error(
      'Ce bloc n’est pas une étape de routage insérable. Une entrée ou un contrôle isolé ne peut pas devenir une étape ordinaire.',
    );
  const byId = new Map(snapshot.tables.map((table) => [table.id, table]));
  const byName = new Map();
  for (const table of snapshot.tables) {
    const name = table.name.toUpperCase();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(table);
  }
  const lookup = (name, key) => {
    const tables = byName.get(name.toUpperCase()) || [];
    if (tables.length !== 1)
      throw Error(`Les données d’une étape associée sont absentes ou ambiguës.`);
    const table = tables[0],
      row = table.rows.find((row) => text(row.key) === key);
    if (!row)
      throw Error(
        `Une étape associée « ${humanText(key)} » est introuvable dans les données chargées.`,
      );
    return { table, row };
  };
  const known = new Map(),
    refs = [],
    transitions = [],
    notices = new Set();
  const visit = (table, row, type) => {
    const id = `${table.id}:${text(row.key)}`;
    if (known.has(id)) return id;
    if (known.size >= 100) throw Error('Ce bloc dépasse la limite de 100 dépendances locales.');
    const node = {
      id,
      tableId: table.id,
      tableName: table.name,
      key: text(row.key),
      row,
      type,
      version,
    };
    known.set(id, { table, row, node });
    // PDATA and exceptional-day rows are attached data, not routing tasks.
    if (type === 'pdata' || type === 'exceptionaldays') return id;
    for (const [field, value] of Object.entries(row)) {
      const raw = text(value);
      if (!raw) continue;
      if (isTarget(field)) {
        const destinationField = field.replace('TARGET_TYPE', 'TARGET');
        if (!own(row, destinationField))
          throw Error(`La destination associée à ${field} est absente du bloc.`);
        const base = raw.split('|')[0].trim().toLowerCase(),
          targetType = typeOf(base);
        const target = text(row[destinationField]),
          [key, ...extras] = target.split('|');
        if (
          !terminal.has(base) &&
          !external.has(base) &&
          !tableTypes[version][targetType] &&
          !dynamic(key)
        )
          throw Error(
            `Le type de sortie « ${base} » n’est pas pris en charge pour cette insertion.`,
          );
        transitions.push({
          id: idFor(id, field),
          nodeId: id,
          field,
          destinationField,
          type: base,
          targetType,
          key,
          rawTarget: target,
          label: `${nodeTitle(node)} · ${branchLabel({ field, branch: branchOf(field) })}`,
          requiresConnection: !terminal.has(base) && !external.has(base) && !dynamic(key),
        });
        for (const extra of extras) {
          if (/^pdata:/i.test(extra)) {
            const keys = extra.slice(6).split(';');
            if (keys.some((key) => !key))
              throw Error('Une référence de contexte client du bloc est vide.');
            for (const contextKey of keys) {
              const found = lookup(
                version === '1' ? MESSAGE_TABLES.pdata : `W_PARTICIPANT_DATA_v${version}`,
                contextKey,
              );
              refs.push({
                from: id,
                field: destinationField,
                oldKey: contextKey,
                kind: 'pdata',
                to: visit(found.table, found.row, 'pdata'),
              });
            }
          } else
            notices.add(
              'Une option complémentaire de destination est conservée telle quelle ; son interprétation doit être vérifiée.',
            );
        }
        if (dynamic(key))
          notices.add(
            'Une destination est calculée pendant l’appel ; son expression est conservée.',
          );
        if (external.has(base))
          notices.add(
            'Les destinations externes sont conservées et doivent être vérifiées pour l’entité cible.',
          );
        if (/\|sub:/i.test(raw))
          notices.add(
            'Les contrôles automatiques sont conservés ; leurs dépendances internes ne sont pas clonées.',
          );
      } else if (
        (version === '1' && messageLocalReference(field)) ||
        menuFields.test(field) ||
        (field === 'EXCEPTIONAL_DAYS_NAME' && version === '4')
      ) {
        if (dynamic(raw)) {
          notices.add('Une dépendance est déterminée pendant l’appel ; sa valeur est conservée.');
          continue;
        }
        const isMenu = menuFields.test(field);
        const found = lookup(
          version === '1'
            ? messageLocalReference(field)
            : isMenu
              ? `W_MENU_v${version}`
              : 'W_EXCEPTIONAL_DAYS_v4',
          raw,
        );
        refs.push({
          from: id,
          field,
          kind: 'direct',
          to: visit(
            found.table,
            found.row,
            version === '1'
              ? messageLocalReference(field) === MESSAGE_TABLES.card
                ? 'card'
                : 'quickreplies'
              : isMenu
                ? 'menu'
                : 'exceptionaldays',
          ),
        });
      } else if (/SUBROUTINES?_LIST/.test(field))
        notices.add(
          'Les contrôles automatiques sont conservés ; leurs dépendances internes ne sont pas clonées.',
        );
      else if (resources.test(field) && !/^tts:/i.test(raw))
        notices.add(
          'Les références aux files, calendriers, messages et autres ressources sont conservées ; vérifiez leur disponibilité pour l’entité cible.',
        );
    }
    return id;
  };
  const sourceTable = byId.get(sourceNode.tableId),
    sourceRow = sourceTable?.rows.find((row) => text(row.key) === text(sourceNode.key));
  if (!sourceRow || JSON.stringify(sourceRow) !== JSON.stringify(sourceNode.row))
    throw Error('Le bloc source a changé depuis son affichage. Recalculez la comparaison.');
  if (
    kind === 'context' &&
    sourceTable.name.toUpperCase() !==
      (version === '1' ? MESSAGE_TABLES.pdata : `W_PARTICIPANT_DATA_v${version}`).toUpperCase()
  )
    throw Error('Le contexte sélectionné ne provient pas de la table de contexte WOLF attendue.');
  if (
    kind === 'route' &&
    sourceTable.name.toUpperCase() !== tableTypes[version][sourceNode.type].toUpperCase()
  )
    throw Error('La table source ne correspond pas au type du bloc.');
  visit(sourceTable, sourceRow, sourceNode.type);
  // References inside the attached dependency closure (including cycles) are
  // remapped. Every other static route is an explicit boundary to reconnect.
  const outlets = [];
  for (const transition of transitions) {
    const name = tableTypes[version][transition.targetType];
    const match =
      name &&
      [...known.values()].find(
        (item) =>
          item.table.name.toUpperCase() === name.toUpperCase() &&
          text(item.row.key) === transition.key,
      );
    if (match && !dynamic(transition.key))
      refs.push({
        from: transition.nodeId,
        field: transition.destinationField,
        kind: 'target',
        to: match.node.id,
      });
    else outlets.push(transition);
  }
  const leftIds = new Set(left.nodes.map((node) => node.id));
  const placements = [];
  for (const node of right.nodes || []) {
    if (leftIds.has(node.id) || node.type === 'pdata') continue;
    for (const [field, value] of Object.entries(node.row || {})) {
      const destinationField = field.replace('TARGET_TYPE', 'TARGET');
      if (!isTarget(field) || !text(value).trim() || !own(node.row, destinationField)) continue;
      const base = text(value).split('|')[0].trim().toLowerCase();
      if (!terminal.has(base) && !external.has(base) && !tableTypes[version][typeOf(base)])
        continue;
      if (
        kind === 'context' &&
        text(node.row[destinationField])
          .split('|')
          .slice(1)
          .some((part) => /^pdata:/i.test(part))
      )
        continue;
      placements.push({
        id: idFor(node.id, field),
        fromId: node.id,
        field,
        destinationField,
        label: `${nodeTitle(node)} · ${branchLabel({ field, branch: branchOf(field) })}`,
      });
    }
  }
  if (!placements.length)
    throw Error(
      kind === 'context'
        ? 'Aucune transition cible sans contexte déjà associé n’est disponible. Les transitions partagées avec la source sont également exclues.'
        : 'Aucune transition cible modifiable n’est disponible sans modifier le parcours source partagé.',
    );
  if (kind === 'route' && !outlets.length)
    throw Error('Ce bloc ne possède pas de sortie raccordable au parcours cible.');
  if (kind === 'route')
    notices.add(
      'Les options et le contexte de la transition d’entrée sont conservés avant le nouveau bloc. Chaque sortie reprend ses propres options.',
    );
  const destinations = sortDestinations(
    (right.nodes || [])
      .filter(
        (node) => tableTypes[version][node.type] && text(node.key) && !dynamic(text(node.key)),
      )
      .map((node) => ({
        value: node.id,
        nodeId: node.id,
        label: nodeTitle(node),
        type: rawType(node, version),
      })),
  );
  return {
    snapshot,
    sourceNode,
    kind,
    version,
    known,
    refs,
    outlets,
    placements,
    destinations,
    notices: [...notices],
  };
}

export function blockInsertionOptions(input) {
  try {
    const data = collect(input);
    return {
      sourceNode: data.sourceNode,
      kind: data.kind,
      canInsert: true,
      reason: '',
      placements: data.placements,
      outlets: data.kind === 'context' ? [] : data.outlets,
      destinations: data.destinations,
      notices: data.notices,
    };
  } catch (error) {
    return {
      sourceNode: input.left?.nodes?.find((node) => node.id === input.sourceNodeId),
      kind:
        input.left?.nodes?.find((node) => node.id === input.sourceNodeId)?.type === 'pdata'
          ? 'context'
          : 'route',
      canInsert: false,
      reason: error.message,
      placements: [],
      outlets: [],
      destinations: [],
      notices: [],
    };
  }
}

function checked(table, field, original, value) {
  const property = table.schema?.properties?.[field] || {};
  const result = coerceRowValue(original, value, property);
  if (typeof result === 'string' && property.pattern && !new RegExp(property.pattern).test(result))
    throw Error(`La valeur de ${field} ne respecte pas le format de la table.`);
  return result;
}

/** Deterministic preview, atomic result: callers apply additions + patches together. */
export function prepareBlockInsertion(input) {
  try {
    const data = collect(input),
      { snapshot, sourceNode, kind, version, known, refs } = data;
    const placement = data.placements.find((item) => item.id === input.placementId);
    if (
      !placement &&
      input.left?.nodes?.some((node) =>
        Object.keys(node.row || {}).some((field) => idFor(node.id, field) === input.placementId),
      )
    )
      throw Error(
        'Cette étape est partagée avec le parcours source. Choisissez une autre étape ou créez une déclinaison indépendante.',
      );
    if (!placement) throw Error('Choisissez une transition cible disponible pour l’insertion.');
    const anchor = input.right.nodes.find((node) => node.id === placement.fromId);
    const anchorTable = snapshot.tables.find((table) => table.id === anchor.tableId),
      original = anchorTable?.rows.find((row) => text(row.key) === text(anchor.key));
    if (!original || JSON.stringify(original) !== JSON.stringify(anchor.row))
      throw Error('Le point d’insertion a changé. Recalculez la comparaison.');
    const connections = input.connections || {},
      chosen = Object.entries(connections);
    for (const [id, connection] of chosen)
      if (
        !data.outlets.some((outlet) => outlet.id === id) ||
        !['resume', 'target', 'preserve'].includes(connection?.mode)
      )
        throw Error('Un raccordement de sortie n’est plus disponible.');
    if (
      kind === 'route' &&
      !chosen.some(([, connection]) => connection.mode === 'resume' || connection.mode === 'target')
    )
      throw Error('Choisissez au moins une sortie pour reprendre le parcours cible.');
    const prefix =
      text(input.keyPrefix || 'BLOC_LOCAL')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_]/g, '_')
        .slice(0, 48) || 'BLOC_LOCAL';
    const keyMap = new Map(),
      mappings = [],
      occupied = new Map(
        snapshot.tables.map((table) => [table.id, new Set(table.rows.map((row) => text(row.key)))]),
      );
    let sequence = 1;
    for (const [id, item] of known) {
      const maxLength = item.table.schema?.properties?.key?.maxLength ?? 128;
      if (maxLength < 12)
        throw Error(
          'La taille des clés de cette table est insuffisante pour créer un bloc local distinct.',
        );
      let key;
      do {
        const suffix = `__${sequence++}`;
        key = `DRAFT_${prefix}`.slice(0, maxLength - suffix.length) + suffix;
      } while (occupied.get(item.table.id).has(key));
      key = checked(item.table, 'key', item.row.key, key);
      occupied.get(item.table.id).add(key);
      keyMap.set(id, key);
      mappings.push({
        sourceNodeId: id,
        nodeId: `${item.table.id}:${key}`,
        tableId: item.table.id,
        tableName: item.table.name,
        oldKey: text(item.row.key),
        key,
      });
    }
    const createdRows = [];
    for (const [id, item] of known) {
      const row = clone(item.row),
        mapping = mappings.find((mapping) => mapping.sourceNodeId === id);
      row.key = mapping.key;
      for (const alias of new Set(
        [aliases[item.node.type], item.table.schema?.properties?.key?.title].filter(Boolean),
      ))
        if (own(row, alias) && text(row[alias]) === text(item.row.key))
          row[alias] = checked(item.table, alias, item.row[alias], mapping.key);
      if (own(row, 'DIVISION') && text(input.right.division))
        row.DIVISION = checked(item.table, 'DIVISION', item.row.DIVISION, input.right.division);
      for (const field of new Set(refs.filter((ref) => ref.from === id).map((ref) => ref.field))) {
        const fieldRefs = refs.filter((ref) => ref.from === id && ref.field === field);
        const direct = fieldRefs.find((ref) => ref.kind === 'direct');
        if (direct) row[field] = keyMap.get(direct.to);
        else {
          const parts = text(row[field]).split('|'),
            target = fieldRefs.find((ref) => ref.kind === 'target');
          if (target) parts[0] = keyMap.get(target.to);
          for (let i = 1; i < parts.length; i++)
            if (/^pdata:/i.test(parts[i]))
              parts[i] =
                parts[i].slice(0, 6) +
                parts[i]
                  .slice(6)
                  .split(';')
                  .map(
                    (key) =>
                      keyMap.get(
                        fieldRefs.find((ref) => ref.kind === 'pdata' && ref.oldKey === key)?.to,
                      ) || key,
                  )
                  .join(';');
          row[field] = parts.join('|');
        }
      }
      for (const outlet of data.outlets.filter((outlet) => outlet.nodeId === id)) {
        const connection = connections[outlet.id] || { mode: 'preserve' };
        if (connection.mode === 'preserve') {
          if (outlet.requiresConnection)
            throw Error(`Raccordez la sortie « ${outlet.label} » à une étape cible.`);
          continue;
        }
        let targetType, targetKey;
        if (connection.mode === 'resume') {
          targetType = text(anchor.row[placement.field]).split('|')[0];
          targetKey = text(anchor.row[placement.destinationField]).split('|')[0];
        } else {
          const option = data.destinations.find((option) => option.nodeId === connection.nodeId);
          if (!option) throw Error('La destination de reprise n’appartient pas au parcours cible.');
          targetType = option.type;
          targetKey = text(input.right.nodes.find((node) => node.id === option.nodeId).key);
        }
        row[outlet.field] = replaceTypeBase(row[outlet.field], targetType);
        row[outlet.destinationField] = [
          targetKey,
          ...text(row[outlet.destinationField]).split('|').slice(1),
        ].join('|');
      }
      for (const [field, value] of Object.entries(row))
        if (JSON.stringify(value) !== JSON.stringify(item.row[field]))
          row[field] = checked(item.table, field, item.row[field], value);
      createdRows.push({
        tableId: item.table.id,
        tableName: item.table.name,
        row,
        nodeId: mapping.nodeId,
        sourceNodeId: id,
      });
    }
    const anchorRow = clone(anchor.row),
      entryKey = keyMap.get(sourceNode.id);
    if (kind === 'context')
      anchorRow[placement.destinationField] =
        text(anchorRow[placement.destinationField]) + `|pdata:${entryKey}`;
    else {
      anchorRow[placement.field] = replaceTypeBase(
        anchorRow[placement.field],
        rawType(sourceNode, version),
      );
      anchorRow[placement.destinationField] = [
        entryKey,
        ...text(anchorRow[placement.destinationField]).split('|').slice(1),
      ].join('|');
    }
    for (const field of [placement.field, placement.destinationField])
      anchorRow[field] = checked(anchorTable, field, anchor.row[field], anchorRow[field]);
    const draft = clone(snapshot);
    for (const addition of createdRows)
      draft.tables.find((table) => table.id === addition.tableId).rows.push(addition.row);
    const anchorRows = draft.tables.find((table) => table.id === anchor.tableId).rows;
    anchorRows[anchorRows.findIndex((row) => text(row.key) === text(anchor.key))] = anchorRow;
    const projected = normalizeSnapshot(draft),
      targetFlow = buildJourneyInventory(projected).flows.find(
        (flow) => flow.id === input.right.id,
      );
    if (!targetFlow?.nodes.some((node) => node.id === `${sourceNode.tableId}:${entryKey}`))
      throw Error(
        'Le bloc inséré n’est pas accessible depuis le parcours cible. Aucun changement préparé.',
      );
    return {
      snapshot: projected,
      createdRows,
      updatedRows: [{ node: anchor, row: anchorRow }],
      summary: {
        title: nodeTitle(sourceNode),
        kind,
        sourceNodeId: sourceNode.id,
        targetFlowId: input.right.id,
        placementId: placement.id,
        placementLabel: placement.label,
        nodeCount: createdRows.length,
        mappings,
        notices: data.notices,
        localOnly: true,
      },
      errors: [],
    };
  } catch (error) {
    return {
      snapshot: null,
      createdRows: [],
      updatedRows: [],
      summary: null,
      errors: [{ message: error.message }],
    };
  }
}
