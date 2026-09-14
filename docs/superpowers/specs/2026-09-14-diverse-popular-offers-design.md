# Ofertas populares com diversidade de nichos

## Objetivo

Publicar no grupo do WhatsApp ofertas relevantes e variadas, priorizando produtos mais vendidos do Mercado Livre e evitando repetição de produtos ou concentração contínua em poucos nichos.

## Diagnóstico

O coletor atual consulta categorias raiz do Mercado Livre. O endpoint oficial `/highlights/MLB/category/{category_id}` somente fornece o ranking de mais vendidos para categorias folha. Como resultado, oito dos dez nichos frequentemente terminam em `review` antes da seleção, enquanto bebê e casa continuam fornecendo produtos. O bloqueio atual também é consultado por nicho, não globalmente.

## Fonte de produtos

O coletor continuará usando a API oficial do Mercado Livre e o ranking de mais vendidos. A configuração passará a conter categorias folha verificadas, organizadas em dez verticais:

- tênis e calçados;
- ferramentas;
- celulares;
- informática;
- games;
- eletrodomésticos;
- beleza;
- esportes;
- acessórios automotivos;
- bebê.

Cada vertical poderá conter mais de uma categoria folha. O coletor alternará a categoria consultada em rodadas sucessivas. Alimentos, bebidas e supermercado não farão parte da configuração.

Os IDs exatos serão obtidos da árvore oficial de categorias do site MLB e validados por uma consulta ao endpoint de `highlights`. Uma categoria só poderá ficar ativa se produzir uma resposta válida do ranking.

## Seleção e qualidade

Cada rodada terá limite máximo de dez publicações, sem obrigação de preencher a cota. O coletor escolherá no máximo uma oferta por vertical em cada rodada.

Uma oferta será elegível somente quando:

- estiver ativa;
- pertencer à categoria consultada;
- estiver no ranking oficial de mais vendidos;
- tiver preço atual positivo;
- tiver preço anterior válido e superior ao preço atual;
- possuir URL oficial do Mercado Livre e imagem válida;
- não tiver sido publicada nos últimos sete dias.

Entre ofertas elegíveis, a posição no ranking de mais vendidos será o critério principal. O percentual de desconto será usado como desempate. Assim, um desconto exagerado em um item pouco relevante não terá precedência sobre um produto mais vendido.

## Diversidade e repetição

O histórico de sete dias será global por `item_id`, e não separado por nicho. Isso impedirá que o mesmo produto seja reenviado por outra categoria ou vertical.

A ordem inicial das verticais mudará a cada rodada por rotação persistente. Todas as verticais vencidas serão avaliadas, mas a rotação impedirá que as mesmas apareçam sempre primeiro caso a execução seja interrompida ou alcance o limite máximo.

Dentro de cada vertical, o índice da última categoria folha consultada também será persistido. Na rodada seguinte, o coletor avançará para a próxima categoria configurada.

## Fluxo de execução

1. A cada 20 minutos, o coletor reivindica uma nova rodada.
2. Carrega a posição persistida da rotação de verticais.
3. Para cada vertical, seleciona sua próxima categoria folha.
4. Consulta o ranking oficial de mais vendidos.
5. Resolve os dados dos produtos retornados.
6. Aplica os filtros de validade, desconto e histórico global.
7. Seleciona no máximo um produto por vertical.
8. Cria o link de afiliado e envia a mensagem ao WhatsApp.
9. Aguarda 15 segundos entre mensagens.
10. Persiste publicação, resultado e próxima posição da rotação.

Falhas em uma vertical não interromperão as seguintes. Se não houver dez ofertas elegíveis, a rodada terminará com menos mensagens.

## Persistência e observabilidade

A tabela de execuções armazenará o estado necessário para alternar verticais e categorias folha. A consulta de publicações recentes passará a pesquisar `item_id` sem filtrar por nicho.

Cada tentativa de vertical registrará um dos seguintes resultados:

- `published`: oferta publicada;
- `empty`: ranking válido, mas sem oferta elegível;
- `unsupported_category`: categoria sem ranking disponível;
- `source_error`: falha ao consultar ou resolver produtos;
- `affiliate_error`: falha na criação do link;
- `delivery_error`: falha no envio pelo WhatsApp.

Os logs incluirão a vertical, categoria folha e resultado, sem gravar cookies, tokens ou chaves.

## Compatibilidade

O site continuará consumindo as ofertas publicadas da mesma forma. A geração do link afiliado, o formato das mensagens, o grupo de destino e a integração com Evolution API não mudarão.

## Testes e critérios de aceite

Serão adicionados testes para garantir que:

- a configuração rejeite categorias raiz ou categorias folha não verificadas;
- a rotação avance entre verticais e categorias;
- uma rodada selecione no máximo uma oferta por vertical;
- o mesmo `item_id` seja bloqueado globalmente por sete dias;
- alimentos não possam ser configurados;
- produtos sem desconto real sejam rejeitados;
- o ranking tenha precedência sobre o percentual de desconto;
- uma falha isolada não bloqueie as verticais seguintes;
- a rodada possa terminar com menos de dez ofertas;
- os motivos de falha sejam registrados sem segredos.

Antes do deploy, uma rodada controlada deverá demonstrar ofertas de verticais diferentes, ausência de alimentos, ausência de itens publicados nos sete dias anteriores e funcionamento dos links afiliados.
