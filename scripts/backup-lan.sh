#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || { printf 'Uso: %s /caminho/novo-backup.gpg\n' "$0" >&2; exit 2; }
destination=$(realpath -m -- "$1")
source "$(dirname "${BASH_SOURCE[0]}")/lan-common.sh"
tmp=$(mktemp -d -- "$(dirname -- "$destination")/.loja-backup.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
lan exec -T postgres pg_dump -U loja -d loja --format=custom > "$tmp/database"
backup_gpg --symmetric --cipher-algo AES256 --output "$tmp/database.gpg" "$tmp/database"
ln -T -- "$tmp/database.gpg" "$destination"
printf '%s\n' "$destination"
