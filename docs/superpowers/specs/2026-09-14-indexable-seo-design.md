# SEO indexável da PromoMega

## Objetivo

Transformar a vitrine da PromoMega em um site rastreável e indexável, capaz de captar buscas orgânicas por ofertas e categorias sem publicar preços vencidos nem representar a PromoMega como vendedora dos produtos.

## Diagnóstico atual

O HTML inicial contém somente a estrutura da interface. As ofertas são carregadas no navegador por JavaScript, e as URLs atuais de oferta redirecionam diretamente para o Mercado Livre. Não existem `robots.txt`, sitemap, canonical, Open Graph ou dados estruturados. Os hosts com e sem `www` também servem o mesmo conteúdo com HTTP 200.

Isso limita a descoberta das ofertas, cria duas versões da página inicial e impede que cada produto tenha conteúdo próprio para indexação.

## Arquitetura

O backend Node existente fará renderização HTML no servidor usando os dados do PostgreSQL. Não será criado outro serviço nem adotado um framework adicional.

As rotas públicas serão:

- `/`: página inicial renderizada com ofertas recentes;
- `/categoria/{slug}`: página indexável de uma categoria com ofertas válidas;
- `/oferta/{nicho}/{itemId}`: página indexável de uma oferta;
- `/ir/{nicho}/{itemId}`: registro anônimo do clique e redirecionamento para o link afiliado;
- `/robots.txt`: regras públicas de rastreamento;
- `/sitemap.xml`: URLs canônicas válidas;
- `/api/*`: APIs existentes para interação no navegador.

Os assets e a interação progressiva continuarão sendo atendidos pelo sistema atual. O conteúdo essencial não dependerá de JavaScript.

## Página inicial

A resposta inicial incluirá no HTML:

- um `h1` único;
- texto descritivo específico sobre ofertas verificadas e atualizadas;
- links HTML reais para categorias;
- até 24 ofertas recentes com título, imagem, preço atual, preço anterior e link para a página interna;
- aviso de publicidade e afiliação.

Busca, ordenação, filtros e carregamento adicional continuarão disponíveis por JavaScript. A versão sem parâmetros será a URL canônica da página inicial. Combinações de busca, ordenação e paginação receberão canonical para a página ou categoria base e não serão incluídas no sitemap.

## Páginas de categoria

Cada vertical configurada terá um slug estável e um nome público em português. Exemplos: `tenis`, `ferramentas`, `celulares`, `informatica`, `games`, `eletrodomesticos`, `beleza`, `esportes`, `automotivo` e `bebe`.

A página conterá título e descrição próprios, breadcrumb, `h1`, links para ofertas e navegação para as demais categorias. Categorias sem ofertas válidas responderão HTTP 404 e não aparecerão no sitemap.

## Páginas de oferta

Cada oferta válida terá uma página com:

- título completo do produto;
- imagem;
- preço atual e preço anterior;
- percentual de desconto calculado;
- data da última publicação;
- identificação do Mercado Livre como loja de destino;
- aviso de que preço e disponibilidade podem mudar;
- botão com texto descritivo que aponta para `/ir/{nicho}/{itemId}`;
- links para a categoria e para outras ofertas relacionadas.

A página não afirmará que a PromoMega vende, mantém estoque ou realiza a entrega.

## Validade e status HTTP

Uma oferta será considerada atual por sete dias após sua publicação mais recente.

- Até sete dias: página HTTP 200, indexável e incluída no sitemap.
- Após sete dias, mantendo um destino seguro: página HTTP 200 com `noindex,follow`, fora do sitemap e com aviso de possível expiração.
- Sem registro, sem publicação ou sem destino seguro: HTTP 410 para uma oferta anteriormente conhecida; HTTP 404 para uma URL que nunca correspondeu a uma oferta.

O backend consultará o registro da oferta antes de gerar HTML ou redirecionar. `/ir/` continuará validando o domínio de destino e registrando apenas o clique anônimo já previsto pelo sistema.

## Metadados

Todas as páginas indexáveis terão:

