import {
  MESSAGE_TABLES,
  MESSAGE_LABELS,
  MESSAGE_ROUTE_TABLES,
  messageLocalReference,
} from './media-profiles.js';
const text = (v) => (v == null ? '' : String(v));
const dynamic = (v) => /^variable$|^var:|\$var:/i.test(v);
const routeTypeKey = (key) => /(^|_)TARGET_TYPE(?:_\d+)?$/.test(key);
const targetKey = (key, row) => {
  const regular = key.replace('TARGET_TYPE', 'TARGET');
  if (Object.hasOwn(row, regular)) return regular;
  if (key === 'BUSY_TARGET_TYPE' && Object.hasOwn(row, 'TARGET')) return 'TARGET';
  if (key === 'BETWEEN_BOUNDS_TARGET_TYPE' && Object.hasOwn(row, 'BETWEEN_BOUND_TARGET'))
    return 'BETWEEN_BOUND_TARGET';
  return regular;
};
export function buildMessagingFlows(snapshot, parseTarget) {
  const tables = new Map();
  for (const table of snapshot.tables) {
    const name = table.name.toUpperCase();
    tables.set(name, [...(tables.get(name) || []), table]);
  }
  return snapshot.tables
    .filter((t) => t.name.toUpperCase() === MESSAGE_TABLES.segment.toUpperCase())
    .flatMap((table) =>
      table.rows.map((entry) => {
        const id = `${table.id}:${entry.key}`,
          nodes = [],
          edges = [],
          issues = [],
          visited = new Set();
        const issue = (code, message, detail = {}) =>
          issues.push({ code, severity: 'warning', flowId: id, version: '1', message, ...detail });
        function lookup(name, key, detail) {
          const candidates = tables.get(name.toUpperCase()) || [];
          if (candidates.length !== 1) {
            issue(
              candidates.length ? 'ambiguous-table' : 'missing-table',
              `Table ${name} ${candidates.length ? 'ambiguë' : 'absente'}.`,
              detail,
            );
            return null;
          }
          const targetTable = candidates[0],
            targetRow = targetTable.rows.find((r) => text(r.key) === key);
          if (!targetRow) {
            issue('missing-row', `Référence « ${key} » introuvable dans ${name}.`, detail);
            return null;
          }
          return { table: targetTable, row: targetRow };
        }
        function visit(table, row, type, depth = 0) {
          const nodeId = `${table.id}:${row.key}`;
          if (visited.has(nodeId)) return nodeId;
          if (nodes.length >= 250 || depth > 80) {
            issue(
              'traversal-limit',
              'Parcours trop étendu : aperçu limité à 250 étapes et 80 niveaux.',
              { nodeId },
            );
            return nodeId;
          }
          visited.add(nodeId);
          nodes.push({
            id: nodeId,
            type,
            media: 'messaging',
            version: '1',
            engine: 'wolf-message-v1',
            label: MESSAGE_LABELS[type] || type,
            name: text(row.DESCRIPTION || row.key),
            key: text(row.key),
            tableId: table.id,
            tableName: table.name,
            row,
            ...(table.schema ? { schema: table.schema } : {}),
          });
          function link(name, key, edge, linkedType, relationship = 'route') {
            const e = { from: nodeId, to: null, resolved: false, relationship, ...edge };
            edges.push(e);
            if (dynamic(key)) {
              e.dynamic = true;
              return;
            }
            const found = lookup(name, key, { nodeId, field: e.destinationField || e.field });
            if (found) {
              e.to = visit(found.table, found.row, linkedType, depth + 1);
              e.resolved = visited.has(e.to);
            }
          }
          for (const field of Object.keys(row).filter(routeTypeKey)) {
            if (!text(row[field])) continue;
            const option = field.match(/^(OPTION[0-8])_TARGET_TYPE$/)?.[1];
            if (option && !text(row[option + '_LABEL']).trim()) continue;
            const dest = targetKey(field, row),
              ref = parseTarget(row[field], row[dest]);
            const numbered = field.match(/^TARGET_TYPE_(\d+)$/)?.[1];
            const branch = numbered ? `RATIO${numbered}` : field.replace(/_?TARGET_TYPE$/, '');
            const messageField = [
              field.replace('TARGET_TYPE', 'TARGET_MESSAGE'),
              field.replace('TARGET_TYPE', 'MESSAGE'),
            ].find((k) => Object.hasOwn(row, k));
            const edge = {
              ...ref,
              field,
              destinationField: dest,
              branch,
              label: branch || 'Suite',
              phase: /^INQUEUE/.test(branch) ? 'waiting' : 'routing',
              audio: '',
              message: messageField ? text(row[messageField]) : '',
              messageField,
            };
            for (const key of ref.pdataKeys)
              link(
                MESSAGE_TABLES.pdata,
                key,
                {
                  type: 'pdata',
                  target: key,
                  field: dest,
                  destinationField: dest,
                  rawTarget: ref.rawTarget,
                  label: 'Contexte client',
                },
                'pdata',
                'context',
              );
            if (['disconnect', 'next'].includes(ref.type))
              edges.push({
                from: nodeId,
                to: null,
                resolved: true,
                terminal: true,
                relationship: 'route',
                ...edge,
              });
            else if (MESSAGE_ROUTE_TABLES[ref.type])
              link(MESSAGE_ROUTE_TABLES[ref.type], ref.target, edge, ref.type);
            else {
              edges.push({
                from: nodeId,
                to: null,
                resolved: false,
                relationship: 'route',
                ...edge,
              });
              issue(
                'unsupported-target-type',
                `Type Messaging « ${ref.type} » non pris en charge.`,
                { nodeId, field },
              );
            }
          }
          for (const [field, value] of Object.entries(row)) {
            const name = messageLocalReference(field);
            if (name && text(value)) {
              const linkedType = name === MESSAGE_TABLES.card ? 'card' : 'quickreplies';
              link(
                name,
                text(value),
                {
                  type: linkedType,
                  target: text(value),
                  field,
                  destinationField: field,
                  branch: field,
                  label: linkedType === 'card' ? 'Carte du carrousel' : 'Menu associé',
                  phase: /^INQUEUE/.test(field) ? 'waiting' : 'routing',
                  audio: '',
                },
                linkedType,
                'attachment',
              );
            }
          }
          const subroutines = Object.entries(row).flatMap(([field, value]) => {
            if (/SUBROUTINES_LIST/.test(field))
              return text(value)
                .split(';')
                .filter(Boolean)
                .map((name) => ({ field, name }));
            if (routeTypeKey(field))
              return text(value)
                .split('|')
                .filter((p) => /^sub:/i.test(p))
                .flatMap((p) =>
                  p
                    .slice(4)
                    .split(';')
                    .filter(Boolean)
                    .map((name) => ({ field, name })),
                );
            return [];
          });
          for (const { field, name } of subroutines) {
            if (/^get_data_/i.test(name)) {
              const key = name.slice(9).toUpperCase();
              link(
                MESSAGE_TABLES.collect,
                key,
                { type: 'collect', field, target: key, label: 'Collecte de donnée' },
                'collect',
                'context',
              );
            } else
              issue(
                'runtime-subroutine',
                `Contrôle « ${name} » : sa configuration dépend du contexte d’exécution et doit être vérifiée dans Architect.`,
                { nodeId, field },
              );
          }
          if (type === 'service' && text(row.QUEUE))
            edges.push({
              from: nodeId,
              to: null,
              type: 'queue',
              target: text(row.QUEUE),
              field: 'QUEUE',
              destinationField: 'QUEUE',
              branch: 'QUEUE',
              label: 'Mise en relation avec l’équipe',
              phase: 'distribution',
              conditional: true,
              derivedFrom: 'QUEUE',
              relationship: 'route',
              terminal: true,
              resolved: true,
              externalReference: true,
              referenceVerified: false,
              audio: '',
            });
          return nodeId;
        }
        visit(table, entry, 'segment');
        const category = /\[DRAFT_FROM_/i.test(text(entry.DESCRIPTION))
          ? 'draft'
          : /\[[^\]]+\]/.test(text(entry.key)) || /\(template\)/i.test(text(entry.DESCRIPTION))
            ? 'template'
            : 'configured';
        return {
          id,
          key: text(entry.key),
          dnis: '',
          name: text(entry.DESCRIPTION || entry.key),
          description: text(entry.DESCRIPTION),
          division: text(entry.DIVISION),
          language: text(entry.LANGUAGE),
          welcomeAudio: '',
          welcomeMessage: text(entry.WELCOM_MESSAGE),
          media: 'messaging',
          engine: 'wolf-message-v1',
          version: '1',
          category,
          categoryLabel:
            category === 'draft' ? 'Brouillon' : category === 'template' ? 'Modèle' : 'Configuré',
          sourceTableId: table.id,
          sourceTableName: table.name,
          sourceRow: entry,
          entrySchedule: null,
          nodes,
          edges,
          services: nodes.filter((n) => n.type === 'service'),
          schedules: nodes.filter((n) => n.type === 'schedulegroup'),
          menus: nodes.filter((n) => ['quickreplies', 'carousel'].includes(n.type)),
          participantData: nodes.filter((n) => n.type === 'pdata'),
          issues,
          status: issues.length ? 'À vérifier' : 'Références résolues',
        };
      }),
    );
}
