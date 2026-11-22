# Loja Física — execução P0/P1 na PR #41

**Estado:** PR #41 incorporada à main; edição física v0.2.3 publicada como pré-release em 22/11/2026. Documentação histórica dos incrementos dessa PR. Núcleo **R$ 0, self-hosted, AGPL-3.0-or-later**; sem OSV-Scanner ou SaaS obrigatório.

## Funcionalidades implementadas nesta PR
- Edição `physical` controlada no servidor: vitrine, retirada e integrações marketplace indisponíveis; não apenas botões ocultos.
- Desktop preparado para `LOJA_PHYSICAL_EDITION=true`. Sem segundo PostgreSQL e sem conta online para operar o núcleo.
- Backup `pg_dump -Fc` por diálogo nativo, SHA-256, escrita temporária e recusa de sobreposição.
- Restauração **de teste** de dump PostgreSQL em banco novo, com checagem de vendas, fotos e migrações; banco temporário descartado.
- Impressão nativa por impressora instalada, selecionada pelo usuário, mantendo fallback do Windows.
- P1: despesas, resultado operacional gerencial **parcial**, clientes locais com consentimento explícito/anonimização.
- P1: inventário físico por SKU, recontagem e reconciliação atômica contra saldo canônico, com bloqueio em caso de alterações concorrentes.
- Testes unitários e CI existente, mais Gitleaks e k6 OSS para verificar segurança/carga. Nenhum serviço pago para executar caixa.

## Limitações e pendências
- Impressoras e scanners físicos (incluindo 58/80 mm) exigem teste em hardware.
- A restauração em **produção** não é automatizada: o teste isolado não substitui plano de recuperação guiado.
- Backups externos automatizados com retenção e criptografia ainda exigem planejamento; exportação manual já existe.
- Gestão de dispositivos e PIN de troca de operador ainda pendentes.
- P1 integral ainda exige trocas, reembolsos Pix/cartão comprovados, crediário, contas contábeis/DRE completa, comissões por vendedor, gestão avançada de clientes, compras e inventário colaborativos mais profundos.
- Emissão de NF-e/NFC-e permanece fora do produto. O comprovante é **não fiscal**.
- CI verde não equivale a aceitação operacional em loja real.

## Construção comercial
O pacote físico depende do marcador `physical-edition.json` criado por `LOJA_PHYSICAL_EDITION=true` durante o empacotamento Electron. O mesmo PostgreSQL local permanece canônico. O software livre não exige licença comercial para operar; serviços pagos só por contratação explícita.

## Critérios de merge
Verificar typecheck, testes, migrações, Playwright, Electron, backup/teste de restauração, scanner/impressoras reais e segurança LGPD. **Merge e release somente após autorização separada do proprietário.**

## Empacotamento físico separado (v0.2.3)
O instalador `Loja-de-Roupas-Fisica-Setup-x64.exe` utiliza `%LOCALAPPDATA%\\Programs\\Loja de Roupas Fisica`; o banco e as configurações usam `%APPDATA%\\loja-roupas-fisica`, sem substituir os arquivos da edição completa. O NSIS tem registro/desinstalador próprios. A release `loja-fisica-v0.2.3` foi publicada como pré-release, preservando o canal estável da edição completa.

## Continuidade — P1 e segurança na PR #42
A [PR #42](https://github.com/nutricionistaalmeidavh-spec/loja-roupas/pull/42) reúne operações de gestão, crediário, trocas, estornos externos, contas e DRE gerencial, comissões, pontos, contagem colaborativa, PIN, backup LAN cifrado e atualização Windows da edição física. Encontra-se em desenvolvimento, não integrada e não lançada; exige CI, homologação financeira e revisão de migrações antes de liberar ao cliente.
