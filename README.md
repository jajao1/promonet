# PromoMega — bot de ofertas em Docker

Captura ofertas de grupos WhatsApp autorizados via Evolution API, converte links Mercado Livre e republica texto ou imagem com legenda em destinos configurados. **O site está suspenso.**

## Serviços

| Serviço | Função | Acesso local padrão |
|---|---|---|
| bot | Webhook, filtros, fila, conversão e envio | http://localhost:3000/health |
| evolution | Conexão WhatsApp e API de mensagens (v2.3.7 estável) | http://localhost:8080 |
| postgres | Fila persistente e dados Evolution em schemas distintos | Somente rede Docker |
| redis | Cache da Evolution | Somente rede Docker |

## Site público de ofertas

O mesmo serviço `bot` publica a vitrine em `http://localhost:${BOT_PORT}` (porta `3001` no ambiente atual). O site lista apenas promoções confirmadas na tabela de publicações e nunca expõe o link de afiliado diretamente na API.

- `GET /api/offers?q=&category=&sort=recent|discount&page=&limit=` lista ofertas publicadas; `limit` é limitado a 48.
- `GET /api/categories` lista somente nichos que possuem ofertas disponíveis.
- `GET /oferta/:nicheId/:itemId` registra um clique anônimo e redireciona para a loja.

O clique armazena apenas a identificação da oferta, um identificador aleatório da requisição e, quando válido, o domínio de referência. IP, agente do navegador e fingerprint não são armazenados. A vitrine precisa ser publicada junto do backend em um host com acesso ao PostgreSQL; uma hospedagem puramente estática não consegue acessar o banco local.

Por padrão, `DRY_RUN=true` e `config/routes.json` está vazio. Nenhuma mensagem é publicada nem chamada ao Mercado Livre é feita no modo simulado. Não há pareamento automático nem credenciais copiadas da conversa.

## 1. Preparar

Requisitos: Docker Desktop com containers Linux e Compose v2. Node 24 é necessário apenas para testes fora do container.

```powershell
Copy-Item .env.example .env
```

Edite `.env` e substitua `POSTGRES_PASSWORD`, `EVOLUTION_API_KEY` e `WEBHOOK_SECRET` por valores aleatórios distintos de pelo menos 32 caracteres. Use apenas letras e números na senha do PostgreSQL para não quebrar a URI. Os valores de exemplo são públicos e servem somente para teste local.

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

O primeiro início da Evolution pode demorar devido às migrações de banco. Os dados sobrevivem a reinícios em volumes nomeados. Não execute `docker compose down -v` se quiser preservá-los.

## 2. Parear o número exclusivo

No cliente HTTP de sua preferência, faça `POST http://localhost:8080/instance/create` com cabeçalho `apikey` igual a `EVOLUTION_API_KEY` e JSON:

```json
{
  "instanceName": "promonet",
  "integration": "WHATSAPP-BAILEYS",
  "qrcode": true,
  "groupsIgnore": false,
  "readMessages": false,
  "syncFullHistory": false
}
```

Consulte `GET /instance/connect/promonet` se precisar de um novo QR. Escaneie o QR nos dispositivos vinculados do WhatsApp. O número deve participar dos grupos de origem autorizados e ter permissão para publicar nos destinos. O pacote pode ser testado sem pareamento; essa etapa depende do seu número.

Os scripts locais automatizam esse fluxo sem mostrar as chaves:

```powershell
.\scripts\create-instance.ps1
.\scripts\configure-after-pairing.ps1
.\scripts\list-groups.ps1
```

O primeiro gera `pairing-qr.png`; o segundo confirma a conexão, registra o webhook e apaga o QR; o terceiro lista somente nome, identificador e tamanho dos grupos visíveis para a instância.

## 3. Configurar o webhook

Faça `POST http://localhost:8080/webhook/set/promonet`, com o cabeçalho `apikey`, e o corpo abaixo, trocando o valor de `x-webhook-secret` pelo segredo do `.env`:

```json
{
  "webhook": {
    "enabled": true,
    "url": "http://bot:3000/webhooks/evolution",
    "byEvents": false,
    "base64": false,
    "headers": { "x-webhook-secret": "valor-do-WEBHOOK_SECRET" },
    "events": ["MESSAGES_UPSERT"]
  }
}
```

