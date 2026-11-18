# Registro canônico — 65 decisões

Fonte: decisões tomadas na conversa de planejamento da Loja de Roupas. Data-base 2026-11-17. Uma decisão não implica código pronto.

| ID | Decisão aprovada | Domínio | Verificação de aceite |
|---|---|---|---|
| D01 | Loja física única inicial | fundacao | Cadastro inicial possui uma loja, identificador de loja e possibilidade de expansão sem ativar multi-filial. |
| D02 | Desktop + Web/PWA | interfaces | Operações essenciais acessíveis no desktop e PWA, respeitadas permissões e conectividade. |
| D03 | PDV inteligente | pdv | Venda com leitura de código, pagamentos mistos, suspensão e descontos autorizados sem duplicidade. |
| D04 | Produtos com grade | catalogo | Cada combinação cor/tamanho possui SKU, código e estoque próprios; importação e etiquetas funcionam. |
| D05 | Pós-venda + crediário | pos-venda | Troca, devolução, crédito e parcelamento preservam lançamentos e trilha. |
| D06 | Financeiro avançado | financeiro | Caixas, contas, DRE, previsão e extrato são reconciliáveis às fontes. |
| D07 | CRM e fidelidade | crm | Pontos, cashback, cupons e segmentos respeitam consentimento e lançamentos. |
| D08 | Equipe e comissões | pessoas | Papéis, metas e divisão de vendas geram comissão reproduzível. |
| D09 | Compras e reposição | compras | Sugestões são justificadas e jamais viram pedidos automaticamente. |
| D10 | Central de impressão | impressao | Etiqueta Code128 e comprovantes entram em fila idempotente local. |
| D11 | Servidor local LAN | infra | Vendas funcionam na LAN sem internet pública; sem venda isolada por dispositivo. |
| D12 | Segurança e recuperação | seguranca | Backup cifrado, integridade, auditoria e restauração testada. |
| D13 | Recibos não fiscais | fiscal | Comprovante identificado como não fiscal; exportação pronta para emissor externo opcional. |
| D14 | Instalador guiado | implantacao | Assistente instala e diagnostica sem exigir edição de arquivo .env. |
| D15 | Dashboard por áreas | bi | Painéis respeitam área e permissão. |
| D16 | Identidade boutique premium | design | Componentes usam tokens de creme, café e grafite com contraste acessível. |
| D17 | Dashboard personalizável | bi | Widgets configuráveis preservam preferências e dados autorizados. |
| D18 | PDV guiado | pdv | Fluxos desktop e mobile cobrem busca, itens, pagamento e confirmação. |
| D19 | Cadastro guiado de produto | catalogo | Wizard e editor em grade produzem o mesmo estado canônico. |
| D20 | Inventário colaborativo | estoque | Contagens concorrentes exigem aprovação de ajustes e registram divergências. |
| D21 | Inteligência comercial | bi | Projeções locais exibem hipóteses, confiança e possibilidade de revisão. |
| D22 | Atualização assistida | implantacao | Atualização requer autorização de administrador e mecanismo de recuperação. |
| D23 | Importação assistida | integracao | Mapeamento, prévia, validação e log precedem importação definitiva. |
| D24 | Personalização por regras | configuracao | Regras e campos adicionais não alteram integridade nem permissões. |
| D25 | Desenvolvimento paralelo | engenharia | Contratos e limites permitem trabalho simultâneo por módulo. |
| D26 | Monólito modular PostgreSQL | arquitetura | Módulos partilham aplicação e base, sem acesso indevido às tabelas alheias. |
| D27 | PostgreSQL canônico | dados | Nenhuma escrita concorrente em bancos independentes por dispositivo. |
| D28 | Electron React TypeScript | interfaces | Desktop reaproveita UI, com isolamento de processos e IPC permitido. |
| D29 | Fila central de periféricos | impressao | Agente opcional executa trabalhos sem repetição após reconexão. |
| D30 | Permissões granulares | seguranca | RBAC, PIN, sessões e dispositivos auditados no servidor. |
| D31 | Instalação visual Docker Compose | implantacao | Wizard prepara serviço e verifica saúde sem edição manual de secrets. |
| D32 | Core gratuito self-hosted | licenca | Instalação padrão não exige assinatura, API paga nem infraestrutura comercial. |
| D33 | QA completo em CI | qualidade | PRs falham em contrato, E2E, migração, segurança ou regressão crítica. |
| D34 | Monorepo pnpm Turborepo | engenharia | Pacotes seguem dependências explícitas e builds reproduzíveis. |
| D35 | Outbox transacional idempotente | dados | Mutação e evento persistem na mesma transação; retry não duplica efeito. |
| D36 | LAN padrão e remoto opcional | infra | Acesso remoto só por HTTPS/VPN autorizado; LAN opera isolada. |
| D37 | Reconexão e rascunhos | pdv | Rascunho não confirma venda sem resposta do servidor; retomada é idempotente. |
| D38 | Pagamentos extensíveis | pagamentos | Dinheiro, Pix manual, cartão registrado e crediário sem dependência de adquirente. |
| D39 | Preço e promoções inteligentes | precos | Combos, progressivos e descontos validam margem e aprovação. |
| D40 | Reservas e pré-vendas | pedidos | Reserva, sinal, validade e conversão não ultrapassam estoque disponível. |
| D41 | Atendimento e provadores | atendimento | PWA de vendedor rastreia peças em prova e devolução ao salão. |
| D42 | Preparação multi-filial | dados | store_id aplicado a entidades pertinentes e isolado por consulta. |
| D43 | Grades de tamanhos | catalogo | Medidas e equivalências distinguem marca, categoria e tamanho. |
| D44 | REST/OpenAPI e WebSocket | contratos | API documentada, eventos com cursor e recuperação após desconexão. |
| D45 | Privacidade e LGPD | privacidade | Consentimento, exportação, retenção e atendimento a solicitações auditados. |
| D46 | Licença AGPLv3 | licenca | Arquivos-fonte futuros terão licença adequada; marcas não são automaticamente licenciadas. |
| D47 | Busca contextual | busca | Busca por SKU/código exato e texto respeita escopo e permissão. |
| D48 | Qualidade e perdas | estoque | Avarias, bloqueios e perdas geram movimentos imutáveis e aprovação. |
| D49 | Consignação | compras | Propriedade de mercadorias e liquidação são distintas do estoque próprio. |
| D50 | Ajustes e costura | servicos | Ordem de serviço registra medidas, custos, prazo, status e entrega. |
| D51 | Catálogo digital | catalogo | Vitrine não mostra disponibilidade desatualizada como garantia. |
| D52 | Pedidos online, retirada e entrega | pedidos | Pedido reserva peças e possui estados válidos, cobrança e cancelamento. |
| D53 | Gestão de entrega e retirada | logistica | Responsável, taxa, prova de entrega e tentativas são rastreáveis. |
| D54 | Automação de relacionamento | crm | Regras exigem consentimento e canais pagos são conectores opcionais. |
| D55 | Indicações | crm | Convites, atribuição e recompensa são antifraude e auditáveis. |
| D56 | Coleções e sazonalidade | colecoes | Calendário e curva de vendas orientam sugestão, sem alteração automática. |
| D57 | Inteligência de fornecedores | compras | Score justificável avalia prazo, qualidade, preço e amostra suficiente. |
| D58 | Cartões-presente inteligentes | beneficios | Saldos são razão de movimentos; emissão, resgate e bloqueio idempotentes. |
| D59 | Kits e presentes | catalogo | Venda de kit consome componentes uma vez e atribui custos de embalagem. |
| D60 | Publicação inteligente de preços | precos | Versões aprovadas sincronizam POS e vitrine; etiquetas pendentes ficam visíveis. |
| D61 | Planejamento comercial inteligente | bi | Metas e cenários explicitam premissas e consideram devoluções. |
| D62 | Desenvolvimento paralelo total | engenharia | Módulos podem iniciar juntos com ordem de integração controlada por contratos. |
| D63 | Contract-first isolado | contratos | Mudança breaking exige versionamento e teste de consumidor. |
| D64 | Gates completos de qualidade | qualidade | Release bloqueada por falha P0, sem aprovação manual ou restauração comprovada. |
| D65 | Documentação antes do código | governanca | D0–D6 documentados e revisados antes de autorização para implementar. |

