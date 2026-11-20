# Instalação autônoma e tour de primeiro acesso

## Objetivo
Uma loja com um único computador usa o mesmo banco PostgreSQL, backend Fastify e interface React sem servidor externo, assinatura, Docker ou configuração por terminal. O instalador Windows x64 inclui os binários PostgreSQL, a API e o Web build. `%APPDATA%/loja-roupas` armazena banco e configuração local de usuário, fora da pasta removível do aplicativo.

O cliente adicional continua acessando a URL configurada do servidor LAN via `server-url.txt` ou `LOJA_SERVER_URL`. Não abrir o PostgreSQL na LAN; ele permanece restrito a localhost.

### Fluxos de aceitação
1. Instalar Windows sem admin, abrir o aplicativo sem Docker/PostgreSQL pré-instalado, inicializar banco e migrations.
2. Criar loja, login e senha no assistente local, entrar na interface, ver tour e percorrer módulos permitidos.
3. Fechar e reabrir preservando dados, sem reexecutar bootstrap; impedir segunda instância.
4. Simular porta ocupada, binários ausentes e corrupção: mostrar erro recuperável e **não sobrescrever** banco.
5. Atualizar e desinstalar sem apagar dados de `userData`; backup/restauração antes da distribuição comercial.
6. Configurar terminal adicional em LAN explicitamente sem duplicar dados.

O tour informa capacidades reais: pagamentos Pix/cartão são registros manuais após confirmação externa; nenhuma integração fiscal é presumida. É possível avançar, voltar, pular, concluir e reabrir por Ajuda; etapas se adaptam às permissões.

A homologação exige um Windows real de loja, impressoras/scanners físicos, backup/restauração, LAN desconectada da WAN, verificação de antivírus e avaliação de segurança. CI verde não substitui homologação.
