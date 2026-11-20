# Vitrine multitenant Loja Roupas

Worker independente do `pdv-artisys`. Banco D1 separado `loja-roupas-vitrine`. O core desktop (Electron + PostgreSQL local) opera sem Cloudflare.

- Publicação: `/loja/:slug` / `GET /v1/storefront/:slug`.
- Pedidos são solicitações para retirada, sempre **pendentes**, sem reserva ou pagamento automático.
- Sincronização: `PUT /v1/sync/catalog` (revisões monotônicas), `GET /v1/sync/orders`, `PATCH /v1/sync/orders/:id`. Credencial exclusiva por tenant é salva **somente como hash** no D1.
- Registro do tenant: `POST /v1/admin/tenants` com `Authorization: Bearer <PLATFORM_ADMIN_TOKEN>`, corpo `{slug,name,installationId}`; requer licença `LOJA_ROUPAS` ativa verificada pelo service binding `LICENSE_CENTER` ao Worker existente `pdv-artisys`; devolve `syncKey` apenas uma vez. Não registrar clientes antes da liberação da licença.
- Sairá sempre para HTTPS na Cloudflare. Não há Tunnel, porta pública na LAN nem chave de banco no cliente.
- Worker binding D1 `DB`, Worker service `LICENSE_CENTER`, secret apenas no novo Worker `PLATFORM_ADMIN_TOKEN` (mín. 32 caracteres). Usar ambiente isolado para QA e não compartilhar segredos.
- Migrações em `schema.sql`; aplicação aditiva, sem mexer nas tabelas dos demais produtos.
- `node --test cloudflare/loja-roupas-vitrine/test/*.test.mjs`.

O plano gratuito da Cloudflare tem cotas. Não é uma dependência do core livre: a vitrine é opcional e a interface de sincronização é isolada para permitir provedor open source self-hosted alternativo.

A integração desktop automática só pode ser habilitada após o cliente ativar a licença comercial e o gestor cadastrar a loja no Worker. Emissão de licenças e email de boas-vindas são responsabilidade exclusiva do Worker `pdv-artisys` e do serviço de email transacional.