Não coloque credenciais na URL. Use o hostname interno `bot`, não `localhost`: a chamada parte do container Evolution. Evite eventos de histórico e sincronização em massa.

## 4. Selecionar origens, destinos e tags

Liste grupos usando `GET /group/fetchAllGroups/promonet?getParticipants=false` na Evolution, com `apikey`. Configure `config/routes.json` com os IDs reais:

```json
{
  "routes": [
    {
      "sourceGroup": "120363000000001@g.us",
      "destinationGroup": "120363000000002@g.us",
      "tag": "whats-tech",
      "createTag": false
    }
  ]
}
```

Os IDs acima são ilustrativos, não grupos reais. Cada rota relaciona uma origem a um destino; configure outras rotas para Casa e Moda/Beleza. Um destino não pode ser também origem. Reinicie o bot após mudar a configuração: `docker compose restart bot`.

Prefira tags já existentes e confirmadas no painel de afiliados (`createTag:false`). Para uma tag nova, `createTag:true` habilita a tentativa de criação e reutilização persistente. O contrato de resposta desse endpoint interno ainda precisa ser validado: uma resposta sem confirmação reconhecível deixa a oferta retida. Não crie uma tag por produto.

## 5. Configurar a sessão Mercado Livre

Crie localmente `secrets/meli-session.json`:

```json
{
  "cookie": "cookies da sua sessão autorizada em formato de cabeçalho Cookie",
  "csrfToken": "valor atual do cabeçalho x-csrf-token"
}
```

O arquivo só é necessário para modo real. Ele é montado somente para leitura, não entra na imagem e é ignorado pelo Git. Restrinja o acesso à pasta `secrets` na máquina. O `.env` e os volumes também contêm dados sensíveis: proteja-os e seus backups.

Se você exportou uma requisição PowerShell do gerador de links, pode importar os cookies e o token sem exibi-los:

```powershell
.\scripts\import-meli-session.ps1 -RequestPath 'C:\caminho\da\requisicao.txt'
```

**Não publique cookies, tokens, QR ou arquivos de sessão.** Os endpoints `createLink` e `createTag` são internos do site, não um contrato público de API. Podem mudar ou exigir login novamente. O bot não contorna CAPTCHA nem renova sua sessão automaticamente. Substitua o arquivo quando a sessão expirar.

## 6. Ativar a publicação automática

Antes de ativar, confirme as autorizações, IDs dos grupos, tag e sessão. Teste primeiro com grupos privados controlados por você.

1. Deixe `DRY_RUN=true` durante o teste do webhook e dos filtros.
2. Confira os estados dos trabalhos no banco e os logs sanitizados.
3. Configure `DRY_RUN=false` no `.env`.
4. Execute `docker compose up -d bot`.
5. Publique uma nova oferta de teste no grupo de origem e confira o destino e a atribuição no painel Mercado Livre.

O modo de entrada é registrado na fila: trabalhos recebidos em simulação não viram envios reais após a ativação. Trabalhos antigos sem essa informação ficam retidos. Rotas e tags são revalidadas antes do processamento, portanto remover ou alterar a rota invalida o trabalho pendente correspondente. Use uma mensagem nova ao ativar o modo real. Para pausar, volte a `DRY_RUN=true` e recrie o bot ou execute `docker compose stop bot`.

## Comportamento e limites

- Processa apenas eventos novos de grupos cadastrados; ignora mensagens próprias e evita ciclos.
- Mantém fila persistente, deduplicação e estados de processamento.
- Troca links somente se todas as conversões forem bem-sucedidas. Não publica links originais em caso de falha.
- Preserva a legenda e as imagens autorizadas; não remove atribuições ou marcas-d'água.
- Falhas ficam retidas; envio de resultado incerto não é repetido cegamente para evitar duplicação.
- Não verifica automaticamente preço, estoque, cupom, legitimidade da oferta ou comissão efetivamente atribuída. Conteúdo replicado não equivale a oferta validada.
- Não inclui Amazon, Shopee, vídeos, áudios, painel web ou reprocessamento automático de falhas.
- A conexão `WHATSAPP-BAILEYS` não é a API oficial da Meta. Há risco de desconexão e bloqueio, mesmo com autorização dos administradores.
- Banco/cache não têm portas públicas. Para acesso remoto à API, use VPN ou proxy TLS autenticado; não remova o vínculo `127.0.0.1` indiscriminadamente.

