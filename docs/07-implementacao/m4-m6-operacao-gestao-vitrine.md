# Instalação LAN, gestão e vitrine

Esta entrega parcial cobre a operação LAN self-hosted, impressão pelo navegador, backup cifrado, cadastro de fornecedores, devoluções em dinheiro, vitrine, retirada no caixa e reservas internas.

## Instalar e diagnosticar

No servidor Linux, prepare Docker Engine com Compose v2, Bash, OpenSSL e curl. Para backup, instale também GnuPG. A primeira montagem precisa baixar as imagens e dependências open source. O servidor de banco fica na rede interna do Compose e a interface usa a mesma origem para Web e API.

```bash
bash scripts/install-lan.sh
```

O assistente pede IP de escuta, porta, nome da loja e credenciais iniciais. O padrão é `127.0.0.1:8080`. Para abrir nos terminais em uma LAN confiável, informe o IP fixo do servidor na interface da rede local. Em cada terminal, abra `http://IP_DO_SERVIDOR:8080`. Para redes compartilhadas ou acesso externo, configure HTTPS com certificado confiável e restrinja o acesso administrativo no proxy ou na VPN. Servir a vitrine externamente exige uma configuração própria para rotear apenas a página, seus assets e as rotas públicas de vitrine e pedidos de retirada.

O menu compacto dá acesso a Produtos, Estoque, Caixa e Gestão no celular conforme as permissões. Em uma origem segura (HTTPS ou localhost), use a opção do navegador para instalar a PWA. Se o servidor ficar inacessível, a PWA mostra uma tela de reconexão. Dados comerciais e gravações dependem da API LAN.

O endpoint `/v1/ready` testa a conexão real ao banco. Consulte serviços e logs no diretório do projeto.

```bash
source scripts/lan-common.sh
lan ps
lan logs --tail 80 api web postgres
```

Para atualizar, faça backup, preserve a versão anterior do código e execute `bash scripts/install-lan.sh --upgrade` no novo checkout com o mesmo `.env.lan`. O processo reaplica as migrações pendentes e sobe as imagens. Para voltar após uma migração incompatível, restaure o backup anterior em um banco isolado e use o checkout correspondente. A publicação de instaladores assinados, testes em Windows/macOS e recuperação automatizada permanecem pendentes.

## Cliente desktop e impressão

Execute `corepack pnpm install --frozen-lockfile` e `corepack pnpm --filter @loja/desktop build` na plataforma que vai distribuir. A pasta `dist/desktop-<plataforma>-<arquitetura>` contém o cliente portátil. Abra o executável Electron com `LOJA_SERVER_URL` apontando à origem da instalação. Também é possível gravar a origem no arquivo `server-url.txt` no diretório de dados do aplicativo. O cliente portátil usa `http://127.0.0.1:8080` como padrão.

No comprovante não fiscal, selecione papel de 58 ou 80 mm e confira a largura e as margens nas propriedades da impressora. Cada solicitação é registrada por loja, venda, operador e formato. Um retry da mesma solicitação usa a mesma chave. Em Produtos, selecione a variante para imprimir a etiqueta Code 128 do SKU. A conclusão do spool físico e a homologação de impressora, etiqueta e scanner exigem teste em hardware.

## Backup e teste de restauração

```bash
scripts/backup-lan.sh /caminho/loja-2026-11-18.gpg
scripts/restore-lan.sh /caminho/loja-2026-11-18.gpg loja_restore_teste
```

O dump inclui todas as tabelas, fotos, miniaturas, vendas e auditoria. O backup é cifrado com AES-256 via GnuPG. A restauração usa um banco novo com nome `loja_restore_*`, uma transação de restauração e uma leitura das tabelas principais. A senha é solicitada pelo GnuPG. Para execução agendada, defina `LOJA_BACKUP_PASSPHRASE_FILE` com caminho absoluto para um arquivo protegido. Guarde cópias em mídia separada, mantenha a senha em local diferente e valide a recuperação periodicamente antes de descartar versões antigas.

## Usar gestão e vitrine

- Em **Gestão**, o gerente confere vendas e devoluções por dia e cadastra fornecedores. O resumo usa o fuso da loja e apresenta valor bruto e devoluções separadamente. O cadastro ainda não gera pedidos de compra.
- Em **Produtos**, selecione uma variante e clique em **Publicar na vitrine**. Cada variante é privada até que seja publicada. A página pública exibe a foto, o preço atual e a disponibilidade, sem revelar quantidades.
- Em **Produtos**, **Reservar estoque** separa unidades para atendimento interno. Em **Gestão**, **Liberar reserva** devolve as unidades ao saldo disponível. A reserva permanece ativa até a liberação manual. O PDV continua consultando o mesmo estoque.

- Em **Gestão**, o gerente localiza a venda pelo número e registra a devolução integral de compras pagas somente em dinheiro. As peças voltam ao estoque apto à venda e o valor sai do caixa aberto. Confira as peças, confirme o registro e entregue o valor exibido.
- Em **Gestão**, habilite **Pedidos para retirada** se a loja oferecer retirada presencial. A vitrine aceita até 10 variantes, com até 10 unidades por variante, e gera um código válido por 48 horas. A solicitação não coleta identificação nem separa o estoque. O operador abre o pedido pelo código no PDV, revisa a cotação e confirma o pagamento recebido na loja. A baixa de estoque, a venda e o vínculo com o pedido ocorrem na mesma transação.

| Marco | Entregue | Pendente para encerrar |
|---|---|---|
| M4 | Instalação guiada no terminal, Web em LAN, PWA em origem segura, cliente portátil, recibo auditado, etiqueta e scripts de recuperação | Installer nativo, spooler, PIN/dispositivos, homologação PWA em aparelhos e WAN-off/LAN-off, testes em impressoras/scanners e procedimentos de retenção automática |
| M5 | Fornecedores, resumo de vendas e devolução integral em dinheiro | Trocas, devoluções parciais ou de pagamentos externos, crediário, contas e DRE, fluxo de compras, contagem colaborativa, comissões, CRM/LGPD e importação |
| M6 | Vitrine pública opt-in, reservas internas e pedido para retirada pago no caixa | Provador, pré-vendas, pagamento online e entregas, logística, gift cards, kits, campanhas e serviços |

## Fila, compras e acompanhamento da retirada

- **M4.** Em Gestão, abra um comprovante pendente na fila central, imprima no terminal escolhido e confirme a saída do papel. A confirmação registra usuário e horário. A fila exige confirmação manual.
- **M5.** Em Gestão, crie um pedido de compra com fornecedor, SKU, quantidade e custo unitário. O recebimento integral atualiza o estoque canônico em uma transação e grava a entrada no histórico. A mesma solicitação pode ser repetida sem duplicar saldo. Cada pedido contém um SKU.
- **M6.** A equipe pode consultar e cancelar pedidos de retirada pendentes em Gestão. Clientes acompanham a situação pelo código na vitrine. O cancelamento bloqueia a finalização no caixa. A consulta pública mostra somente o estado do pedido.

A homologação em hardware continua aberta. Compras com múltiplos itens e recebimento parcial, contas e DRE, trocas, CRM, provador, pagamentos online e entrega permanecem no roadmap.
