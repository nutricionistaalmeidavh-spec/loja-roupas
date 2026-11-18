import type { Pool, PoolClient } from 'pg';
import { stableFingerprint } from '@loja/domain/catalog';
import type { AuthContext } from './auth.ts';

export class DomainError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value))
    throw new DomainError(400, 'IDEMPOTENCY_REQUIRED', 'Idempotency-Key inválida ou ausente');
  return value;
}
export async function withIdempotentTransaction<T>(
  pool: Pool, auth: AuthContext, scope: string, key: string,
  normalizedRequest: unknown, run: (client: PoolClient) => Promise<T>
): Promise<{ result:T; replayed:boolean }> {
  const client = await pool.connect();
  const fingerprint = stableFingerprint(normalizedRequest);
  const actorScope = scope + ':' + auth.userId;
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO idempotency_records(store_id,scope,key,request_hash)
      VALUES($1,$2,$3,$4) ON CONFLICT (store_id,scope,key) DO NOTHING`,
      [auth.storeId,actorScope,key,fingerprint]);
    const existing = await client.query<{ request_hash:string; response_json:T|null }>(
      `SELECT request_hash,response_json FROM idempotency_records
       WHERE store_id=$1 AND scope=$2 AND key=$3 FOR UPDATE`,
      [auth.storeId,actorScope,key]);
    if (!existing.rowCount) throw new Error('Registro idempotente não encontrado');
    if (existing.rows[0].request_hash !== fingerprint)
      throw new DomainError(409,'IDEMPOTENCY_CONFLICT','Chave de repetição usada com conteúdo diferente');
    if (existing.rows[0].response_json !== null) {
      await client.query('COMMIT');
      return { result:existing.rows[0].response_json, replayed:true };
    }
    const result = await run(client);
    await client.query(`UPDATE idempotency_records SET response_json=$4::jsonb
      WHERE store_id=$1 AND scope=$2 AND key=$3`,[auth.storeId,actorScope,key,JSON.stringify(result)]);
    await client.query('COMMIT');
    return { result, replayed:false };
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
