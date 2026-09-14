# Ponte PowerShell para links afiliados

## Objetivo

Executar a chamada `createLink` pelo PowerShell do Windows, pois a mesma sessão retorna HTTP 200 nesse cliente e é recusada no Node. O bot permanece no container e não executa o texto copiado do DevTools.

## Arquitetura

Um serviço PowerShell escuta apenas em `127.0.0.1`, aceita `POST /convert` com URL e tag e exige uma chave aleatória. Ele lê a sessão normalizada, reconstrói uma única requisição para o endpoint fixo do Mercado Livre e devolve somente o link validado ou uma categoria fixa de erro. O container acessa o host por `host.docker.internal` e usa a ponte através de um cliente Node dedicado.

## Segurança e falhas

O endpoint, método e destino são fixos. URL, tag, tamanho do corpo, origem e resposta são validados. Cookies, CSRF e respostas remotas nunca aparecem nos logs. Não há avaliação de PowerShell, redirecionamentos nem repetição automática. A ponte recusa chamadas sem chave e classifica sessão expirada, resposta inválida e indisponibilidade.

## Operação e testes

Um script inicia a ponte no Windows; o Compose recebe URL e chave por ambiente. Testes unitários cobrem autenticação, contrato do cliente, ausência de repetição e validação da resposta. O modo `DRY_RUN=true` continua sem chamadas externas.
