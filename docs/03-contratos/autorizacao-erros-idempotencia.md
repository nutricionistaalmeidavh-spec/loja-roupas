# D3 — RBAC, sessões, erros, concorrência e idempotência

## Permissões
Permissão é reivindicação do servidor, nunca do front. Padrão deny-by-default, segregação por store_id. Perfis iniciais são templates, não permissões fixas de código.

| Operação | Gestor | Caixa | Vendedor | Estoquista | Comprador | Admin técnico |
|---|---|---|---|---|---|---|
| Cadastrar/alterar produto | sim | não | consulta | consulta | consulta | não |
| Vender/receber | sim | sim | se delegado | não | não | não |
| Aplicar desconto elevado | sim | aprovação | aprovação | não | não | não |
| Estornar/devolver | sim | aprovação | não | não | não | não |
| Ajustar estoque | sim | não | não | submeter | não | não |
| Aprovar ajuste | sim | não | não | não por padrão | não | não |
| Fechar caixa | sim | próprio caixa | não | não | não | não |
| Fornecedor/pedido compra | sim | não | não | recebimento | sim | não |
| Aprovar preço/campanha | sim | não | não | não | não | não |
| CRM dados restritos | sim | mínimo necessário | mínimo necessário | não | não | não |
| Permissões e backup | sim | não | não | não | não | escopo técnico |
| Logs de auditoria | sim | não | não | não | não | técnicos mascarados |

## Ações com confirmação reforçada
Estorno, grande desconto, alteração de preço vigente, fechamento com divergência, ajuste negativo grande, exclusão/anonimização de cliente, restauração, gestão de permissões e ativação de integração externa. Os limites monetários são configuráveis pelo gestor.

## Sessão
- Login inicial com senha; PIN de operador é atalho controlado para alternância de sessão já provisionada, com rate-limit e revogação.
- Sessões associadas a dispositivo e prazo, bloqueio por inatividade parametrizável; negar acesso de dispositivos revogados.
- Web: cookie HttpOnly, SameSite e CSRF para requests mutáveis; desktop: bearer opaco protegido no sistema, nunca exposto no renderer.
- X-Store-Id é apenas escopo requisitado; sempre verificar vínculo usuário-loja no servidor.

## Contrato de erros
Content-Type application/problem+json. Campos: type, title, status, code, request_id, detail e retryable. Não revelar informações de clientes, tokens ou regras internas não necessárias.

| HTTP | code | Condição |
|---|---|---|
| 400 | BAD_REQUEST | estrutura inválida |
| 401 | UNAUTHORIZED | sessão expirada/ausente |
| 403 | FORBIDDEN | permissão ou escopo negado |
| 404 | NOT_FOUND | recurso indisponível ou fora do escopo |
| 409 | CONFLICT | estoque insuficiente, revisão stale, estado incompatível |
| 409 | IDEMPOTENCY_KEY_REUSED | mesma chave, payload diferente |
| 422 | DOMAIN_INVALID | regra de negócio violada |
| 429 | RATE_LIMITED | tentativas acima do limite |
| 503 | SERVICE_UNAVAILABLE | dependência LAN indisponível |

## Idempotência
- Headers obrigatórios em operações críticas de criação/movimentação.
- Escopo = store_id + actor_id + operation_id. Persistir hash do payload canônico, resultado final e status de processamento.
- Chave igual e hash igual: reentregar resultado anterior sem executar novamente.
- Chave igual e hash diferente: 409. Chave desconhecida após timeout: cliente consulta o recurso ou repete mesma chave e payload.
- Expiração/retention de idempotency records deve exceder janela realista de retry e auditoria; compras, vendas e créditos precisam também de chave única de negócio permanente.
- Atualização condicional por expected_revision ou If-Match para evitar lost update.

## Códigos e identificadores
UUID v4 no exemplo documental; avaliar UUIDv7 no ADR de implementação. Códigos de presente são gerados aleatoriamente, armazenados como hash e mostrados apenas na emissão, sujeitos a rate limits. Evitar códigos previsíveis/sequenciais que exponham saldo.
