/** W_DECISION_v5 contract: conditions evaluate participant data, not Genesys objects. */
import {
  PARTICIPANT_CATALOGUE,
  catalogueDefinition,
  participantOperators,
  validateParticipantValue,
} from './participant-catalogue.js';
export const decisionFields = ['PARTICIPANT_DATA_TO_CHECK', 'DECISION_OPERATOR', 'DECISION_VALUE'];
export const decisionOperatorLabels = Object.freeze({
  exist: 'Existe',
  empty: 'Est vide',
  contains: 'Contient',
  '==': 'Est égal à',
  '>=': 'Est supérieur ou égal à',
  '<=': 'Est inférieur ou égal à',
  '>': 'Est supérieur à',
  '<': 'Est inférieur à',
});
export const decisionOperators = Object.freeze(Object.keys(decisionOperatorLabels));
export const isV5Decision = (node) => /^W_DECISION_v5$/i.test(node?.tableName || '');
export function validateDecision(row, { snapshot } = {}) {
  if (typeof row.PARTICIPANT_DATA_TO_CHECK !== 'string' || !row.PARTICIPANT_DATA_TO_CHECK.trim())
    throw Error('Renseignez l’attribut client à évaluer.');
  if (!decisionOperators.includes(row.DECISION_OPERATOR))
    throw Error('Choisissez un opérateur de décision WOLF V5 valide.');
  if (
    !['exist', 'empty'].includes(row.DECISION_OPERATOR) &&
    (row.DECISION_VALUE == null || !String(row.DECISION_VALUE).trim())
  )
    throw Error('Renseignez la valeur de comparaison.');
  const definition = catalogueDefinition(snapshot, row.PARTICIPANT_DATA_TO_CHECK);
  const catalogueRequired =
    snapshot?.source?.participantCatalogueRequired ||
    snapshot?.tables?.some((table) => table.name === PARTICIPANT_CATALOGUE);
  if (!definition) {
    if (catalogueRequired)
      throw Error('Choisissez une donnée déclarée dans le catalogue administrateur.');
    return;
  }
  if (!participantOperators(definition).includes(row.DECISION_OPERATOR))
    throw Error('Cet opérateur n’est pas compatible avec le type de la donnée.');
  if (!['exist', 'empty'].includes(row.DECISION_OPERATOR))
    validateParticipantValue(definition, String(row.DECISION_VALUE), { allowEmpty: false });
}
