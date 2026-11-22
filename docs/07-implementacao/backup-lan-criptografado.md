# Backup cifrado e retenção — Loja de Roupas LAN

O banco PostgreSQL permanece canônico e local. O script `scripts/backup-lan.sh` cria um dump custom `pg_dump -Fc` e cifra com **GnuPG AES-256**, gratuito. O novo `scripts/backup-lan-rotate.sh` faz execução com trava `flock`, nome único UTC, exige senha fora do repositório e elimina apenas arquivos antigos da própria rotina depois de um backup completo.

## Preparar

```bash
sudo apt-get install gnupg util-linux
sudo mkdir -p /mnt/backup-loja
sudo install -m 600 /dev/null /etc/loja-backup-passphrase
# Insira manualmente a frase-secreta forte com um editor seguro; NÃO salve no repositório.
export LOJA_BACKUP_PASSPHRASE_FILE=/etc/loja-backup-passphrase
export LOJA_BACKUP_RETENTION_DAYS=30
bash scripts/backup-lan-rotate.sh /mnt/backup-loja
```

Configure `cron` ou `systemd timer` para executar diariamente no próprio servidor, usando o mesmo usuário que tem acesso à instalação Docker LAN e à frase-secreta. Exemplo cron: `0 2 * * * /opt/loja/scripts/backup-lan-rotate.sh /mnt/backup-loja`. Exporte as variáveis no serviço/timer, não em terminal de cliente. **Nunca armazene a senha no backup ou no GitHub**.

Para testar uma restauração em **banco isolado**, use `scripts/restore-lan.sh BACKUP_GPG loja_restore_teste` e compare vendas, fotos, migrações e operações. Não substitua o banco ativo sem procedimento e aprovação humana. Preserve cópias fora do equipamento. O backup criptografado de LAN é independente do exportador manual do Electron, que atualmente gera `.dump` puro e exige mídia criptografada.

### Restic OSS opcional

O <https://github.com/restic/restic> permite cópias incrementais cifradas em disco local, NAS ou repositório remoto. Para habilitar a cópia do `.gpg` já cifrado, defina explicitamente `LOJA_RESTIC_REPOSITORY` e `RESTIC_PASSWORD_FILE`, inicialize antes o repositório (`restic init`) e instale o CLI. O core continua funcionando sem restic, internet, serviço pago ou conta.

### Integridade e segurança

- Uma falha do dump ou GnuPG impede limpeza de backups anteriores.
- Backups de arquivo não substituem testes periódicos de restauração nem retenção fora da máquina.
- Atualizações Windows usam mecanismo próprio de backup pré-atualização e rollback.
- Homologação operacional requer teste real de recuperação em equipamento alternativo.
