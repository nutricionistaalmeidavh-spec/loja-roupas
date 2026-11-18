# D6 — Handoff, checklist documental e pendências de homologação

## Inventário documental entregue
- [x] D0: PRD, 65 decisões, matriz, requisitos não funcionais e política fiscal/custo.
- [x] D1: visão C4 (diagramas Mermaid), limites de módulos, implantação/segurança, ADRs.
- [x] D2: ER lógico, dicionário canônico, invariantes, transações e migrações.
- [x] D3: contrato OpenAPI proposto, catálogo de eventos e matriz de autorização/idempotência.
- [x] D4: tokens de design, inventário de telas e wireframes/jornadas textuais.
- [x] D5: testes, gates, critérios de aceite e matriz de cenários.
- [x] D6: épicos, dependências, riscos e plano de integração paralelo.

**Este checklist sinaliza presença de especificação, não revisão concluída, protótipo navegável, execução de teste ou software implementado.**

## Antes de aprovar o pacote
- [ ] Validar com gestor os detalhes técnicos adicionais não escolhidos nas 65 decisões (ex.: Fastify, formato de sessões, tempos de recuperação e limites operacionais).
- [ ] Fazer revisão legal/fiscal das operações não fiscais, créditos, gift cards, LGPD, retenção e canais de comunicação conforme realidade do estabelecimento.
- [ ] Validar inventário de telas e wireframes com gestor/usuários; se exigido, criar protótipos visuais navegáveis antes de implementar.
- [ ] Passar lint estrutural da documentação e parser OpenAPI, revisar referências cruzadas e tipos JSON Schema.
- [ ] Aprovar política de migrações, descontos, preços e alçadas de autorização.
- [ ] Determinar hardware-alvo e validar métricas de RNFs; números atuais são metas.
- [ ] Revisar composição de software open source e licenças antes de distribuir.
- [ ] Aprovar a especificação D0–D6 e só então autorizar trabalho de implementação.

## Antes de iniciar EP-01
- [ ] Abrir issues por épico e tarefa com Dnn, RF, schema, permissão, caso de teste e dependências.
- [ ] Definir proprietários dos contratos e revisores; estabelecer branch protection.
- [ ] Fixar versões de linguagem, Node, pnpm, PostgreSQL, Electron e browsers por ADR.
- [ ] Criar dados sintéticos de QA e matriz de impressoras suportadas.
- [ ] Não solicitar nem alterar secrets de produção sem decisão explícita.
- [ ] Não fazer merge/release por conveniência ou sucesso isolado do pipeline.

## Entrega à homologação
Uma aprovação de documentação permite **solicitar** implementação posterior; ela nunca implica autorização para merge ou release. Merge e publicação continuam etapas humanas distintas.

## Homologação adicional UX-RPOS-01
- [x] Novo escopo visual e critérios de P0 documentados em D0/D4/D5/D6.
- [ ] Aprovar o mockup visual revisado e suas variantes desktop/mobile.
- [ ] Conferir fotos fictícias licenciadas, 7 viewports, teclado/barcode e contraste.
- [ ] Executar QA-UX-01..12 após a implementação, não enquanto só houver documentação.
- [ ] Autorizar início do código; **merge e release exigem comandos separados**.

[Roadmap final consolidado](roadmap-final.md).
