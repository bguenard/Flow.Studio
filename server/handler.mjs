import { createGenesysClient, configFromEnv, GenesysError } from './genesys.mjs';

function rolesFromClaim(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === 'string');
  } catch {}
  return value
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(/[ ,]+/)
    .filter(Boolean);
}

/** API Gateway HTTP API v2 only. Deploy behind a JWT authorizer; no Lambda Function URL. */
export function createHandler(env = process.env, dependencies = {}) {
  let client;
  const getClient = () =>
    (client ||= dependencies.client || createGenesysClient(configFromEnv(env), dependencies));
  return async function handler(event) {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    const origin = event.headers?.origin || event.headers?.Origin;
    if (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) {
      headers['access-control-allow-origin'] = env.ALLOWED_ORIGIN;
      headers.vary = 'Origin';
    }
    const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
    try {
      const claims = event.requestContext?.authorizer?.jwt?.claims;
      if (!claims || typeof claims.sub !== 'string' || !claims.sub.trim()) {
        return reply(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Session authentifiée requise.' },
        });
      }
      const roleClaim = env.AUTH_ROLE_CLAIM || 'cognito:groups';
      const readRole = env.AUTH_READ_ROLE || 'wolf-reader';
      if (!rolesFromClaim(claims[roleClaim]).includes(readRole)) {
        return reply(403, {
          error: { code: 'FORBIDDEN', message: 'Rôle de lecture WOLF requis.' },
        });
      }
      if (
        env.AUTH_TENANT_ID &&
        claims[env.AUTH_TENANT_CLAIM || 'tenant_id'] !== env.AUTH_TENANT_ID
      ) {
        return reply(403, {
          error: { code: 'FORBIDDEN', message: 'Périmètre de connexion non autorisé.' },
        });
      }
      if (event.requestContext?.http?.method !== 'GET') {
        headers.allow = 'GET';
        return reply(405, {
          error: { code: 'READ_ONLY', message: 'Connecteur en lecture seule.' },
        });
      }
      const path = event.rawPath || '';
      const query = event.queryStringParameters || {};
      if (Object.keys(query).some((key) => !['pageNumber', 'pageSize'].includes(key))) {
        return reply(400, {
          error: { code: 'INVALID_QUERY', message: 'Paramètre de requête non autorisé.' },
        });
      }
      if (path === '/api/datatables' || path === '/api/datatables/')
        return reply(200, await getClient().listDatatables());
      const match = path.match(/^\/api\/datatables\/([a-zA-Z0-9-]{1,128})(\/rows)?$/);
      if (!match) return reply(404, { error: { code: 'NOT_FOUND', message: 'Route inconnue.' } });
      if (match[2])
        return reply(
          200,
          await getClient().getDatatableRows(match[1], {
            pageNumber: query.pageNumber === undefined ? 1 : Number(query.pageNumber),
            pageSize: query.pageSize === undefined ? 100 : Number(query.pageSize),
          }),
        );
      return reply(200, await getClient().getDatatable(match[1]));
    } catch (error) {
      if (error instanceof GenesysError)
        return reply(error.status, { error: { code: error.code, message: error.message } });
      // Do not return or log upstream bodies, headers, tokens or configuration values.
      return reply(500, {
        error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du connecteur.' },
      });
    }
  };
}

export const handler = createHandler();
