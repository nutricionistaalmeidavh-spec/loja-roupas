#!/usr/bin/env bash
set -euo pipefail
bash -n scripts/backup-lan.sh scripts/backup-lan-rotate.sh scripts/restore-lan.sh
test -f scripts/backup-lan-rotate.sh
grep -Fq 'flock -n 9' scripts/backup-lan-rotate.sh
grep -Fq 'LOJA_BACKUP_PASSPHRASE_FILE' scripts/backup-lan-rotate.sh
grep -Fq -- '--cipher-algo AES256' scripts/backup-lan.sh
grep -Fq 'pg_dump -U loja -d loja --format=custom |' scripts/backup-lan.sh
grep -Fq 'pg_restore -U loja' scripts/restore-lan.sh
! grep -Fq -- '--output "$tmp/database"' scripts/restore-lan.sh
