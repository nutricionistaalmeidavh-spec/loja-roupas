import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './auth.ts';
import { registerCatalog } from './catalog.ts';

export function buildApp(db: Pick<Pool, 'query'>) {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024, trustProxy: false });
  registerAuth(app, db);
  app.get('/v1/health', async () => ({ status: 'alive', version: '0.1.0' }));
  app.get('/v1/ready', async (_request, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ready', database: 'connected' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', database: 'disconnected' });
    }
  });
  registerCatalog(app, db);
  // Ainda não há endpoint de checkout, alteração de estoque ou pagamento.
  return app;
}
