# Inteligência comercial e evidências de homologação

## M7 · Indicadores da Gestão

A área Inteligência comercial usa as vendas, devoluções, variantes e compras da loja autenticada no PostgreSQL. O gerente configura uma meta mensal padrão, um limite de estoque disponível e os indicadores visíveis para a loja. A alteração é auditada e suporta reenvio idempotente.

| Indicador | Como é calculado |
|---|---|
| Vendas líquidas e meta | Vendas escrituradas menos devoluções registradas no mês e fuso da loja. |
| Sazonalidade | Trinta e seis meses civis com bruto, devoluções e líquido. O mês atual está em andamento. |
| Projeção de 14 dias | Média dos líquidos de duas quinzenas completas anteriores ao dia atual. A faixa mostra os totais observados nas duas quinzenas. É exibida a partir de sete dias com vendas na janela de 28 dias. |
| Coleções | Vendas confirmadas dos últimos 90 dias, agrupadas pelo nome da coleção atual do produto. |
| Fornecedores | Contagem de pedidos e recebimentos dos últimos 90 dias. O prazo médio é exibido a partir de três pedidos recebidos. |
| Estoque baixo | Até 30 SKUs com disponibilidade igual ou inferior ao limite. As unidades reservadas são descontadas. |

O painel agrega os lançamentos de devolução disponíveis no sistema. Hoje eles correspondem à devolução integral em dinheiro. A projeção e o alerta de estoque são informativos. O cadastro de compras ainda carece de evidências de prazo prometido e qualidade para um score completo. Campos personalizados continuam pendentes.

## M8 · Esteira e candidata

| Verificação | Evidência prevista |
|---|---|
| Contratos, domínio, API e Web | Tipos, build, comportamento de previsão, teste de isolamento por loja e transações de estoque e caixa com banco real. |
| Interface | Playwright percorre compras, retirada, devolução e configuração de um painel. O cenário do painel verifica navegação e captura sete larguras entre 320 e 1440 px. |
| Operação LAN | Smoke test Docker Compose com 40 leituras autenticadas e oito concorrentes, interrupção e recuperação do PostgreSQL, backup criptografado e comparação dos dados restaurados. |
| Candidatas Linux e Windows x64 | Pacotes Electron portáteis acompanhados de SHA-256 como artefatos de CI por sete dias. O cliente usa um servidor Loja de Roupas disponível em LAN. |

A homologação geral inclui operação física sem WAN, impressoras e scanners reais, PWA em aparelhos, carga representativa da loja, auditoria completa de acessibilidade, revisão geral de segurança e instaladores nativos. A publicação de uma release segue o fluxo de aprovação do projeto.

## Homologação de instalação e periféricos

| Cenário | Ensaio automatizado | Evidência física ainda necessária |
|---|---|---|
| Scanner | Chromium envia a sequência de teclas do scanner e Enter no campo do PDV. A leitura do código de barras adiciona a variante e a venda é concluída com o estoque do servidor. | Leitura com scanner USB ou Bluetooth configurado como teclado. |
| Etiqueta | O PDV renderiza Code 128 e o CI decodifica a imagem com ZBar, além de guardar um PDF da etiqueta. | Contraste, escala, margem e leitura após imprimir na mídia real. |
| Comprovantes térmicos | O navegador exercita a solicitação auditada, gera PDFs com largura de 58 e 80 mm e verifica largura e texto com Poppler. | Driver, margem, corte e impressão efetiva nos dois formatos. |
| PWA sem rede | Chromium testa o bundle de produção, controlador do service worker, erro offline e recuperação. | Instalação e retomada em aparelhos Android e iOS. |
| Operação sem WAN | A stack é iniciada a partir de imagens locais em rede Docker interna. Autenticação e leitura do catálogo passam pelo proxy usando a base existente. | Repetir com servidor e terminal em equipamentos separados na LAN da loja, com o enlace da internet desligado. |
| Distribuição nativa | O CI compila e exercita instalação e desinstalação do pacote Debian amd64 e do setup Windows x64. Checksum acompanha os artefatos. | Validação em máquinas-alvo com os drivers e políticas locais. O cliente continua usando o servidor LAN. |

A tabela de sazonalidade agora contém 36 meses civis. O contrato mantém a janela original de 12 meses em `months` e fornece o histórico estendido em `historical_months`.