## Verificação e operação

```powershell
npm ci
npm test
docker compose config --quiet
docker compose build bot
docker compose ps
docker compose logs --tail 50 bot
docker compose restart bot
docker compose stop
```

`GET /health` verifica o serviço. Não envie logs ou dumps de banco a terceiros sem revisar dados. Estabeleça retenção e expurgo periódico dos registros de ofertas: eles podem conter texto e metadados das mensagens autorizadas.

Para consultar resultados sem exibir o conteúdo das mensagens:

```powershell
docker compose exec -T postgres psql -U promonet -d promonet -c "SELECT status,count(*) FROM promonet.jobs GROUP BY status;"
docker compose exec -T postgres psql -U promonet -d promonet -c "SELECT id,status,created_at FROM promonet.jobs WHERE status='review' ORDER BY id DESC LIMIT 20;"
```

Estados: `queued` (fila), `processing` (conversão), `sending` (envio iniciado), `sent` (API confirmou recebimento do envio, não entrega ao destinatário), `simulated` e `review` (intervenção necessária). O contador `accepted` no webhook indica candidatos a enfileiramento; um evento duplicado pode retornar `accepted:1`, mas o banco não cria outra tarefa.

Não altere manualmente `sending`/`review` para `queued` sem conferir se a oferta já foi publicada. A sessão é carregada ao iniciar: após atualizá-la, reinicie o bot. No início, payloads com mais de sete dias são limpos e registros com mais de trinta dias são removidos; tarefas concluídas limpam o payload imediatamente. Em execução contínua, programe manutenção periódica conforme sua necessidade de retenção.

### Teste isolado sem WhatsApp

O arquivo `tests/compose.smoke.yaml` monta grupos fictícios e força simulação. Use um projeto separado do ambiente real:

```powershell
$env:BOT_PORT='13000'
$env:EVOLUTION_PORT='18080'
docker compose --env-file .env.example -p promonet-check -f compose.yaml -f tests/compose.smoke.yaml up -d --build
Invoke-RestMethod http://localhost:13000/health
node --test tests/smoke.test.mjs
docker compose --env-file .env.example -p promonet-check -f compose.yaml -f tests/compose.smoke.yaml down
Remove-Item Env:BOT_PORT
Remove-Item Env:EVOLUTION_PORT
```

Essa verificação não demonstra publicação real ou atribuição de comissões. Os volumes de teste permanecem para inspeção após `down`.

## Referências verificadas

