# D5 — Estratégia de qualidade, segurança e homologação

Esta é uma **especificação de esteira**, não resultado de testes executados. Sem código, nenhum teste está PASS.

## Camadas obrigatórias
| Camada | O que prova | Ferramentas gratuitas sugeridas |
|---|---|---|
| Documentação | links, IDs D01–D65, ADRs, critérios completos | lint Markdown, revisão estrutural |
| Contrato | OpenAPI válido, schemas/eventos compatíveis | parser OpenAPI local, JSON Schema |
| Unitário | descontos, impostos externos informativos, quantidades, reservas, créditos | Vitest |
| Banco | locks, constraints, migrações, reconciliação | PostgreSQL real isolado em Docker |
| Integração | endpoints + auth + banco + outbox + consumidores | Vitest + test containers local |
| E2E Web/PWA | cadastro → estoque → venda → caixa → relatório | Playwright Chromium/Firefox/WebKit conforme compatibilidade |
| E2E Desktop | janelas, IPC, periféricos simulados, atualização | Playwright Electron |
| Segurança | autorização, tenant/store boundary, injeção, segredos e dependências | OWASP ZAP, Semgrep community, scanners OSS |
| Performance | carga com 5 caixas e busca em catálogo de 50 mil variantes | k6 open source |
| Recuperação | backup, restore, migração, queda WAN/LAN, timeouts | cenários reproduzíveis |
| Usabilidade | operador caixa e vendedor, desktop e mobile, WCAG AA | axe-core + ensaio humano |

## Política de branches e CI
- Cada módulo em branch dedicada; contratos de integração são estabilizados antes da lógica.
- PR exige revisão de contrato, lint, build, testes unitários, integração, testes de migração e E2E dos fluxos afetados.
- Não há publicações automáticas. Gate final sempre requer autorização humana expressa de merge e release.
- Scripts e workflows futuros devem executar em runners self-hosted para não depender de plano pago.
- Relatórios de QA preservam logs anonimizados e evidências de vídeo/screenshots quando apropriado, sem dados reais de clientes.

## Gates propostos
G0: documentos e licenças; G1: qualidade estática; G2: contrato/compatibilidade; G3: domínio e banco; G4: E2E cross-module; G5: segurança; G6: carga e resiliência; G7: instalação, backup/restore; G8: homologação humana; G9: autorização explícita de merge/release.

Metas iniciais: >=80% cobertura de linhas nas regras puras críticas e 100% dos invariantes financeiros/estoque com cenários direcionados; não aceitar cobertura como substituto de teste de negócio. Zero falhas P0/P1 conhecidas na candidata. Medição de latência e capacidade segundo RNFs, jamais assumir PASS sem execução.

## Testes adversariais prioritários
1. Duas vendas simultâneas da última peça: uma confirma, outra recebe 409.
2. Timeout após commit: retry com mesma chave retorna venda existente, sem segunda baixa.
3. Mesmo gift card em dois caixas: um resgate respeita saldo, outro bloqueia excesso.
4. Caixa fecha durante venda em curso: fechamento espera/rejeita com estado consistente.
5. Cancelamento de pedido e expiração concorrentes: reserva liberada uma só vez.
6. Etiqueta antiga versus promoção ativa: alerta e regra de preço canônica.
7. Recebimento parcial repetido: estoque não duplica, divergência registrada.
8. PIN de operador sem autorização: backend nega desconto/estorno.
9. Rede WAN desconectada: venda LAN funciona; integração externa entra em pendência.
10. Servidor LAN desconectado: não é possível concluir venda offline independente.
11. Corrupção de backup: integridade falha e restore não sobrescreve produção.
12. Migração interrompida: mecanismos de retomada/restore validam consistência.
13. Eventos duplicados ou fora de ordem: projeção e saldo final preservados.
14. Requisição da loja B com sessão da loja A: acesso negado sem vazamento.
15. Consentimento revogado durante fila de campanha: envio futuro cancelado.
16. Reembolso parcial de item previamente devolvido: limite cumulativo aplicado.

## Execução documentada futura
Cada prova deve gerar: ID do requisito, commit SHA, ambiente, versão do schema, dados fictícios, passos, resultado esperado, resultado observado, logs e anexos. Relatórios em artefatos controlados; não declarar PASS por inspeção visual isolada.

## QA visual do PDV (UX-RPOS-01)
Além dos testes transacionais existentes, criar Playwright visual nas larguras 1440, 1366, 1280, 1024, 768, 390 e 320px. Capturar ProductGrid, variantes, carrinho com >10 linhas, resumo mobile, checkout, estados de foto ausente, produto esgotado, timeout e LAN indisponível. Executar teste de keyboard wedge e axe-core; imagens de fixtures licenciadas e hospedadas localmente. QA-UX-01 a QA-UX-12 são gates P0, e não exigem SaaS nem screenshot/cloud pagos. Não declarar PASS até executar os testes sobre UI real.
