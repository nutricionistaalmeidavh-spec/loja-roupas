#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lan-common.sh"
docker compose version >/dev/null
[[ $# == 0 || ($# == 1 && $1 == --upgrade) ]] || exit 2
if [[ -f .env.lan && $# == 0 ]] && [[ -n $(lan ps -q web) ]]; then
  lan up -d --no-build
  lan ps
  exit 0
fi
if [[ ! -f .env.lan ]]; then
  read -rp 'IP local para escutar [127.0.0.1]: ' bind
  read -rp 'Porta HTTP [8080]: ' port
  bind=${bind:-127.0.0.1}
  port=${port:-8080}
  [[ $bind =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && $port =~ ^[0-9]{1,5}$ ]] || exit 2
  password=$(openssl rand -hex 32)
  (set -o noclobber; printf 'POSTGRES_PASSWORD=%s\nLAN_BIND=%s\nLAN_PORT=%s\n' "$password" "$bind" "$port" > .env.lan)
fi
lan up -d --wait postgres
lan build api web
lan run --rm --no-deps api pnpm --filter @loja/api migrate
has_users=$(lan exec -T postgres psql -XAtq -v ON_ERROR_STOP=1 -U loja -d loja -c 'SELECT EXISTS(SELECT 1 FROM users)')
if [[ $has_users == f ]]; then
  read -rp 'Nome da loja: ' BOOTSTRAP_STORE
  read -rp 'Login do administrador: ' BOOTSTRAP_ADMIN_LOGIN
  read -rsp 'Senha do administrador (mínimo de 12 caracteres): ' BOOTSTRAP_ADMIN_PASSWORD
  printf '\n'
  export BOOTSTRAP_STORE BOOTSTRAP_ADMIN_LOGIN BOOTSTRAP_ADMIN_PASSWORD
  lan run --rm --no-deps -e BOOTSTRAP_STORE -e BOOTSTRAP_ADMIN_LOGIN -e BOOTSTRAP_ADMIN_PASSWORD api pnpm --filter @loja/api bootstrap
  unset BOOTSTRAP_ADMIN_PASSWORD
fi
lan up -d api web
bind=$(sed -n 's/^LAN_BIND=//p' .env.lan)
port=$(sed -n 's/^LAN_PORT=//p' .env.lan)
url="http://${bind:-127.0.0.1}:${port:-8080}"
if [[ $bind == 0.0.0.0 ]]; then url="http://127.0.0.1:${port:-8080}"; fi
curl --connect-timeout 2 --retry 10 --retry-delay 1 --retry-all-errors -fsS "$url/v1/ready"
printf '\n%s\n' "$url"
