// Synthetic schemas and rows. No customer configuration or credentials.
import { MESSAGE_TABLES } from '../../src/media-profiles.js';
export function messagingFixture() {
  const row = (key, values = {}) => ({ key, DESCRIPTION: key, DIVISION: 'Demo', ...values });
  const table = (id, name, rows, extra = {}) => ({
    id,
    name,
    rows,
    schema: {
      type: 'object',
      required: ['key'],
      properties: Object.fromEntries(
        [
          ...new Set([
            'key',
            'DESCRIPTION',
            'DIVISION',
            ...rows.flatMap((r) => Object.keys(r)),
            ...Object.keys(extra),
          ]),
        ].map((k) => [k, extra[k] || { type: 'string' }]),
      ),
    },
  });
  return {
    tables: [
      table('voice', 'W_INBOUND_CALL_v5', [
        row('+33100000000', { NEXT_TARGET_TYPE: 'disconnect', NEXT_TARGET: '' }),
      ]),
      table('entry', MESSAGE_TABLES.segment, [
        row('WEB_HOME', {
          WELCOM_MESSAGE: 'ttm:Bienvenue',
          NEXT_TARGET_TYPE: 'quickreplies',
          NEXT_TARGET: 'MENU|pdata:CTX',
          DEFAULT_TARGET_TYPE: 'disconnect',
          DEFAULT_TARGET: '',
        }),
      ]),
      table('menu', MESSAGE_TABLES.quickreplies, [
        row('MENU', {
          MENU_MESSAGE: 'ttm:Comment vous aider ?',
          OPTION0_LABEL: 'ttm:Conseil',
          OPTION0_TARGET_TYPE: 'service',
          OPTION0_TARGET: 'SERVICE',
          OPTION0_MESSAGE: 'ttm:Je vous mets en relation.',
          OPTION1_LABEL: 'ttm:Nos offres',
          OPTION1_TARGET_TYPE: 'carousel',
          OPTION1_TARGET: 'CAROUSEL',
          OPTION2_LABEL: '',
          OPTION2_TARGET_TYPE: 'disconnect',
          OPTION2_TARGET: '',
          NOINPUT_TARGET_TYPE: 'disconnect',
          NOINPUT_TARGET: '',
          NOMATCH_TARGET_TYPE: 'quickreplies',
          NOMATCH_TARGET: 'MENU',
        }),
      ]),
      table('service', MESSAGE_TABLES.service, [
        row('SERVICE', {
          QUEUE: 'Support',
          INQUEUE_MESSAGE_1: 'ttm:Un instant',
          INQUEUE_MENU_1: 'WAIT',
          INQUEUE_TARGET_TYPE: 'disconnect',
          INQUEUE_TARGET: '',
        }),
      ]),
      table('wait', MESSAGE_TABLES.waitforinput, [
        row('QUESTION', {
          QUESTION: 'ttm:Votre question ?',
          NOINPUT_TARGET_TYPE: 'disconnect',
          NOINPUT_TARGET: '',
        }),
      ]),
      table('carousel', MESSAGE_TABLES.carousel, [
        row('CAROUSEL', {
          CAROUSEL_QUESTION: 'ttm:Nos offres',
          CARD0: 'CARD',
          NOINPUT_TARGET_TYPE: 'disconnect',
          NOINPUT_TARGET: '',
        }),
      ]),
      table('card', MESSAGE_TABLES.card, [
        row('CARD', {
          DESCRIPTION: 'Une offre',
          CARD_IMAGE_URL: 'https://example.test/image.png',
          OPTION0_LABEL: 'ttm:Retour',
          OPTION0_TARGET_TYPE: 'quickreplies',
          OPTION0_TARGET: 'MENU',
        }),
      ]),
      table('context', MESSAGE_TABLES.pdata, [row('CTX', { PDATA_LIST_1: 'CLIENT==web' })]),
      table(
        'ratio',
        MESSAGE_TABLES.ratiodistrib,
        [
          row('RATIO', {
            RATIO_1: 1,
            RATIO_9: 2,
            TARGET_TYPE_1: 'service',
            TARGET_1: 'SERVICE',
            TARGET_TYPE_9: 'disconnect',
            TARGET_9: '',
          }),
        ],
        { RATIO_1: { type: 'integer' }, RATIO_9: { type: 'integer' } },
      ),
    ],
  };
}
