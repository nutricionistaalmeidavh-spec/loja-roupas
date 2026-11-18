import { Pool } from 'pg';
import { buildApp } from './app.ts';
import { readConfig } from './config.ts';

const config = readConfig();
const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
const app = buildApp(pool);
const shutdown = async () => { await app.close(); await pool.end(); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exitCode = 1;
}
