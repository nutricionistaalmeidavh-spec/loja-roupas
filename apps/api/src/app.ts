import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './auth.ts';
import { registerCatalog } from './catalog.ts';
import { registerMutations } from './mutations.ts';
import { registerCatalogAdmin } from './catalog-admin.ts';
import { registerCashReturns } from './cash-returns.ts';
import { registerCash } from './cash.ts';
import { registerSales } from './sales.ts';
import { registerSuspendedSales } from './suspended-sales.ts';
import { DomainError } from './transactions.ts';
import { registerStoreOperations } from './store-operations.ts';
import { registerPickupOrders } from './pickup-orders.ts';
import { registerOperationalCompletion } from './operational-completion.ts';
import { registerIntelligence } from './intelligence.ts';
import { registerProductFields } from './product-fields.ts';
import { registerProductImport } from './import-products.ts';
import { registerStockHolds } from './stock-holds.ts';
import { registerStockSpreadsheet } from './stock-spreadsheet.ts';
import { registerStockSpreadsheetP2 } from './stock-spreadsheet-p2.ts';
import { registerStaticUi } from './static-ui.ts';
import { registerMarketplaceBridge } from './marketplace-bridge.ts';

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
  registerProductImport(app, db);
  registerCatalogAdmin(app, db);
  registerCash(app, db);
  registerCashReturns(app, db);
  registerSales(app, db);
  registerSuspendedSales(app, db);
  registerStoreOperations(app, db);
  registerStockHolds(app, db);
  registerStockSpreadsheet(app, db);
  registerStockSpreadsheetP2(app, db);
  registerPickupOrders(app, db);
  registerOperationalCompletion(app, db);
  registerIntelligence(app, db);
  registerProductFields(app, db);
  registerStaticUi(app);
  registerMarketplaceBridge(app,db);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError)
      return reply.code(error.status).send({ code:error.code, message:error.message });
    if (typeof error === 'object' && error !== null && 'validation' in error && error.validation)
      return reply.code(400).send({code:'BAD_REQUEST',message:'Formato de entrada inválido'});
    const dbCode = (error as Error & {code?:string}).code;
    if (dbCode === '23505' || dbCode === '23503' || dbCode === '23514')
      return reply.code(409).send({code:'CONSTRAINT_CONFLICT',message:'Conflito de integridade ou duplicidade'});
    app.log.error(error);
    return reply.code(500).send({code:'INTERNAL',message:'Erro interno. Consulte o identificador da solicitação'});
  });
  // Pagamentos externos são registro MANUAL, nunca integração silenciosa com TEF/Pix.
  return app;
}
