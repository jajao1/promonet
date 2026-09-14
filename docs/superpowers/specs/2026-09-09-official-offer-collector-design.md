# Coletor oficial de ofertas — desenho

## Objetivo

Substituir grupos de terceiros como origem das ofertas por um coletor baseado nas APIs oficiais do Mercado Livre. O sistema selecionará produtos por nicho, validará os dados, gerará links com a tag de afiliado configurada e publicará nos grupos públicos correspondentes.

## Escopo inicial

O coletor suportará quatro nichos configuráveis: tecnologia, casa, moda e games. Cada nicho terá uma categoria Mercado Livre, grupo de destino, tag, intervalo mínimo entre publicações e critérios de seleção. O MVP poderá ativar somente os nichos que já tiverem grupo de destino conhecido; adicionar um nicho será uma alteração de configuração, não de código.

Amazon, Shopee, scraping de páginas, pesquisa por texto, cupons não confirmados e criação automática de grupos ficam fora deste escopo.

## Fonte e enriquecimento

O coletor consultará o recurso oficial `/highlights/MLB/category/{category_id}` para obter até 20 destaques por categoria. Os identificadores retornados serão normalizados e enriquecidos por endpoints oficiais de produto/item em lote. Quando preço promocional confiável não estiver disponível, a mensagem exibirá apenas o preço atual, sem inventar preço anterior ou percentual de desconto.

Somente páginas individuais de produto ou anúncio elegível serão aceitas. Página inicial, busca, categoria, vendedor, vitrine social e outros destinos não permitidos serão rejeitados antes da geração do link afiliado.

## Seleção

Um candidato precisa estar ativo, ter título, URL HTTPS oficial, imagem HTTPS oficial e preço atual positivo. O coletor rejeitará itens já publicados recentemente, dados incompletos e produtos fora do nicho consultado.

Entre os candidatos válidos, dará prioridade a desconto confirmado, melhor posição no ranking e melhor completude dos dados. Cada execução publicará no máximo uma oferta por nicho. O intervalo padrão será de duas horas por nicho, embora a coleta possa ocorrer a cada 30 minutos.

## Fluxo

Um processo agendado consulta os nichos vencidos, seleciona candidatos e grava trabalhos numa fila persistente. O pipeline existente gera o link por meio da ponte PowerShell, formata a mensagem e envia pela Evolution API. A publicação inclui título, preço, desconto apenas quando confirmado, link afiliado, imagem e indicação clara de publicidade.

O coletor não depende do webhook de mensagens. A rota antiga de grupos de terceiros poderá permanecer configurada, mas será desativada quando o coletor oficial for validado.

## Persistência e deduplicação

O PostgreSQL guardará execuções, candidatos e publicações. A identidade principal será o ID oficial do produto/item. O mesmo produto não poderá ser republicado no mesmo nicho durante sete dias. Uma restrição transacional impedirá duplicidade quando duas execuções coincidirem.

## Segurança e falhas

Tokens OAuth, chave da ponte e cookies permanecerão fora do banco e dos logs. Respostas terão tamanho e tempo limitados. Não haverá repetição automática de envio com resultado incerto. Falhas de autenticação, limite da API, dados inválidos, conversão ou envio serão classificadas e retidas para revisão.

O coletor não contornará CAPTCHA, bloqueio, rate limit ou controles de acesso. Se um endpoint oficial não estiver autorizado para a conta, o nicho ficará pausado e nenhum scraping será ativado automaticamente.

## Operação

O serviço rodará no Docker Compose. O agendamento usará intervalo interno persistente, com bloqueio único no PostgreSQL, em vez do Agendador do Windows. Reinícios não causarão publicação duplicada. `DRY_RUN=true` consultará e selecionará produtos, mas não gerará link nem enviará mensagem; as prévias permanecerão disponíveis para inspeção.

## Aceite

- Testes de normalização de `ITEM`, `PRODUCT` e `USER_PRODUCT`.
- Testes de filtros, ordenação, frequência e deduplicação.
- Testes garantindo que preço e desconto não sejam inferidos.
- Prévia persistida em modo simulado.
- Uma execução real controlada para um nicho e um grupo público.
- Compose válido, serviços saudáveis e nenhum segredo nos logs.
