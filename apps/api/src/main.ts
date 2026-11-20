import { Pool } from 'pg';
import { buildApp } from './app.ts';
import { readConfig } from './config.ts';
import { startMarketplacePolling } from './marketplace-sync.ts';

const config = readConfig();
const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 3500 });
const app = buildApp(pool);
pool.on('error', (error) => app.log.warn({err:error}, 'Conexão ociosa com PostgreSQL foi encerrada'));
let stopSync:()=>void=()=>{};
const shutdown = async () => { stopSync(); await app.close(); await pool.end(); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
try {
  await app.listen({ host: config.host, port: config.port });
  stopSync=startMarketplacePolling(pool,message=>app.log.warn(message));
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exitCode = 1;
}
