# Sincronização Loja Roupas ↔ marketplace online

## Separação e custo
- O PDV, as vendas, preços, reservas e estoque canônico permanecem no PostgreSQL self-hosted, **R$ 0 / open source**.
- O Worker online da ArtiSys é opcional; Cloudflare não é necessária para instalar o programa, operar o caixa ou exportar dados.
- Usa somente HTTPS de saída, sem Tunnel, portas públicas ou serviços pagos obrigatórios.

## Primeira configuração
1. Liberar a licença comercial pela central ArtiSys, vinculando a instalação ao produto `LOJA_ROUPAS`.
2. Administrador ArtiSys cadastra a vitrine no Worker com `slug`, `name`, `installationId` e `ownerEmail`. A chave `syncKey` é revelada apenas nesta operação.
3. No desktop, entrar como gestor, abrir **Gestão → Vitrine → Conectar ao marketplace ArtiSys** e informar slug e chave.
4. A API verifica a licença e a identidade do tenant via `GET /v1/sync/identity`. Não é possível conectar a chave de outra vitrine.
5. Publicar as variações desejadas no sistema. O processo local sincroniza automaticamente a cada minuto e pode ser acionado manualmente.

## Garantias de integridade
- `marketplace_links`: segredo cifrado via AES-256-GCM com chave gerada localmente. Em Windows, preservada no perfil do aplicativo, separada da instalação. Em servidores Linux usar `LOJA_SYNC_SECRET_DIR` para direcionar o arquivo `master.key` a um diretório de backup privado. **Não enviar chaves ao frontend.**
- `marketplace_listings`: snapshot com fingerprint e revisão crescente. A confirmação remota grava `delivered_revision` somente depois do ACK. Falha de rede mantém a atualização pendente, evitando perder estoque.
- Produtos despublicados são enviados como `published:false`, removendo-os do marketplace sem apagar o histórico.
- Fotos são miniaturas WebP de até 65 KB, armazenadas separadamente no D1 do Worker. A foto original continua no PostgreSQL. O serviço online utiliza a cota gratuita do D1, que pode limitar operações em catálogos muito grandes; armazenamento R2 é futuro e **opcional**.
- `marketplace_orders`: UUID remoto e request ID únicos por loja. Importações repetidas não duplicam pedidos.
- Aceitar uma solicitação **reserva** a quantidade canônica com transação SQL e trava contra estoque insuficiente. Recusar/cancelar libera essa reserva uma única vez; nunca cria automaticamente pagamento ou venda fiscal.
- O status é enviado via PATCH idempotente; offline apenas acumula pendências no PostgreSQL. Um lock de banco evita múltiplos sincronizadores simultâneos da mesma loja.
- Pedidos recusados por falta de estoque continuam pendentes para decisão do gestor; o Worker nunca promete confirmação automática.

## Endpoints administrativos locais
- `GET /v1/management/marketplace/status`
- `POST /v1/management/marketplace/connect` com `{slug,sync_key}`
- `PATCH /v1/management/marketplace` com `{enabled}`
- `POST /v1/management/marketplace/sync-now`
- `GET /v1/management/marketplace/orders`
- `POST /v1/management/marketplace/orders/:id/decision` com `accepted|rejected`

Todos exigem autenticação local com permissão `storefront.publish`. O login do portal online continua independente da licença do desktop.

## Implantação
1. Aplicar a migração PostgreSQL `infra/sql/0017_marketplace_bridge.sql` pelo migrador existente; nunca modificar migrações anteriores.
2. Executar **antes do deploy online** a migração D1 `cloudflare/loja-roupas-vitrine/photo-schema.sql` no banco `loja-roupas-vitrine`.
3. Publicar Worker mantendo D1, service binding `LICENSE_CENTER` e `PLATFORM_ADMIN_TOKEN` existentes, sem criar segredos novos.
4. Executar `node --test cloudflare/loja-roupas-vitrine/test/*.test.mjs` e `pnpm --filter @loja/api test` com PostgreSQL descartável.
5. Testar uma loja com licença real: publicar 2 SKUs, receber pedido, aceitar (reserva), reconectar após offline, cancelar (liberação) e comparar disponibilidade no Worker.

**Limite atual:** a finalização comercial e o recebimento de pagamento continuam pelo PDV local. Não converter automaticamente pedido online em venda ou recebimento. Antes da primeira distribuição comercial, homologar ainda o instalador Windows e os demais E2E da aplicação.
