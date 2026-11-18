import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';
import { readConfig } from './config.ts';

export async function applyMigrations(pool: Pool, directory: string): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(582174)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const entries = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const version of entries) {
      const sql = await readFile(path.join(directory, version), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const found = await client.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE version = $1', [version]);
      if (found.rowCount) {
        if (found.rows[0].checksum !== checksum) throw new Error(`Migração modificada: ${version}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES($1,$2)', [version, checksum]);
      applied.push(version);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const pool = new Pool({ connectionString: readConfig().databaseUrl });
  try {
    const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../infra/sql');
    const applied = await applyMigrations(pool, directory);
    console.info('Migrações aplicadas:', applied.length ? applied.join(', ') : 'nenhuma nova');
  } finally { await pool.end(); }
}
