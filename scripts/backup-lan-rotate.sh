#!/usr/bin/env bash
# Crontab / systemd timer: 0 2 * * * /opt/loja/scripts/backup-lan-rotate.sh /mnt/backup-loja
set -euo pipefail
[[ $# == 1 ]] || { printf 'Uso: %s DIRETORIO_EXTERNO\n' "$0" >&2; exit 2; }
[[ -n ${LOJA_BACKUP_PASSPHRASE_FILE:-} && -r "$LOJA_BACKUP_PASSPHRASE_FILE" ]] || {
 printf 'Configure LOJA_BACKUP_PASSPHRASE_FILE em arquivo local protegido (chmod 600).\n' >&2; exit 2;
}
command -v flock >/dev/null || { echo 'flock não encontrado (util-linux OSS)' >&2; exit 2; }
command -v gpg >/dev/null || { echo 'GnuPG OSS não encontrado' >&2; exit 2; }
root="$(realpath -m -- "$1")"
[[ "$root" = /* && "$root" != / && -d "$root" ]] || { echo 'Destino de backup inválido ou inexistente' >&2; exit 2; }
retention="${LOJA_BACKUP_RETENTION_DAYS:-30}"
[[ "$retention" =~ ^[0-9]{1,4}$ && "$retention" -ge 7 && "$retention" -le 3650 ]] || { echo 'Retenção deve estar entre 7 e 3650 dias' >&2; exit 2; }
exec 9>"$root/.loja-backup.lock"
flock -n 9 || { echo 'Já existe backup em andamento' >&2; exit 1; }
name="loja-$(date -u +%Y%m%dT%H%M%SZ)-$$.gpg"
destination="$root/$name"
"$(dirname "$0")/backup-lan.sh" "$destination"
# A criptografia e o arquivo já foram validados pelo script de origem.
test -s "$destination"
# Nunca apagar arquivos até que um backup novo seja concluído.
# Remove apenas backups com padrão oficial, antigos, neste diretório; nunca outros dados.
find "$root" -maxdepth 1 -type f -name 'loja-????????T??????Z-*.gpg' -mtime "+$retention" -print0 |
 while IFS= read -r -d '' old; do
   [[ "$old" != "$destination" ]] && rm -- "$old"
 done
if [[ -n ${LOJA_RESTIC_REPOSITORY:-} ]]; then
 command -v restic >/dev/null || { echo 'Repositório restic solicitado, mas restic não está instalado' >&2; exit 1; }
 [[ -n ${RESTIC_PASSWORD_FILE:-} && -r "$RESTIC_PASSWORD_FILE" ]] || { echo 'RESTIC_PASSWORD_FILE protegido é obrigatório' >&2; exit 1; }
 # Repositório remoto ou local configurado explicitamente; nenhuma cloud obrigatória.
 restic -r "$LOJA_RESTIC_REPOSITORY" backup -- "$destination"
fi
printf 'Backup AES-256 concluído: %s\n' "$destination"
