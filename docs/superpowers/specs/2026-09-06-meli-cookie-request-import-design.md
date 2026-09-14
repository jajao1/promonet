# Importação segura de requisição do portal de afiliados

## Objetivo

Criar um conector provisório que importe uma requisição recente copiada do DevTools do Edge, extraia apenas os dados mínimos da sessão web do Mercado Livre e permita conversões supervisionadas de links. O arquivo copiado será tratado como texto não confiável e nunca será executado.

## Contexto e limitações

O endpoint `POST /affiliate-program/api/v2/affiliates/createLink` é interno, não aparece na documentação pública e recusou o token OAuth oficial. Seu contrato, autenticação e controles podem mudar sem aviso. O uso automatizado pode contrariar os termos do Mercado Livre; esta integração será temporária, com baixo volume, confirmação humana e substituição futura por uma opção autorizada.

Não serão implementados mecanismos de evasão, repetição agressiva, proxy rotativo, falsificação de navegador, CAPTCHA solver ou recuperação clandestina de cookies.

## Arquivos sensíveis

- Entrada: `secrets/meli-request.ps1.txt`.
- Sessão normalizada: `secrets/meli-session.json`.
- Ambos serão excluídos do Git, da imagem Docker, dos logs e de qualquer diagnóstico exibido.
- O diretório `secrets/` continuará montado somente em tempo de execução.
- O arquivo bruto poderá ser removido somente após importação bem-sucedida, mediante opção explícita do operador.

## Importador

O importador lerá o arquivo como texto. Ele não invocará PowerShell, `Invoke-WebRequest`, `Invoke-RestMethod`, `curl`, `cmd`, `eval`, `Invoke-Expression` ou subprocessos.

Serão aceitos apenas arquivos contendo uma única requisição destinada exatamente a:

`https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink`

O método deverá ser `POST`. Redirecionamentos, variáveis externas, substituições de comando e destinos alternativos serão rejeitados.

Campos extraídos:

- cabeçalho `Cookie` ou coleção de cookies da sessão;
- cabeçalho `x-csrf-token`;
- `Origin`, que deverá ser `https://www.mercadolivre.com.br`;
- `Referer`, que deverá pertencer a `www.mercadolivre.com.br` e ao portal de afiliados;
- estrutura do corpo apenas para validar o formato, sem reutilizar a URL de produto capturada.

O importador ignorará user-agent, client hints, telemetria, identificadores publicitários e cabeçalhos não necessários. Cookies vazios, token CSRF ausente, múltiplas requisições ou sintaxe ambígua serão rejeitados.

## Formato normalizado

`meli-session.json` conterá somente:

```json
{
  "version": 1,
  "cookie": "valor sensível",
  "csrfToken": "valor sensível",
  "origin": "https://www.mercadolivre.com.br",
  "referer": "https://www.mercadolivre.com.br/afiliados/linkbuilder",
  "importedAt": "data ISO-8601"
}
```

Tokens e cookies nunca serão retornados por comandos de status. A gravação usará arquivo temporário e substituição atômica.

## Validação da sessão

Após importar, um comando de teste fará no máximo uma conversão supervisionada usando URL de produto e etiqueta fornecidas pelo operador. A requisição terá redirecionamento desativado, tempo limite e resposta limitada em tamanho.

Sucesso exige simultaneamente:

- HTTP 200;
- `status` igual a 200;
- exatamente uma URL retornada;
- `created` verdadeiro;
- URL de origem correspondente à solicitada, ignorando apenas o fragmento;
- etiqueta retornada idêntica à solicitada;
- link final HTTPS no host `meli.la`.

Qualquer resposta diferente será rejeitada sem publicar mensagem.

## Expiração e falhas

- HTTP 401 ou 403: `session_expired`; nenhuma repetição automática.
- Redirecionamento: `session_expired` ou `session_invalid`, sem seguir o destino.
- Resposta inesperada: `affiliate_response_invalid`.
- Tempo limite ou rede indisponível: uma falha transitória; nenhuma segunda tentativa automática nesta fase.
- Alteração do endpoint ou contrato: circuit breaker e revisão manual.
- Sessão ausente: instrução para gerar uma nova captura local.

O bot não retornará automaticamente ao OAuth ou Playwright quando a sessão expirar.

## Integração operacional

1. O operador abre o Gerador de Links no Edge pessoal e confirma que está autenticado.
2. No DevTools, copia como PowerShell uma requisição `createLink` concluída com sucesso.
3. Salva o texto em `secrets/meli-request.ps1.txt`.
4. Executa o importador local.
5. O importador valida e grava a sessão normalizada sem mostrar valores.
6. Executa uma conversão supervisionada.
7. Confirma visualmente que o link gerado está atribuído à etiqueta correta.
8. O arquivo bruto pode ser removido por uma opção explícita.

## Testes

- Importação de formatos válidos produzidos por `Copy as PowerShell`.
- Rejeição de comandos extras, múltiplas requisições e substituições de comando.
- Rejeição de host, método, origin ou referer incorretos.
- Rejeição de cookie ou CSRF ausentes.
- Gravação atômica e preservação da sessão anterior em caso de falha.
- Sanitização integral de erros e logs.
- Classificação de HTTP 401/403 sem repetição.
- Validação estrita da resposta de afiliado.
- Teste real único, supervisionado e com `DRY_RUN=true`.

## Critérios de conclusão

- Nenhum conteúdo do arquivo copiado é executado.
- Uma captura válida gera uma sessão normalizada sem vazamento.
- Capturas maliciosas ou ambíguas são rejeitadas.
- Uma conversão supervisionada retorna um link `meli.la` com a etiqueta correta.
- Sessão expirada pausa o fluxo na primeira resposta 401/403.
- A suíte automatizada passa.
- Nenhuma mensagem é publicada no WhatsApp durante a validação.

## Fora do escopo

- Renovação automática de cookies.
- Captura de cookies pelo Playwright ou perfil pessoal.
- Operação autônoma em escala.
- Execução do texto copiado.
- Suporte a Amazon, Shopee ou outros varejistas.