- `title` único e conciso;
- `meta name="description"` específico;
- canonical absoluto em `https://promomega.com.br`;
- `meta name="robots"` coerente com o ciclo de validade;
- Open Graph com título, descrição, URL, imagem e tipo;
- Twitter Card `summary_large_image`;
- `lang="pt-BR"`, viewport e theme color existentes.

Textos vindos de produtos ou do banco serão escapados antes de entrar em HTML, atributos ou JSON-LD.

## Dados estruturados

A página inicial usará `WebSite` e `Organization`. Páginas de categoria usarão `CollectionPage` e `BreadcrumbList`. Páginas de oferta usarão `Product`, `Offer` e `BreadcrumbList` em JSON-LD.

O `Offer` informará preço em BRL, URL interna da página, disponibilidade somente quando sustentada pelos dados e vendedor como Mercado Livre. A PromoMega será descrita como publicadora/afiliada, não como `seller`. Não serão inventados avaliações, frete, estoque, condição ou validade de preço.

Como a compra ocorre em outro site, os dados estruturados serão voltados à compreensão do conteúdo e a snippets de produto, sem prometer elegibilidade a listagens de comerciante.

## Sitemap, robots e canonicalização

`robots.txt` permitirá páginas públicas e bloqueará `/api/`, `/ir/` e rotas administrativas ou OAuth. Ele apontará para `https://promomega.com.br/sitemap.xml`.

O sitemap será XML gerado a partir das categorias com conteúdo e das ofertas publicadas nos últimos sete dias. Cada entrada terá a URL canônica e `lastmod` derivado da publicação. APIs, buscas, filtros, redirecionamentos e ofertas vencidas não entrarão.

O Caddy fará redirecionamento permanente de `https://www.promomega.com.br/*` para `https://promomega.com.br/*`. HTTP continuará sendo promovido para HTTPS pelo servidor.

## Desempenho e acessibilidade

O HTML renderizado evitará uma segunda renderização visual. O JavaScript reutilizará ou substituirá o conteúdo sem duplicá-lo. A primeira imagem relevante poderá carregar com prioridade; as demais continuarão com lazy loading. Imagens terão largura, altura e texto alternativo específico para reduzir mudanças de layout e melhorar a pesquisa de imagens.

CSS e JavaScript manterão cache com ETag. HTML e sitemap terão cache curto para refletir mudanças nas ofertas. A página continuará navegável por teclado e com regiões de status acessíveis.

## Segurança

- Todo conteúdo dinâmico será escapado por contexto.
- URLs de imagem e destino continuarão restritas aos hosts permitidos.
- JSON-LD será serializado de forma a impedir fechamento de `<script>`.
- Parâmetros de rota terão os limites existentes.
- Nenhum token, cookie, segredo ou identificador pessoal será exposto.
- Links afiliados externos usarão a rota interna de clique e indicação clara de publicidade.

## Testes

Testes automatizados cobrirão:

- HTML inicial com ofertas e links rastreáveis sem JavaScript;
- metadados únicos e canonical absoluto;
- escape de HTML, atributos e JSON-LD;
- páginas de categoria válidas e 404 para categorias vazias;
- página ativa indexável;
- página vencida com `noindex,follow`;
- 404 para oferta inexistente e 410 para oferta conhecida sem destino;
- redirecionamento exclusivo pela rota `/ir/`;
- sitemap apenas com URLs atuais e canônicas;
- `robots.txt` com bloqueios e referência ao sitemap;
- redirecionamento permanente de `www` para o domínio canônico;
- preservação das APIs, busca, filtros, acessibilidade e política de segurança de conteúdo.

## Implantação e validação

Antes do deploy, toda a suíte será executada e o HTML renderizado será inspecionado sem JavaScript. Depois do deploy serão conferidos status HTTP, canonical, robots, sitemap, dados estruturados, redirecionamento de `www`, páginas de categorias e ofertas, além do funcionamento dos links afiliados.

O sitemap poderá então ser cadastrado no Google Search Console. Indexação e posições não são imediatas nem garantidas; o objetivo técnico é tornar o conteúdo elegível, rastreável e consistente.
