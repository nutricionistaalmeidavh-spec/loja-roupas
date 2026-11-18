import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const N = 16384;
const R = 8;
const P = 1;
const LEN = 64;
const roleCapabilities: Readonly<Record<string, readonly string[]>> = {
  manager: ['*'],
  cashier: ['catalog.read','stock.read','sale.commit','sale.read','cash.manage','payments.record'],
  seller: ['catalog.read','stock.read','customer.read','reservation.create'],
  stocker: ['catalog.read','stock.read','stock.receive','stock.count'],
  buyer: ['catalog.read','stock.read','purchase.read','purchase.write'],
  technician: ['system.health','system.backup'],
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) throw new Error('Senha deve ter entre 12 e 1024 caracteres');
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 1024 || typeof encoded !== 'string' || encoded.length > 320) return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== String(N) || parts[2] !== String(R) || parts[3] !== String(P)) return false;
  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length !== 16 || expected.length !== LEN) return false;
    const actual = (await scrypt(password, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })) as Buffer;
    return timingSafeEqual(expected, actual);
  } catch { return false; }
}
export function hashSessionToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function issueSession(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}
export function hasPermission(roles: readonly string[], action: string): boolean {
  return roles.some(role => roleCapabilities[role]?.some(capability => capability === '*' || capability === action));
}
