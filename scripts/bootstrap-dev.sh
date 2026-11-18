#!/usr/bin/env sh
set -eu
# Apenas bootstrap de desenvolvimento. Em producao sera usado wizard guiado.
cd "$(dirname "$0")/.."
mkdir -p runtime
umask 077
if [ ! -f runtime/local.env ]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "OpenSSL necessario para gerar a senha local" >&2
    exit 1
  fi
  DB_PASSWORD="$(openssl rand -hex 24)"
  {
    printf 'POSTGRES_PASSWORD=%s\n' "$DB_PASSWORD"
    printf 'DATABASE_URL=postgresql://loja:%s@127.0.0.1:5432/loja\n' "$DB_PASSWORD"
  } > runtime/local.env
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Compose nao encontrado. Configuracao gerada em runtime/local.env (restrita)." >&2
  exit 1
fi
docker compose --env-file runtime/local.env -f infra/compose.dev.yml up -d
echo "PostgreSQL local iniciado. Execute pnpm install; pnpm --filter @loja/api dev e pnpm --filter @loja/web dev."
