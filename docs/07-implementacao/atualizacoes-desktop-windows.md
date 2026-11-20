# Atualizações assistidas do instalador Windows — P0/P1

## Escopo e consentimento

- O cliente **Windows x64 instalado pelo NSIS** consulta apenas os **metadados JSON** de \`https://api.github.com/repos/nutricionistaalmeidavh-spec/loja-roupas/releases/latest\` ao abrir o aplicativo. Uma falha de rede não bloqueia operações locais.
- Havendo versão estável mais nova com os dois arquivos exigidos, mostra um **jetlog modal** no início, inclusive antes do login. **Agora não** fecha a janela e não baixa nada.
- **Configurações → Atualizações** mostra a versão instalada imediatamente, permite **Verificar atualizações agora** e apresenta novidades e disponibilidade.
- O **instalador EXE não é baixado em segundo plano**. Só o botão **Baixar e instalar** seguido de uma **confirmação nativa** autoriza a requisição de download. O progresso aparece na interface. Não há consulta contínua nem instalação forçada.
- O usuário pode continuar vendendo sem internet; a consulta ao GitHub é opcional. Não há mensalidade, serviço de atualização contratado ou dependência de nuvem para o funcionamento da loja.

## Publicação de uma versão oficial (manual)

A CI M8 cria **candidatos**, sem publicar Release. Não iniciar publicação nem merge sem autorização do responsável.

1. Atualize \`apps/desktop/package.json\` para a versão \`X.Y.Z\`, compile e execute os testes do instalador Windows real.
2. Depois da autorização de publicação, crie a tag \`vX.Y.Z\` e uma **GitHub Release estável** (não \`draft\` e não \`prerelease\`) no próprio repositório.
3. Anexe os **dois arquivos da mesma compilação**: \`Loja-de-Roupas-Setup-x64.exe\` e \`SHA256SUMS\`. O arquivo SHA256SUMS deve incluir exatamente uma linha no formato \`<64 dígitos hex>  Loja-de-Roupas-Setup-x64.exe\`. A CI M8 já calcula esse hash.
4. Escreva as mudanças na descrição da Release. O programa exibe o texto sem interpretá-lo como HTML.
5. Não publicar se a versão embutida no pacote não corresponder à tag ou se o SHA-256 não conferir.

A atualização só é oferecida se \`X.Y.Z\` for **estritamente maior** que a versão instalada. Sem release oficial/arquivo de checksum, não aparece aviso.

## Aplicação com proteção de dados

1. O usuário confirma; o app consulta novamente a Release oficial.
2. Recebe o manifesto SHA256 e baixa o EXE **apenas nesse momento**, em arquivo temporário; rejeita tamanho divergente, arquivo vazio e checksum incorreto. Arquivos parciais são apagados; o EXE só recebe nome final após validação.
3. No computador com servidor local, executa \`pg_dump\` no PostgreSQL incluído no pacote; verifica arquivo não vazio, grava checksum e mantém o backup em **userData/backups/before-update**, fora do diretório do aplicativo. Falha de backup **impede instalar**. Em terminal que se conecta à loja por rede, não há banco local a copiar; o backup do servidor principal deve seguir a política de proteção do servidor.
4. Copia o assistente de atualização para **userData/updates**, fora da instalação, e inicia o PowerShell integrado ao Windows; o aplicativo fecha primeiro (incluindo API e PostgreSQL). O assistente aguarda o processo terminar antes de mexer nos arquivos.
5. Com o aplicativo fechado, confirma de novo o SHA-256, faz um **snapshot dos arquivos da versão anterior** em **userData/updates/rollback-***, então roda o instalador oficial. O banco de dados continua no diretório do usuário e não é removido.
6. Se o instalador falhar ou faltar um executável essencial, tenta restaurar o snapshot anterior e registra o resultado em **userData/updates/last-result.json**. Caso conclua, reinicia o aplicativo.
7. Não reverte automaticamente migrações do banco. A recuperação de um esquema antigo exige verificação de compatibilidade e restauração consciente do dump, preferencialmente num ambiente isolado. **Nunca** apagar dados locais para fazer downgrade.

## Testes e limitações

- Testes do desktop: seleção de versões, GitHub somente metadados, SHA duplicado/inexistente, tamanho, hash incorreto, escrita atômica do EXE.
- Teste Playwright: abertura do jetlog antes do login, recusa sem download e opção de verificar/instalar em Configurações.
- Testes CI: Linux/Windows M8, instalação/desinstalação real e operação inicial, API e LAN.
- O teste da atualização **real entre duas releases distintas** depende de duas versões oficiais disponíveis; não é substituído pelo teste de instalação limpa. Também não se considera um restore automático do banco seguro entre versões incompatíveis.
- O Linux e acesso web/PWA não executam instaladores Windows; a atualização do servidor nesses ambientes segue o fluxo de implantação do host.
