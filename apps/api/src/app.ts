import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './auth.ts';
import { registerCatalog } from './catalog.ts';
import { registerMutations } from './mutations.ts';
import { DomainError } from './transactions.ts';

export function buildApp(db: Pool) {
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
  registerMutations(app, db);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError)
      return reply.code(error.status).send({ code:error.code, message:error.message });
    if ('validation' in error && error.validation)
      return reply.code(400).send({code:'BAD_REQUEST',message:'Formato de entrada inválido'});
    const dbCode = (error as Error & {code?:string}).code;
    if (dbCode === '23505' || dbCode === '23503' || dbCode === '23514')
      return reply.code(409).send({code:'CONSTRAINT_CONFLICT',message:'Conflito de integridade ou duplicidade'});
    app.log.error(error);
    return reply.code(500).send({code:'INTERNAL',message:'Erro interno. Consulte o identificador da solicitação'});
  });
  // Ainda não há endpoint de checkout, baixa por venda ou confirmação de pagamento.
  return app;
}