## Hierarquia de interpretação
1. Requisito do usuário: R$0, open source, self-hosted no núcleo; pagamento opcional explícito.
2. Decisões 1–65: escolhas funcionais e arquiteturais já aprovadas.
3. ADRs e contratos: detalhamentos propostos que não podem contrariar os itens acima.
4. Backlog: ordem de implementação futura, sem retirar módulos definidos.

## Exclusões e ressalvas deliberadas
- Sem emissão nativa de NFC-e/NF-e nesta versão; não prometer adequação fiscal somente com comprovante não fiscal.
- Sem exigência de adquirente, TEF, Pix dinâmico, mensageria externa, IA hospedada ou provedor SaaS.
- Sem processamento/armazenamento de dados sensíveis de cartão de crédito (PAN/CVV).
- Sem escrituração automática de pedidos de compra ou publicação de promoções sem autorização aplicável.
- Sem bases locais autônomas de venda em computadores separados: LAN central atende vários dispositivos.
- Multi-filial preparado no modelo, mas a gestão multi-filial completa não está liberada no primeiro lançamento.
- Não fazer merge, release, configurações de secrets ou código antes de autorização.

## Critério de alteração de decisão
Mudanças precisam registrar autor, justificativa, impacto, compatibilidade, documentos afetados e autorização explícita.