- [Releases da Evolution API](https://github.com/evolution-foundation/evolution-api/releases)
- [Compose oficial 2.3.2](https://github.com/evolution-foundation/evolution-api/blob/2.3.2/docker-compose.yaml)
- [Variáveis da Evolution 2.3.2](https://github.com/evolution-foundation/evolution-api/blob/2.3.2/.env.example)
- [Webhooks](https://docs.evolutionfoundation.com.br/evolution-api/configuration/webhooks)
# OAuth do Mercado Livre com túnel temporário

O bot permanece com `DRY_RUN=true` durante esta validação. Cookies de navegador não são usados como fallback.

1. Inicie os containers com `docker compose up -d --build`.
2. Execute `.\scripts\start-meli-oauth-tunnel.ps1`.
3. Copie a URI completa exibida e cadastre-a como URI de redirect na aplicação do Mercado Livre.
4. No `.env`, defina `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI` com a mesma URI e `MELI_OAUTH_ENABLED=true`.
5. Recrie apenas o bot com `docker compose up -d --build --force-recreate bot`.
6. Abra `http://127.0.0.1:3000/oauth/mercadolivre/start` e autorize a aplicação.
7. Confirme somente a existência do arquivo com `Test-Path .\secrets\meli-oauth.json`; não exiba seu conteúdo.
8. Valide a conta com `docker compose exec -T bot node scripts/check-meli-oauth.mjs`.

O Quick Tunnel muda de endereço quando reinicia. Se isso acontecer antes de uma nova autorização, atualize tanto a URI cadastrada no Mercado Livre quanto `MELI_REDIRECT_URI`. A renovação normal do token não depende de o túnel continuar ativo.

## Protótipo supervisionado com Playwright

Este fluxo usa um perfil Chromium exclusivo e não envia mensagens ao WhatsApp.

1. Instale o navegador com `.\scripts\install-playwright.ps1`.
2. Inicie a infraestrutura com `docker compose up -d postgres`.
3. Enfileire um produto com `node worker/cli.mjs enqueue manual-1 URL_DO_PRODUTO`.
4. Execute `.\scripts\start-affiliate-worker.ps1`.
5. No Chromium visível, conclua manualmente o login ou a leitura do QR e volte ao terminal para pressionar Enter.
6. Confira o produto e o link `meli.la`; digite `s` somente se estiverem corretos.
7. Consulte o estado com `node worker/cli.mjs status`.

O perfil fica em `secrets/playwright-profile/`. Nunca copie cookies, QR, armazenamento do navegador ou essa pasta para o Git. CAPTCHA, nova autenticação ou mudança da página interrompem o fluxo para revisão humana. `DRY_RUN=true` é obrigatório durante o protótipo.
# Importação temporária da sessão do Mercado Livre

No Edge DevTools, copie apenas a requisição `createLink` como PowerShell e salve-a localmente em `secrets/meli-request.ps1.txt`. Não cole cookies no chat e não execute esse arquivo. Importe com:

```powershell
.\scripts\import-meli-session.ps1 -RequestPath .\secrets\meli-request.ps1.txt
```

O importador valida a URL, o método, a origem e o corpo, lê o texto sem executá-lo e grava `secrets/meli-session.json` de forma atômica. Para uma única validação controlada, mantenha `DRY_RUN=true` e execute:

```powershell
$env:DRY_RUN='true'
node .\scripts\test-meli-session.mjs --url 'URL_DO_PRODUTO' --tag 'SUA_TAG'
```

Redirecionamentos, HTTP 401 e HTTP 403 são classificados como `session_expired` e não são repetidos.

Antes de ativar o bot, inicie no Windows a ponte que usa a mesma pilha HTTP da requisição validada:

```powershell
.\scripts\start-meli-bridge.ps1
```

A ponte escuta somente em `127.0.0.1:3210`, gera uma chave local de 48 bytes em `secrets/meli-bridge-key.txt` e nunca executa o arquivo copiado do DevTools. Inicie a ponte antes de recriar o container do bot para que ele consiga montar a chave.

## Coletor oficial de ofertas

O coletor usa `/highlights/MLB/category/{categoria}` e os endpoints oficiais de produtos e itens. Configure as verticais e suas categorias folha em `config/niches.json`. Categorias raiz não possuem ranking consistente e são recusadas pela configuração. Por segurança, o coletor nasce desligado com `COLLECTOR_ENABLED=false`.

A configuração de produção percorre dez verticais a cada 20 minutos, alternando suas categorias folha. Cada rodada publica de zero a dez ofertas: no máximo uma por vertical e somente quando existe desconto real em um produto do ranking de mais vendidos. Alimentos não são configurados. Um item publicado fica bloqueado globalmente por sete dias, inclusive quando aparece em outra vertical. `COLLECTOR_SEND_DELAY_MS` serializa as mensagens e usa 15000 ms por padrão.

Valide todas as categorias contra a API oficial antes do deploy sem exibir o token no terminal:

```powershell
$secureToken = Read-Host "Token OAuth temporário" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $env:MELI_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  npm run verify:categories
} finally {
  Remove-Item Env:MELI_ACCESS_TOKEN -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}
```

Cada vertical registra um resultado seguro: `published`, `empty`, `unsupported_category`, `source_error`, `affiliate_error` ou `delivery_error`. Os registros informam vertical e categoria, mas nunca incluem cookies, tokens ou chaves. Quando a sessão usada para gerar links expira, o alerta administrativo continua sendo enviado pelo WhatsApp.

Para gerar uma prévia sem publicar, use `DRY_RUN=true`, `COLLECTOR_ENABLED=true` e recrie o bot. Consulte as prévias com:

```powershell
docker compose exec -T postgres psql -U promonet -d promonet -c "SELECT niche_id,item_id,title,price,original_price,state,created_at FROM promonet.offer_previews ORDER BY updated_at DESC LIMIT 10"
```

Somente depois de revisar a prévia altere `DRY_RUN=false`. Os grupos de destino precisam ser públicos e declarados na conta de afiliado. Toda mensagem gerada inclui a indicação `Publicidade`.
