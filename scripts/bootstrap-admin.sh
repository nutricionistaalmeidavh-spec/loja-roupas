#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f runtime/local.env ]]; then
  echo "Execute primeiro scripts/bootstrap-dev.sh" >&2
  exit 1
fi
if [[ ! -t 0 ]]; then
  echo "Bootstrap interativo requer terminal" >&2
  exit 1
fi
read -rp 'Nome da loja [Loja principal]: ' BOOTSTRAP_STORE
BOOTSTRAP_STORE=${BOOTSTRAP_STORE:-Loja principal}
read -rp 'Login do administrador: ' BOOTSTRAP_ADMIN_LOGIN
read -rsp 'Senha inicial (mín. 12 caracteres): ' BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_STORE BOOTSTRAP_ADMIN_LOGIN BOOTSTRAP_ADMIN_PASSWORD
set -a
# arquivo de desenvolvimento gerado localmente com permissões restritas; nunca commitar
source runtime/local.env
set +a
pnpm --filter @loja/api bootstrap
unset BOOTSTRAP_ADMIN_PASSWORD
