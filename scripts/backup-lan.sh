#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || { printf 'Uso: %s /caminho/novo-backup.gpg\n' "$0" >&2; exit 2; }
destination=$(realpath -m -- "$1")
source "$(dirname "${BASH_SOURCE[0]}")/lan-common.sh"
tmp=$(mktemp -d -- "$(dirname -- "$destination")/.loja-backup.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
# Criptografa o stream diretamente: nenhum dump em texto claro é gravado no destino.
lan exec -T postgres pg_dump -U loja -d loja --format=custom |
  backup_gpg --batch --yes --symmetric --cipher-algo AES256 --output "$tmp/database.gpg"
test -s "$tmp/database.gpg" || { echo 'Arquivo criptografado vazio' >&2; exit 1; }
ln -T -- "$tmp/database.gpg" "$destination"
printf '%s\n' "$destination"
