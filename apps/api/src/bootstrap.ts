import { Pool } from 'pg';
import { hashPassword } from './security.ts';
import { readConfig } from './config.ts';

export async function bootstrapStore(db: Pool, storeName: string, login: string, password: string) {
  if (!storeName.trim() || !login.trim()) throw new Error('Loja e login são obrigatórios');
  const passwordHash = await hashPassword(password);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(582175)');
    const existing = await client.query('SELECT id FROM users LIMIT 1');
    if (existing.rowCount) throw new Error('Bootstrap permitido somente sem usuários; use administração para novos usuários');
    const store = await client.query<{ id: string }>('INSERT INTO stores(name) VALUES ($1) RETURNING id', [storeName.trim()]);
    const user = await client.query<{ id: string }>(
      'INSERT INTO users(login, password_hash) VALUES($1,$2) RETURNING id', [login.trim().toLowerCase(), passwordHash]);
    await client.query('INSERT INTO user_store_roles(user_id, store_id, role_code) VALUES ($1,$2,$3)', [user.rows[0].id, store.rows[0].id, 'manager']);
    await client.query('COMMIT');
    return { storeId: store.rows[0].id, userId: user.rows[0].id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1]?.endsWith('bootstrap.ts')) {
  const name = process.env.BOOTSTRAP_STORE ?? 'Loja principal';
  const login = process.env.BOOTSTRAP_ADMIN_LOGIN;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!login || !password) throw new Error('Informe login e senha por prompt local (scripts/bootstrap-admin.sh)');
  const pool = new Pool({ connectionString: readConfig().databaseUrl });
  try {
    const { storeId } = await bootstrapStore(pool, name, login, password);
    console.info('Bootstrap concluído; loja:', storeId);
  } finally { await pool.end(); }
}
