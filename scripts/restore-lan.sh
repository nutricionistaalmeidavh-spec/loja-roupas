#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 && $2 =~ ^loja_restore_[a-z0-9_]{1,40}$ ]] || {
  printf 'Uso: %s backup.gpg loja_restore_<identificador>\n' "$0" >&2; exit 2;
}
archive=$(realpath -- "$1")
database=$2
source "$(dirname "${BASH_SOURCE[0]}")/lan-common.sh"
# O dump é descriptografado na RAM por pipe; não grava cópia em texto claro no disco.
lan exec -T postgres createdb -U loja "$database"
if ! backup_gpg --batch --decrypt "$archive" |
  lan exec -T postgres pg_restore -U loja -d "$database" --single-transaction --exit-on-error; then
  lan exec -T postgres dropdb -U loja "$database"
  exit 1
fi
lan exec -T postgres psql -Xv ON_ERROR_STOP=1 -U loja -d "$database" -c 'SELECT (SELECT count(*) FROM sales) AS vendas,
  (SELECT count(*) FROM product_photos) AS fotos,
  (SELECT count(*) FROM schema_migrations) AS migracoes'
printf 'Restaurado em %s\n' "$database"
