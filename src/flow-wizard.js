/** Guided creation of a complete WOLF V5 route. No mutation and no API writes. */
import { normalizeSnapshot, buildVoiceInventory } from './data-source.js';
import { designerCatalogue, prepareNewFlow, prepareNewBlock } from './flow-designer.js';

const text = (value) => (value == null ? '' : String(value).trim());
const hasField = (cap, key) => cap?.fields.some((field) => field.key === key);
const hasExit = (cap, key) => cap?.outlets.some((outlet) => outlet.field === key);
const fail = (error) => ({
  ok: false,
  errors: [{ message: error.message }],
  snapshot: null,
  createdRows: [],
  updatedRows: [],
  mappings: [],
  summary: null,
});

export function wizardOptions(snapshot) {
  const catalogue = designerCatalogue(snapshot),
    find = (type) => catalogue.find((cap) => cap.type === type);
  const entry = find('inboundcall'),
    service = find('service'),
    menu = find('menu'),
    schedule = find('schedulegroup');
  const directAvailable = Boolean(
    entry?.available &&
      hasExit(entry, 'NEXT_TARGET_TYPE') &&
      service?.available &&
      hasField(service, 'QUEUE') &&
      hasExit(service, 'INQUEUE_TARGET_TYPE'),
  );
  const menuDigits = (menu?.outlets || [])
    .map((outlet) => outlet.field.match(/^OPTION([0-9])_TARGET_TYPE$/)?.[1])
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
  return {
    catalogue,
    available: directAvailable,
    directAvailable,
    menuAvailable: Boolean(
      directAvailable && menu?.available && hasField(menu, 'MENU_AUDIO') && menuDigits.length >= 2,
    ),
    scheduleAvailable: Boolean(
      directAvailable &&
        schedule?.available &&
        hasField(schedule, 'SCHEDULE_GROUP') &&
        hasExit(schedule, 'OPEN_TARGET_TYPE'),
    ),
    menuDigits,
    reason: directAvailable
      ? ''
      : !entry?.available
        ? entry?.reason || 'La table d’accueil V5 est indisponible.'
        : !service?.available
          ? service?.reason || 'La table des équipes V5 est indisponible.'
          : 'Le schéma V5 chargé ne contient pas les champs nécessaires à la création guidée.',
  };
}

