# Instalação LAN, gestão e vitrine

Esta entrega parcial cobre a operação LAN self-hosted, impressão pelo navegador, backup cifrado, cadastro de fornecedores, vendas confirmadas por dia, vitrine e reservas internas.

## Instalar e diagnosticar

No servidor Linux, prepare Docker Engine com Compose v2, Bash, OpenSSL e curl. Para backup, instale também GnuPG. A primeira montagem precisa baixar as imagens e dependências open source. O servidor de banco fica na rede interna do Compose e a interface usa a mesma origem para Web e API.

```bash
bash scripts/install-lan.sh
```

O assistente pede IP de escuta, porta, nome da loja e credenciais iniciais. O padrão é `127.0.0.1:8080`. Para abrir nos terminais em uma LAN confiável, informe o IP fixo do servidor na interface da rede local. Em cada terminal, abra `http://IP_DO_SERVIDOR:8080`. Para redes compartilhadas ou acesso externo, configure HTTPS com certificado confiável e restrinja o acesso administrativo no proxy ou na VPN. Servir a vitrine externamente exige uma configuração própria para rotear apenas a página, seus assets e a API pública de leitura.

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

- Em **Gestão**, o gerente confere vendas confirmadas por dia e cadastra fornecedores. O resumo usa o fuso da loja e apresenta valor bruto. O cadastro ainda não gera pedidos de compra.
- Em **Produtos**, selecione uma variante e clique em **Publicar na vitrine**. Cada variante é privada até que seja publicada. A página pública exibe o preço atual e a disponibilidade, sem revelar quantidades.
- Em **Produtos**, **Reservar estoque** separa unidades para atendimento interno. Em **Gestão**, **Liberar reserva** devolve as unidades ao saldo disponível. A reserva permanece ativa até a liberação manual. O PDV continua consultando o mesmo estoque.

| Marco | Entregue | Pendente para encerrar |
|---|---|---|
| M4 | Instalação guiada no terminal, Web em LAN, cliente portátil, recibo auditado, etiqueta e scripts de recuperação | Installer nativo, spooler, PIN/dispositivos, PWA instalável, homologação WAN-off/LAN-off, testes em impressoras/scanners e procedimentos de retenção automática |
| M5 | Fornecedores e vendas confirmadas por dia | Trocas, devoluções, crediário, contas e DRE, fluxo de compras, contagem colaborativa, comissões, CRM/LGPD e importação |
| M6 | Vitrine pública opt-in e reservas internas transacionais | Provador, pré-vendas, pedidos/checkout, retirada/entrega, logística, gift cards, kits, campanhas e serviços |
