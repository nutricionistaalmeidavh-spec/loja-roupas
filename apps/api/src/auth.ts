import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { hashSessionToken, issueSession, verifyPassword, hasPermission } from './security.ts';

export type AuthContext = { userId: string; storeId: string; roles: string[]; tokenHash: string };
declare module 'fastify' { interface FastifyRequest { authContext?: AuthContext } }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicPaths = new Set(['/v1/health', '/v1/ready', '/v1/auth/sessions']);
type LoginBody = { login: string; password: string };

export function registerAuth(app: FastifyInstance, db: Pick<Pool, 'query'>) {
  const attempts = new Map<string, { failures: number; expires: number }>();
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0];
    if (publicPaths.has(path)) return;
    const route = request.routeOptions.url;
    if (request.method === 'GET' &&
        (route === '/v1/storefront/:id' || route === '/v1/storefront/:id/products/:productId/photo')) return;
    if (request.method === 'POST' && route === '/v1/storefront/:id/pickup-orders') return;
    if (request.method === 'GET' && route === '/v1/storefront/:id/pickup-orders/:orderId/status') return;
    const header = request.headers.authorization;
    const storeHeader = request.headers['x-store-id'];
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Autenticação necessária' });
    }
    if (typeof storeHeader !== 'string' || !uuidPattern.test(storeHeader)) {
      return reply.code(400).send({ code: 'BAD_STORE', message: 'Loja inválida' });
    }
    const token = header.slice(7);
    const result = await db.query<{
      user_id: string; store_id: string; roles: string[];
    }>(`SELECT s.user_id::text, r.store_id::text,
      array_agg(r.role_code) AS roles
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id AND u.status = 'active'
      JOIN user_store_roles r ON r.user_id = s.user_id AND r.store_id = $2
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
      GROUP BY s.user_id, r.store_id`, [hashSessionToken(token), storeHeader]);
    if (!result.rowCount) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Sessão inválida ou loja não autorizada' });
    request.authContext = {
      userId: result.rows[0].user_id, storeId: result.rows[0].store_id,
      roles: result.rows[0].roles, tokenHash: hashSessionToken(token),
    };
  });

  app.post<{ Body: LoginBody }>('/v1/auth/sessions', {
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['login','password'],
      properties: { login: {type:'string',minLength:1,maxLength:128}, password: {type:'string',minLength:1,maxLength:1024} }
    }}
  }, async (request, reply) => {
    const login = request.body.login.trim().toLowerCase();
    const bucket = `${request.ip}:${login}`;
    const now = Date.now();
    const state = attempts.get(bucket);
    if (state && state.expires > now && state.failures >= 5) {
      return reply.code(429).send({ code:'RATE_LIMITED', message:'Muitas tentativas. Tente novamente depois.' });
    }
    const result = await db.query<{ id:string; password_hash:string }>(
      "SELECT id::text, password_hash FROM users WHERE login=$1 AND status='active' LIMIT 1", [login]);
    const user = result.rows[0];
    const valid = user && await verifyPassword(request.body.password, user.password_hash);
    if (!valid) {
      attempts.set(bucket, { failures: (state && state.expires>now ? state.failures : 0) + 1, expires: now+15*60_000 });
      return reply.code(401).send({ code:'INVALID_CREDENTIALS', message:'Credenciais inválidas' });
    }
    const storeRows = await db.query<{ store_id:string; roles: string[] }>(
      'SELECT store_id::text, array_agg(role_code) AS roles FROM user_store_roles WHERE user_id=$1 GROUP BY store_id', [user.id]);
    if (!storeRows.rowCount) return reply.code(403).send({ code:'FORBIDDEN', message:'Usuário sem loja autorizada' });
    attempts.delete(bucket);
    const {token, tokenHash} = issueSession();
    const expiresAt = new Date(now + 8*60*60_000).toISOString();
    await db.query('INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES ($1,$2,$3)', [user.id,tokenHash,expiresAt]);
    return reply.send({ token, expires_at:expiresAt, stores:storeRows.rows });
  });

  app.get('/v1/auth/me', async request => {
    const auth = request.authContext!;
    return { user_id:auth.userId, store_id:auth.storeId, roles:auth.roles };
  });

  app.post('/v1/auth/sessions/revoke', async request => {
    const auth = request.authContext!;
    await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [auth.tokenHash]);
    return { revoked:true };
  });
}

export function requirePermission(request: FastifyRequest, reply: FastifyReply, permission:string) {
  if (!request.authContext || !hasPermission(request.authContext.roles,permission)) {
    return reply.code(403).send({ code:'FORBIDDEN', message:'Permissão insuficiente' });
  }
}