/** The form stores Genesys resource values, never display IDs invented by the wizard. */
export function prepareFlowWizard({ snapshot: input, form = {} }) {
  try {
    const initial = normalizeSnapshot(input),
      options = wizardOptions(initial);
    if (!options.available) throw Error(options.reason);
    if (!['direct', 'menu'].includes(form.routing))
      throw Error('Choisissez une mise en relation directe ou un menu vocal.');
    if (form.routing === 'menu' && !options.menuAvailable)
      throw Error('Le schéma V5 chargé ne permet pas de créer ce menu vocal.');
    if (form.scheduleEnabled && !options.scheduleAvailable)
      throw Error('Le schéma V5 chargé ne permet pas d’ajouter des horaires.');
    if (form.scheduleEnabled && !text(form.scheduleGroup))
      throw Error('Choisissez un groupe de calendriers Genesys.');
    const waitingField = options.catalogue
      .find((cap) => cap.type === 'service')
      ?.fields.find((field) => field.key === 'INQUEUE_HOLD_TIMEOUT_INIT');
    if (
      waitingField &&
      text(form.waitSeconds) &&
      (!Number.isInteger(Number(form.waitSeconds)) || Number(form.waitSeconds) < 0)
    )
      throw Error(
        'La durée initiale d’attente doit être un nombre entier de secondes, positif ou nul.',
      );
    const choices =
      form.routing === 'menu'
        ? Array.isArray(form.choices)
          ? form.choices
          : []
        : [{ queue: form.queue, priority: form.priority, label: 'Équipe de traitement' }];
    if (form.routing === 'menu') {
      if (choices.length < 2 || choices.length > options.menuDigits.length)
        throw Error(`Configurez entre 2 et ${options.menuDigits.length} choix pour le menu.`);
      if (!text(form.menuAudio))
        throw Error('Renseignez le message qui annonce les choix du menu.');
      if (
        hasField(
          options.catalogue.find((cap) => cap.type === 'menu'),
          'MENU_TIMEOUT',
        ) &&
        (!text(form.menuTimeout) || ![3, 5, 7, 10, 12].includes(Number(form.menuTimeout)))
      )
        throw Error('Choisissez un délai de réponse du menu : 3, 5, 7, 10 ou 12 secondes.');
      const digits = new Set();
      for (const choice of choices) {
        const digit = text(choice.digit);
        if (!options.menuDigits.includes(digit))
          throw Error(`La touche « ${digit} » n’est pas disponible dans le schéma du menu.`);
        if (digits.has(digit))
          throw Error('Chaque choix du menu doit utiliser une touche différente.');
        if (!text(choice.label)) throw Error(`Donnez un libellé au choix ${digit}.`);
        digits.add(digit);
      }
    }
    for (const choice of choices) {
      if (!text(choice.queue))
        throw Error(
          form.routing === 'menu'
            ? `Choisissez la file Genesys du choix ${choice.digit}.`
            : 'Choisissez une file Genesys pour recevoir les appels.',
        );
      if (/^(?:variable|var:|\$var:)/i.test(text(choice.queue)))
        throw Error(
          'La création guidée nécessite une file Genesys fixe. Configurez un routage dynamique dans le designer.',
        );
    }
    const welcomeValues = Object.fromEntries(
      Object.entries(form.welcomeValues || {}).filter(
        ([, value]) => value != null && (typeof value !== 'string' || value.trim() !== ''),
      ),
    );
    let plan = prepareNewFlow({
      snapshot: initial,
      name: form.name,
      phone: form.phone,
      division: form.division,
      values: welcomeValues,
    });
    const accept = (result) => {
      if (!result.ok) throw Error(result.errors.map((error) => error.message).join(' '));
      return result;
    };
    accept(plan);
    const flowId = plan.flowId,
      createdIds = new Set(plan.createdRows.map((row) => row.nodeId));
    let snapshot = plan.snapshot;
    const cap = (type) => options.catalogue.find((item) => item.type === type);
    const uniqueKey = (type, suffix) => {
      const table = snapshot.tables.find((table) => table.id === cap(type).tableId),
        stem = `WZ_${text(form.phone).replace(/\D/g, '')}_${suffix}`;
      const max = table.schema.properties.key.maxLength || 200,
        used = new Set(table.rows.map((row) => String(row.key)));
      for (let index = 1; index < 10000; index++) {
        const end = index === 1 ? '' : `_${index}`,
          key = stem.slice(0, Math.max(0, max - end.length)) + end;
        if (key && !used.has(key)) return key;
      }
      throw Error('Impossible de générer une clé unique compatible avec le schéma de la table.');
    };
    const add = (type, name, suffix, anchorId, field, continuationField, values) => {
      const flow = buildVoiceInventory(snapshot).flows.find((flow) => flow.id === flowId);
      plan = accept(
        prepareNewBlock({
          snapshot,
          flow,
          type,
          name,
          key: uniqueKey(type, suffix),
          division: form.division,
          values,
          placementId: JSON.stringify([anchorId, field]),
          continuationField,
        }),
      );
      snapshot = plan.snapshot;
      for (const row of plan.createdRows) createdIds.add(row.nodeId);
      return plan.nodeId;
    };
    let anchorId = flowId,
      field = 'NEXT_TARGET_TYPE';
    if (form.scheduleEnabled) {
      anchorId = add(
        'schedulegroup',
        `${text(form.name)} · Horaires`,
        'HORAIRES',
        anchorId,
        field,
        'OPEN_TARGET_TYPE',
        { SCHEDULE_GROUP: text(form.scheduleGroup) },
      );
      field = 'OPEN_TARGET_TYPE';
    }
    if (form.routing === 'menu') {
      const values = { MENU_AUDIO: form.menuAudio };
      if (hasField(cap('menu'), 'MENU_TIMEOUT')) values.MENU_TIMEOUT = form.menuTimeout;
      anchorId = add(
        'menu',
        `${text(form.name)} · Menu vocal`,
        'MENU',
        anchorId,
        field,
        `OPTION${text(choices[0].digit)}_TARGET_TYPE`,
        values,
      );
    }
    for (const choice of choices) {
      const values = { QUEUE: text(choice.queue) };
      if (text(choice.priority)) values.PRIORITY = choice.priority;
      if (waitingField && text(form.waitSeconds))
        values.INQUEUE_HOLD_TIMEOUT_INIT = form.waitSeconds;
      add(
        'service',
        `${text(form.name)} · ${text(choice.label)}`,
        form.routing === 'menu' ? `CHOIX${text(choice.digit)}` : 'EQUIPE',
        anchorId,
        form.routing === 'menu' ? `OPTION${text(choice.digit)}_TARGET_TYPE` : field,
        'INQUEUE_TARGET_TYPE',
        values,
      );
    }
    // Earlier insertions update rows created in this same plan. Fold those changes into
    // the final additions so applying the wizard never overwrites an existing DT row.
    const createdRows = [];
    for (const table of snapshot.tables)
      for (const row of table.rows) {
        const nodeId = `${table.id}:${row.key}`;
        if (createdIds.has(nodeId))
          createdRows.push({
            tableId: table.id,
            tableName: table.name,
            nodeId,
            row: structuredClone(row),
          });
      }
    const flow = buildVoiceInventory(snapshot).flows.find((flow) => flow.id === flowId);
    if (
      !flow ||
      createdRows.length !== createdIds.size ||
      createdRows.some((row) => !flow.nodes.some((node) => node.id === row.nodeId))
    )
      throw Error('Une étape du parcours créé n’est pas accessible.');
    const mappings = createdRows.map(({ tableId, tableName, nodeId, row }) => ({
      tableId,
      tableName,
      nodeId,
      key: row.key,
      oldKey: row.key,
      title: row.DESCRIPTION,
    }));
    const waitSeconds = createdRows.find((row) => row.tableId === cap('service').tableId)?.row
      .INQUEUE_HOLD_TIMEOUT_INIT;
    const notices = [
      ...(waitSeconds != null && text(waitSeconds) !== ''
        ? [
            `La séquence initiale de musique d’attente dure ${waitSeconds} seconde(s). Ce réglage ne représente pas la durée totale des autres séquences du cycle.`,
          ]
        : []),
      'À la fin du cycle d’attente, l’appel se termine. Vous pouvez ajouter un débordement dans le designer.',
      ...(form.routing === 'menu'
        ? ['Les touches non configurées et le repli du menu terminent l’appel.']
        : []),
      ...(form.scheduleEnabled
        ? [
            'En dehors des horaires, pendant les congés et en situation d’urgence, l’appel se termine. Ces branches restent modifiables dans le designer.',
          ]
        : []),
      'Le numéro doit déjà être provisionné et routé vers l’inbound WOLF dans Genesys pour recevoir les appels.',
    ];
    return {
      ok: true,
      errors: [],
      snapshot,
      flowId,
      nodeId: flowId,
      createdRows,
      updatedRows: [],
      mappings,
      summary: {
        kind: 'new-flow',
        title: flow.name || flow.key,
        targetFlowId: flowId,
        nodeCount: createdRows.length,
        mappings,
        notices,
        localOnly: true,
        wizard: {
          routing: form.routing,
          scheduleEnabled: Boolean(form.scheduleEnabled),
          waitSeconds: waitSeconds ?? null,
          choices: choices.map((choice) => ({
            digit: text(choice.digit),
            label: text(choice.label),
            queue: text(choice.queue),
          })),
        },
      },
    };
  } catch (error) {
    return fail(error);
  }
}
