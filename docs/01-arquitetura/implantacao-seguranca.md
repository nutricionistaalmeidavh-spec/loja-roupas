# D1 — Implantação, operação, segurança e recuperação

## Topologias
**Padrão self-hosted LAN:** computador/servidor Linux com Docker Compose, PostgreSQL em volume persistente, API e web servidos na LAN; caixas Electron e celulares PWA conectados pelo endereço local configurado. Internet não participa das transações críticas.

**Servidor remoto opcional:** mesmo core em Linux/VPS ou servidor próprio exposto somente por HTTPS com certificados válidos e controle de acesso. VPN pode ser configurada pelo cliente; não depende de túnel pago.

## Wizard administrativo pretendido
1. Checagem de CPU, RAM, disco, portas, conectividade LAN e permissões.
2. Escolha entre primeira instalação, migração e restauração.
3. Seleção de host/porta, nome da loja, timezone America/Sao_Paulo e backup local.
4. Geração de segredos criptograficamente fortes; gravação em armazenamento protegido pelo sistema operacional. Sem exigir edição manual de .env.
5. Inicialização controlada de Docker Compose; health checks PostgreSQL/API/web.
6. Criação de administrador por convite/segredo de bootstrap de uso único; exigir troca.
7. Teste de conexão do caixa, PWA, agente opcional e impressão.
8. Validação de backup inicial, checklist de prontidão e instruções de recuperação.

## Segurança por camada
- Exposição PostgreSQL somente interna; API tem autenticação, RBAC e rate limits.
- HTTPS obrigatório para remoto; na LAN fornecer opção TLS local por certificado confiável, documentando instalação. Credenciais jamais transmitidas em HTTP público.
- Electron: nodeIntegration=false, contextIsolation=true, webSecurity habilitado, preload API mínima e validação de origem IPC.
- Web/PWA: cookies HttpOnly/SameSite/Secure quando HTTPS, CSRF nas rotas mutáveis, CSP, sanitização, e não armazenar token persistente em localStorage.
- Auditoria append-only lógica e exportável: desconto, caixa, preços, estorno, ajuste, permissões, importações e backup.
- Logs: request_id, actor_id, store_id, operation_id e status; ocultar segredos, dados bancários e PII não necessária.

## Backup e restauração
- PostgreSQL: dump consistente, hash SHA-256 e criptografia autenticada com chave separada; armazenar cópias fora da máquina quando possível (destino opcional self-hosted).
- Registro de manifesto com versão, migração, horário, hash, política de retenção e resultado de restore.
- Procedimento: bloquear novas escritas, escolher ponto, validar integridade, restaurar em ambiente de teste, executar invariantes de saldos, emitir relatório, só então efetivar restauração com autorização.
- Migrações: aplicar com lock de migração; snapshot anterior; scripts destrutivos e reversões não seguras exigem estratégia de recuperação, nunca rollback presumido.

## Atualizações
Download/verificação de hash/assinatura conforme mecanismo posteriormente definido; admin autoriza; backup verificado antes da mudança; smoke tests; rollback binário se schema compatível; se incompatível, procedimento documentado de restore. Nenhuma atualização silenciosa.

## Gestão de incidentes
P0 (risco de perda/duplicidade de venda): bloquear deploy, preservar logs, restaurar serviço com isolamento, reconciliar. P1 (fluxo crítico degradado): rollback ou hotfix com QA. P2 (problema não crítico): backlog regular. Sempre sem alterar dados manualmente sem procedimento auditável.
