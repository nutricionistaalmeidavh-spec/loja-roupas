cd "$(dirname "${BASH_SOURCE[0]}")/.."
umask 077
lan() {
  docker compose --env-file .env.lan -p loja-roupas-lan -f infra/compose.lan.yml "$@"
}
backup_gpg() {
  if [[ -n ${LOJA_BACKUP_PASSPHRASE_FILE:-} ]]; then
    gpg --batch --pinentry-mode loopback --passphrase-file "$LOJA_BACKUP_PASSPHRASE_FILE" "$@"
  else
    gpg "$@"
  fi
}
