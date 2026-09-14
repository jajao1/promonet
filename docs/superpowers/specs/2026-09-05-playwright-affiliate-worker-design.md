# Worker Playwright para links de afiliado

## Objetivo

Criar um protótipo supervisionado que utilize o Gerador de Links oficial do Mercado Livre por meio de um Chromium controlado pelo Playwright. A primeira etapa valida geração, sessão persistente e intervenção humana, sem publicar mensagens no WhatsApp.

## Limites e premissas

- Não existe API pública documentada para criação de links de afiliado.
- A automação da interface não equivale a uma integração oficial e pode deixar de funcionar quando o portal mudar.
- A operação ficará supervisionada enquanto não houver confirmação do suporte de que a automação assistida é permitida.
- Não serão contornados QR, CAPTCHA, verificação de identidade, limites técnicos ou controles antifraude.
- `DRY_RUN=true` continuará obrigatório nesta fase.
- Somente páginas específicas de produtos elegíveis serão aceitas.
- A divulgação futura dependerá de o grupo, comunidade ou canal ser público e declarado conforme as regras do programa.

## Arquitetura

O worker será um processo Node.js executado diretamente no Windows, separado dos containers. Ele usará Playwright com Chromium visível e um perfil persistente exclusivo em `secrets/playwright-profile/`. Esse diretório será ignorado pelo Git e nunca será montado no container do bot.

O PostgreSQL existente continuará responsável pela fila. O worker reservará no máximo uma conversão por vez e registrará o resultado sem expor dados da sessão. A integração com o pipeline atual permanecerá desativada até a conclusão dos testes supervisionados.

## Componentes

### Perfil persistente

O Chromium será iniciado por `launchPersistentContext` usando somente o perfil dedicado. Na primeira execução, o navegador abrirá a página oficial e aguardará o usuário concluir manualmente o login e a leitura do QR. O worker detectará a página autenticada, mas não observará nem armazenará senha ou conteúdo do QR fora do perfil do navegador.

Se a autenticação expirar, o worker pausará. Uma nova janela visível permitirá que o usuário refaça o procedimento manualmente.

### Fila de conversão

Cada solicitação conterá:

- URL original do produto;
- etiqueta autorizada;
- identificador idempotente;
- estado da solicitação;
- número de tentativas;
- diagnóstico sanitizado da última falha.

Os estados serão `queued`, `processing`, `awaiting_confirmation`, `confirmed`, `review` e `blocked_auth`. Uma solicitação em estado incerto nunca será reenviada automaticamente.

### Validação de entrada e saída

A entrada aceitará somente HTTPS e hosts oficiais do Mercado Livre. Links curtos serão resolvidos com limite de redirecionamentos e deverão terminar em uma página específica de produto. Busca, categoria, página inicial, carrinho, conta, vendedor e outras páginas não elegíveis serão rejeitadas.

O resultado será aceito apenas quando tiver sido apresentado pela interface oficial, usar um host aprovado pelo validador e não for igual à URL original. A resposta será associada à URL canônica e à etiqueta solicitada.

### Automação da interface

O worker navegará até o Gerador de Links oficial, localizará controles por papel, rótulo ou texto acessível e preencherá uma solicitação por vez. Não fará chamadas fabricadas ao endpoint interno nem exportará cookies ou tokens.

Seletores específicos ficarão isolados em um adaptador de página. Mudanças de interface afetarão esse adaptador sem alterar fila, validação ou armazenamento.

### Confirmação humana

As primeiras 20 conversões sempre entrarão em `awaiting_confirmation`. O terminal exibirá somente o identificador, a URL canônica e o link gerado. O usuário poderá confirmar ou rejeitar. Somente uma confirmação move a solicitação para `confirmed`.

Depois das 20 conversões, a remoção da confirmação exigirá uma decisão separada e nova validação; não será automática nesta implementação.

### Cache e idempotência

O cache utilizará a chave `URL canônica + etiqueta`. Uma conversão já confirmada será reutilizada sem reabrir o portal. O identificador de origem impedirá que a mesma mensagem produza solicitações duplicadas.

## Fluxo

1. O bot ou comando de teste insere uma URL elegível na fila.
2. O worker reserva uma solicitação.
3. O cache é consultado.
4. Sem cache, o worker confirma que a sessão está autenticada.
5. O Gerador de Links é preenchido pela interface visível.
6. O link apresentado é validado e gravado como `awaiting_confirmation`.
7. O usuário confirma ou rejeita no terminal.
8. Uma confirmação grava o cache e marca a solicitação como `confirmed`.
9. Nesta fase, nenhuma mensagem é enviada ao WhatsApp.

## Falhas e pausas

- Login ou QR: estado `blocked_auth` e espera por ação humana.
- CAPTCHA ou desafio: pausa imediata, sem tentativas de resolução automática.
- Controle da página ausente: estado `review` com categoria `ui_changed`.
- Produto inelegível: estado `review` com categoria `ineligible_url`.
- Resultado inválido: estado `review` com categoria `invalid_affiliate_result`.
- Falha transitória: no máximo uma repetição automática.
- Três falhas consecutivas do worker: circuit breaker; nenhuma nova reserva até reinício supervisionado.
- Encerramento durante processamento: solicitação volta para revisão, nunca para reenvio automático.

## Segurança

- `secrets/playwright-profile/` será excluído do Git, backups públicos e logs.
- O navegador pessoal usado pelo worker não será o perfil pessoal do usuário.
- Senhas, cookies, QR, armazenamento local e cabeçalhos autenticados não serão registrados.
- Capturas de tela só serão feitas em falhas de interface e deverão mascarar cabeçalhos, menus de conta e dados pessoais; por padrão, ficarão desativadas.
- Não haverá proxy rotativo, alteração de fingerprint, CAPTCHA solver ou mecanismo de evasão.
- Logs usarão categorias fixas e identificadores internos.

## Testes

- Testes unitários do validador de URLs de entrada e saída.
- Testes da máquina de estados e idempotência da fila.
- Testes do cache por URL canônica e etiqueta.
- Testes do circuit breaker e limites de repetição.
- Testes do adaptador contra uma página HTML local controlada, sem acessar o Mercado Livre.
- Teste manual do primeiro login com QR.
- Uma conversão real supervisionada usando um produto conhecido.
- Confirmação de que nenhum cookie ou segredo aparece nos logs.
- Confirmação de que WhatsApp não recebe mensagem e `DRY_RUN=true` permanece ativo.

## Critérios de conclusão

O protótipo estará concluído quando:

- abrir o Chromium com perfil dedicado;
- preservar a sessão após fechar e reabrir o worker;
- pausar corretamente quando exigir QR ou login;
- gerar um link por meio da interface oficial;
- validar o link e exigir confirmação humana;
- reutilizar uma conversão confirmada pelo cache;
- interromper diante de CAPTCHA ou mudança de interface;
- passar em todos os testes automatizados;
- não expor credenciais nem enviar mensagens ao WhatsApp.

## Fora do escopo

- Operação autônoma em escala.
- Envio automático ao grupo.
- Scraping de catálogo, preços ou métricas.
- Uso direto do endpoint web interno.
- Integração com Amazon ou Shopee.
- Execução headless antes da validação da fase supervisionada.
