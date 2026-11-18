export function parsePort(raw: string | undefined): number {
  const value = Number(raw ?? '3000');
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error('PORT deve ser um inteiro de 1 a 65535');
  }
  return value;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL ausente. Execute scripts/bootstrap-dev.sh.');
  return {
    host: env.HOST ?? '127.0.0.1',
    port: parsePort(env.PORT),
    databaseUrl,
  };
}
