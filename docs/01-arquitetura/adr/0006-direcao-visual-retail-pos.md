# ADR-0006 — Refinamento visual Retail Fashion POS

- **Status:** direção aprovada para o PDV; documentação de execução pendente de homologação no PR.
- **Contexto:** após a documentação D0–D6, o gestor preferiu a referência “Lunatics – Retail POS Dashboard” ao SVG inicial do repositório.
- **Decisão:** priorizar catálogo fotográfico em grade, variação cor/tamanho selecionada no cartão, menu lateral compacto, busca/scan acessível e carrinho persistente no desktop; branco/cinza/preto como base e creme/café como acento.
- **Compatibilidade com D16:** marca continua boutique premium, porém a superfície do PDV é mais neutra. Não se altera nenhuma das 65 decisões canônicas.
- **Consequências:** EP-09 recebe gate explícito de fidelidade estrutural; EP-04 fornece foto/variant_id; EP-30 valida viewport/teclado/QA visual; PWA usa drawer. A lógica de estoque/preço/checkout não muda de domínio.
- **Proibido:** copiar assets de Dribbble, depender de UI paga, CDN de imagens obrigatória, criar regra de precificação no frontend ou publicar sem autorização.
- **Aceite:** [UX-RPOS-01](../../04-design/direcao-visual-retail-pos.md) e QA-UX-01..12.
