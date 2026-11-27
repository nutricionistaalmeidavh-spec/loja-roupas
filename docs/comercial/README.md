# Edição comercial — venda no Mercado Livre

A edição comercial é a mesma edição física (banco local, caixa sem internet) com **ativação obrigatória**, instalador, pasta de instalação, pasta de dados (`%APPDATA%\loja-roupas-comercial`) e canal de atualização próprios. Ela não substitui nem é substituída pela edição física livre.

## Como gerar o instalador
1. GitHub → Actions → **Loja Comercial - instalador com ativação (Windows)** → *Run workflow* com a versão (ex.: `1.0.0`).
2. Sem marcar **publish**, baixe o artefato `loja-comercial-vX.Y.Z-windows` (instalador + `SHA256SUMS`). Marcando **publish** (somente na `main`), o workflow cria a release `loja-comercial-vX.Y.Z` com instalador, `SHA256SUMS` e `Manual-Loja-de-Roupas.pdf`.
3. O workflow testa: marcadores da edição, instalação silenciosa, atalhos, tela de ativação obrigatória antes de criar a loja e desinstalação.

## Liberação e e-mail automático
Na Central ArtiSys (`/admin` do Worker `pdv-artisys`), escolha o produto **Loja Roupas**, informe o e-mail do comprador e clique em **Gerar código**. A Central envia automaticamente, pelo relay `oficina-mail.artisys.dev`, o código de ativação, o download direto (`/download/loja-roupas`), o manual em PDF (`/manual/loja-roupas.pdf`) e o link destes documentos. As rotas apontam sempre para a release `loja-comercial-v*` mais nova; sem ela respondem 503.

O manual é gerado de `docs/comercial/manual/manual.html` com `node scripts/build-manual-pdf.mjs`.

## Atualizações
O programa instalado procura releases com tag `loja-comercial-vX.Y.Z` contendo `Loja-de-Roupas-Comercial-Setup-x64.exe` e `SHA256SUMS`. Releases `loja-fisica-*` nunca são oferecidas à edição comercial. Se o repositório ficar privado, o atualizador deixa de enxergar as releases e é preciso hospedar o canal comercial em outro lugar.

## Ativação
- Central: `https://pdv-artisys.sistema-artisys.workers.dev` (`/v1/activation/verify` e `/v1/license/status`, produto `LOJA_ROUPAS`). A central fica fora deste repositório.
- Funciona offline depois de ativada, mas exige uma verificação online a cada **30 dias**. Sem ela o programa pede internet antes de abrir; nenhum dado é apagado.
- Revogação explícita na central desativa a instalação na próxima verificação.

## Assinatura digital (Authenticode)
Sem certificado, o Windows SmartScreen mostra "editor desconhecido". Para assinar:
1. Compre um certificado de assinatura de código (OV ou EV) em nome da empresa.
2. Em *Settings → Secrets and variables → Actions*, crie `WINDOWS_SIGN_PFX_BASE64` (o .pfx em Base64) e `WINDOWS_SIGN_PASSWORD`.
3. O workflow passa a assinar `electron.exe` e o instalador automaticamente. Sem os segredos, gera o instalador sem assinatura.

## Documentos para o comprador
- [Manual de instalação e ativação](manual-instalacao.md)
- [Texto-base do anúncio](anuncio-mercado-livre.md)

## Antes da primeira venda (não resolvível só com código)
- [ ] Decidir licença do código (AGPLv3 atual) e visibilidade do repositório.
- [ ] Confirmar que a central de licenças está no ar e cadastrar o fluxo de emissão de códigos após cada venda.
- [ ] Testar em um Windows real: instalação, ativação, impressora de cupom 58/80 mm, leitor de código de barras, backup e restauração.
- [ ] Comprar e configurar o certificado de assinatura.
