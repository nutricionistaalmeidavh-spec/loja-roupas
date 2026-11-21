import { Pool } from 'pg';
import { hashPassword } from './security.ts';
import { readConfig } from './config.ts';

type RecoveryInput = { login: string; password: string };
export function validateRecoveryInput(raw: unknown): RecoveryInput {
  const data = raw as Partial<RecoveryInput> | null;
  const login = String(data?.login ?? '').trim().toLowerCase();
  const password = typeof data?.password === 'string' ? data.password : '';
  if (!/^[a-z0-9_.@-]{1,80}$/.test(login)) throw new Error('Informe um usuário válido.');
  if (password.length < 12 || password.length > 256) throw new Error('A nova senha precisa ter entre 12 e 256 caracteres.');
  return {login, password};
}

/**
 * Operação administrativa estritamente local. Não registrar rota HTTP para ela.
 * Quem executa este utilitário já precisa controlar a conta Windows que possui
 * o PostgreSQL local e seu arquivo privado de conexão.
 */
export async function resetLocalManagerPassword(db: Pick<Pool, 'connect'>, raw: unknown) {
  const {login, password} = validateRecoveryInput(raw);
  const passwordHash = await hashPassword(password);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(582176)');
    const users = await client.query<{id: string}>(`
      SELECT u.id::text FROM users u
      WHERE u.login=$1 AND u.status='active'
        AND EXISTS (SELECT 1 FROM user_store_roles r
                    WHERE r.user_id=u.id AND r.role_code='manager')
      FOR UPDATE`, [login]);
    if (users.rowCount !== 1) throw new Error('Administrador local não encontrado.');
    const userId = users.rows[0].id;
    await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, userId]);
    await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
    await client.query('COMMIT');
    return {ok:true};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/reset-local-admin.ts')) {
  // Read one small JSON request over standard input. Do not expose the password
  // in command-line arguments, log output, or inherited environment variables.
  const chunks: Buffer[] = [];
  let size=0;
  for await (const chunk of process.stdin) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size+=part.length;
    if(size>4096) throw new Error('Solicitação de recuperação excede o limite permitido.');
    chunks.push(part);
  }
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  const pool = new Pool({connectionString: readConfig().databaseUrl, max:1});
  try {
    await resetLocalManagerPassword(pool, payload);
    process.stdout.write('Senha redefinida com sucesso.\n');
  } finally {
    await pool.end();
  }
}
