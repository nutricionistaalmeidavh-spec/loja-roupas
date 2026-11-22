#!/usr/bin/env bash
set -euo pipefail
bash -n scripts/backup-lan.sh scripts/backup-lan-rotate.sh scripts/restore-lan.sh
test -f scripts/backup-lan-rotate.sh
grep -Fq 'flock -n 9' scripts/backup-lan-rotate.sh
grep -Fq 'LOJA_BACKUP_PASSPHRASE_FILE' scripts/backup-lan-rotate.sh
grep -Fq -- '--cipher-algo AES256' scripts/backup-lan.sh
