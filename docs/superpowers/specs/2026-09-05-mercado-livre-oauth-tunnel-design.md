# Mercado Livre OAuth com Cloudflare Quick Tunnel

## Objetivo

Substituir a dependência de cookies internos do Mercado Livre por uma sessão OAuth oficial e renovável. O primeiro resultado esperado é autorizar a aplicação, armazenar os tokens com segurança e validar a renovação. A compatibilidade do token OAuth com o endpoint de criação de links de afiliado será verificada separadamente, pois não está confirmada pela documentação pública.

## Escopo

Esta etapa inclui:

- callback OAuth local no projeto PromoNET;
- exposição temporária do callback por HTTPS usando Cloudflare Quick Tunnel;
- geração da URL de autorização;
- troca do código de autorização por tokens;
- armazenamento local de access token, refresh token e metadados;
- renovação automática e substituição atômica do refresh token;
- teste controlado da autenticação;
- teste isolado de compatibilidade com a criação de links de afiliado.

Não inclui domínio próprio, túnel permanente, painel web, publicação real de ofertas ou ativação de `DRY_RUN=false`.

## Arquitetura

O bot continuará sendo executado em Docker. Um endpoint HTTP dedicado receberá o callback em `/oauth/mercadolivre/callback`. A porta será exposta apenas no host local. O processo `cloudflared`, executado no computador, criará um endereço HTTPS público temporário que encaminhará requisições para esse endpoint.

A URI cadastrada no portal do Mercado Livre será:

`https://<endereco-temporario>.trycloudflare.com/oauth/mercadolivre/callback`

Como o Quick Tunnel gera um endereço diferente após reinicialização, o endereço cadastrado no Mercado Livre deverá ser atualizado antes de uma nova autorização quando o túnel mudar. A renovação normal dos tokens não utiliza o callback e, portanto, não depende de o túnel permanecer ativo.

## Componentes

### Endpoint OAuth

Responsabilidades:

- iniciar a autorização com um parâmetro `state` aleatório e de uso único;
- validar exatamente o `state` recebido no callback;
- rejeitar callbacks ausentes, expirados ou repetidos;
- trocar o código por tokens usando o endpoint oficial;
- mostrar apenas uma confirmação simples, sem exibir tokens no navegador ou nos logs.

### Armazenamento de tokens

Os tokens serão salvos em `secrets/meli-oauth.json`, arquivo excluído do Git. A gravação será atômica: primeiro em arquivo temporário no mesmo diretório e depois por substituição. O conteúdo terá permissões locais restritas quando o sistema operacional permitir.

O App Secret ficará somente no `.env`, que já está excluído do Git. Segredos, códigos de autorização e tokens não serão impressos nem solicitados no chat.

### Renovação

Antes de usar o access token, o cliente verificará sua validade com margem de segurança. Quando necessário, fará a renovação e salvará imediatamente o novo access token e o novo refresh token. Se a resposta for incompleta ou falhar, o arquivo anterior permanecerá intacto e o bot não tentará publicar usando credenciais incertas.

### Cloudflare Tunnel

Um script PowerShell verificará ou instalará `cloudflared`, iniciará o Quick Tunnel e identificará a URL HTTPS retornada. O script exibirá somente a URI completa que deve ser cadastrada no portal do Mercado Livre. O túnel será necessário apenas durante a autorização inicial ou uma nova autorização.

## Fluxo de dados

1. O Quick Tunnel publica o callback local e fornece a URL HTTPS.
2. O usuário cadastra a URI completa no aplicativo do Mercado Livre.
3. O serviço gera uma URL de autorização contendo `client_id`, callback e `state`.
4. O usuário entra no Mercado Livre e autoriza a aplicação.
5. O Mercado Livre redireciona o navegador para o callback público.
6. O túnel encaminha a requisição ao serviço local.
7. O serviço valida o `state`, troca o código por tokens e os grava localmente.
8. Um teste consulta um recurso oficial autenticado para confirmar a sessão.
9. Um teste separado tenta gerar um link de afiliado e registra apenas status e diagnóstico sanitizado.

## Tratamento de falhas

- URL do túnel alterada: interromper a autorização e orientar a atualização da URI cadastrada.
- `state` inválido ou expirado: rejeitar o callback sem trocar o código.
- código reutilizado: rejeitar a segunda tentativa.
- erro na troca ou renovação: preservar os tokens anteriores e manter o bot em modo seguro.
- endpoint de afiliados rejeitar OAuth: manter `DRY_RUN=true` e não voltar automaticamente ao uso de cookies.
- resposta inesperada: não persistir dados parciais e não registrar conteúdo sensível.

## Testes

Serão adicionados testes para:

- criação, expiração e consumo único do `state`;
- validação do callback;
- armazenamento atômico sem exposição de segredos;
- renovação e rotação do refresh token;
- preservação do arquivo anterior quando uma renovação falhar;
- sanitização de logs;
- integração local do callback em container;
- verificação manual do fluxo OAuth real;
- teste controlado e separado do endpoint de afiliados.

## Critérios de conclusão

A etapa estará concluída quando:

- a URI HTTPS for aceita pelo portal do Mercado Livre;
- a autorização terminar no callback local;
- os tokens forem armazenados sem aparecer em logs ou no chat;
- uma chamada oficial autenticada funcionar;
- a renovação trocar e persistir corretamente os tokens;
- a compatibilidade do endpoint de afiliados estiver comprovada ou documentada como incompatível;
- o bot continuar em `DRY_RUN=true` até a geração real de link ser validada.

## Segurança operacional

Os cookies compartilhados anteriormente são considerados comprometidos e não serão reutilizados. O usuário deverá encerrar as sessões existentes do Mercado Livre e entrar novamente. O projeto nunca armazenará Client Secret, tokens ou cookies no repositório.
