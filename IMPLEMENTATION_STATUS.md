# Estado da implementação — Loja de Roupas

**Snapshot:** 22/11/2026. M0–M3 integrados; M4/M5 parcialmente integrados; a edição física v0.2.3 foi publicada como pré-release após PR #41. Rastreio detalhado em [status M0–M8](docs/06-roadmap/status-execucao.md).

| Marco | Implementado no repositório | Limites |
|---|---|---|
| M0 | Documentação D0–D6, 65 decisões e direção Retail Fashion | Validação legal/fiscal e homologação final UX pendentes |
| M1 | Monorepo pnpm/Turborepo; PostgreSQL Docker; migrações versionadas; Fastify; autenticação/RBAC; Web/PWA e casca Electron | PIN/dispositivos avançados, hardening e empacotamento não concluídos |
| M2 | Cadastro/edição de SKU, cor/tamanho, preço; fotos PostgreSQL com thumbnails Sharp; consulta paginada; estoque, histórico e ajustes idempotentes/auditados | Inventário colaborativo e testes com hardware/carga ainda pendentes |
| M3 | Abertura/movimentação/fechamento de caixa; cotação; venda ACID com baixa única; Pix manual/dinheiro/cartão externo; troco; suspensão e recibo não fiscal | Sem fiscal, PSP/TEF automático nem impressão em hardware |

[**CI final de M3: PASS, 5/5 E2E**](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/actions/runs/44326485213) com PostgreSQL e Playwright. Isso **não** é homologação para produção.

## Operação e homologação em revisão

A primeira entrega M4–M6 está na `main` via PR #13. Compras, acompanhamento da retirada e fila de impressão estão no PR #14. Inteligência e esteira de QA estão no PR #15. O PR #16 acrescenta o histórico de 36 meses, score auditável, campos de produto, instaladores e testes de periféricos. O [guia de homologação](docs/07-implementacao/m7-m8-inteligencia-homologacao.md) documenta os cenários automatizados e as verificações que exigem equipamentos da loja.

## Testar o desenvolvimento local

Pré-requisitos: Node >=22.12, pnpm 10, Docker Compose e OpenSSL. Na pasta do repositório:

```sh
sh scripts/bootstrap-dev.sh
pnpm install
set -a
. runtime/local.env
set +a
pnpm --filter @loja/api migrate
bash scripts/bootstrap-admin.sh
```

Em dois terminais separados (com as variáveis de `runtime/local.env` no terminal da API):

```sh
pnpm --filter @loja/api dev
pnpm --filter @loja/web dev
```

Abrir http://127.0.0.1:5173 no computador de desenvolvimento. O Vite proxy atende `/v1` via API na porta 3000. **Não expor este servidor de desenvolvimento na LAN pública nem instalar em cliente como produto acabado.** Testes de API sobre PostgreSQL exigem banco exclusivo de testes e bootstrap de QA.

## Restrições antes de uso comercial

- Electron ainda é **casca de desenvolvimento**, sem instalador GUI e sem binário distribuível testado.
- Sem internet pública, a operação LAN é objetivo; exige teste WAN-off real. Sem PostgreSQL acessível não se confirma venda.
- Pix e cartão são **confirmados manualmente pelo operador**, após conferência em banco/maquininha fora do sistema. Não há cobrança automática, guarda de cartão, PSP ou TEF.
- Comprovante **NÃO FISCAL** não substitui NFC-e/NF-e ou obrigação fiscal aplicável.
- Impressão de etiquetas/recibo com filas idempotentes, backup/restauração com fotos, atualização assistida, segurança de rede e QA em hardware são **M4**.
- Demais módulos M5–M8 continuam no escopo original e estão rastreados nas [issues #8–#11](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/issues).

**Core R$0 / AGPLv3 / open source / self-hosted.** Merge e publicação de release exigem comandos independentes.

## M4–M6 em desenvolvimento

[Instalação LAN, impressão, backup, gestão e vitrine](docs/07-implementacao/m4-m6-operacao-gestao-vitrine.md) descreve o escopo entregue e os gates pendentes de cada marco.

## Atualização pós-PR #41
O instalador Windows físico v0.2.3 está [publicado com checksum](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/releases/tag/loja-fisica-v0.2.3), sem homologação de hardware real. Recursos P1 estendidos e scripts LAN de backup cifrado estão em [PR #42](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/42) **draft, ainda não integrado**, com atualização física em canal exclusivo, sem OSV-Scanner nem serviço pago no core.
