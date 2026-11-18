import Fastify from 'fastify';
import type { Pool } from 'pg';

export function buildApp(db: Pick<Pool, 'query'>) {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  // Liveness não comprova acesso à base e não deve retornar dados sensíveis.
  app.get('/health', async () => ({ status: 'alive', version: '0.1.0' }));
  // Readiness real da fonte canônica: indisponibilidade não é operação offline independente.
  app.get('/ready', async (request, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ready', database: 'connected' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', database: 'disconnected' });
    }
  });
  // Endpoints transacionais só serão habilitados após autenticação, autorização e migrações.
  return app;
}
