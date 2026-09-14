# Indexable Storefront SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a vitrine PromoMega em páginas HTML indexáveis, com metadados e dados estruturados corretos, preservando as APIs atuais e medindo o clique afiliado em uma rota de saída separada.

**Architecture:** O servidor Node existente passa a renderizar a home, categorias e ofertas com dados do PostgreSQL, usando um módulo de apresentação pequeno e sem framework. A rota pública da oferta exibe conteúdo indexável; `/ir/...` valida o destino, registra o clique e redireciona. O JavaScript do navegador apenas melhora busca, filtros e paginação sobre o HTML inicial já utilizável.

**Tech Stack:** Node.js 24, módulos ES, `node:test`, PostgreSQL (`pg`), HTML/CSS/JavaScript, JSON-LD, Caddy e Docker Compose.

---

## Estrutura de arquivos

- Criar `bot/storefront-catalog.mjs`: catálogo fixo dos dez slugs, nomes e descrições públicas.
- Criar `bot/seo-renderer.mjs`: escaping, URLs canônicas, layout HTML, cards e JSON-LD.
- Criar `bot/test/seo-renderer.test.mjs`: testes puros do HTML e da segurança da renderização.
- Modificar `bot/public-offers-store.mjs`: consultas para detalhes, relacionados e sitemap, com janela de sete dias.
- Modificar `bot/test/public-offers-store.test.mjs`: contrato das novas consultas.
- Modificar `bot/public-site-handler.mjs`: SSR, estados HTTP, `/ir`, robots e sitemap.
- Modificar `bot/test/public-site-handler.test.mjs`: integração HTTP das rotas públicas.
- Modificar `site/app.js`: melhoria progressiva sem apagar o HTML entregue pelo servidor.
- Modificar `site/index.html`: manter apenas a referência estrutural/fallback, alinhada ao markup renderizado.
- Modificar `site/styles.css`: breadcrumb, página de oferta, aviso expirado e estados sem JavaScript.
- Modificar `bot/test/site-assets.test.mjs`: contrato dos assets e da melhoria progressiva.
- Modificar `Caddyfile`: uma única origem canônica com redirecionamento permanente de `www`.
- Modificar `README.md`: rotas, ciclo de vida e comandos de validação SEO.

### Task 1: Catálogo público estável de categorias

**Files:**
- Create: `bot/storefront-catalog.mjs`
- Create: `bot/test/storefront-catalog.test.mjs`

- [ ] **Step 1: Escrever o teste que fixa os slugs e rejeita categorias desconhecidas**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { categoryBySlug, storefrontCategories } from "../storefront-catalog.mjs";

test("exposes the ten stable public storefront categories", () => {
  assert.deepEqual(storefrontCategories.map(({ slug }) => slug), [
    "tenis", "ferramentas", "celulares", "informatica", "games",
    "eletrodomesticos", "beleza", "esportes", "automotivo", "bebe",
  ]);
  assert.equal(categoryBySlug("ferramentas").name, "Ferramentas");
  assert.equal(categoryBySlug("comida"), null);
});
```

- [ ] **Step 2: Rodar o teste e confirmar a falha inicial**

Run: `node --test bot/test/storefront-catalog.test.mjs`

Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `storefront-catalog.mjs`.

- [ ] **Step 3: Implementar o catálogo imutável**

```js
const definitions = [
  ["tenis", "Tênis", "Ofertas recentes de tênis masculinos, femininos e infantis."],
  ["ferramentas", "Ferramentas", "Promoções de ferramentas elétricas, manuais e acessórios."],
  ["celulares", "Celulares", "Ofertas de smartphones, acessórios e dispositivos móveis."],
  ["informatica", "Informática", "Promoções de computadores, periféricos e acessórios."],
  ["games", "Games", "Ofertas de consoles, controles, jogos e acessórios gamer."],
  ["eletrodomesticos", "Eletrodomésticos", "Promoções de eletrodomésticos para casa e cozinha."],
  ["beleza", "Beleza", "Ofertas de beleza, cuidados pessoais e perfumaria."],
  ["esportes", "Esportes", "Promoções de artigos esportivos, treino e lazer."],
  ["automotivo", "Automotivo", "Ofertas de acessórios, peças e cuidados automotivos."],
  ["bebe", "Bebê", "Promoções de itens para bebês e cuidados infantis."],
];

export const storefrontCategories = Object.freeze(definitions.map(([slug, name, description]) => Object.freeze({ slug, name, description })));
const bySlug = new Map(storefrontCategories.map((category) => [category.slug, category]));
export const categoryBySlug = (slug) => bySlug.get(slug) ?? null;
```

- [ ] **Step 4: Rodar o teste e confirmar sucesso**

Run: `node --test bot/test/storefront-catalog.test.mjs`

Expected: PASS, 1 test.

- [ ] **Step 5: Commitar**

```bash
git add bot/storefront-catalog.mjs bot/test/storefront-catalog.test.mjs
git commit -m "feat: define public storefront categories"
```

### Task 2: Modelo de leitura SEO no PostgreSQL

**Files:**
- Modify: `bot/public-offers-store.mjs`
- Modify: `bot/test/public-offers-store.test.mjs`

- [ ] **Step 1: Adicionar testes para categoria, detalhe, relacionados e sitemap**

Adicionar ao teste um relógio fixo e filas de resultados que verifiquem estes contratos:

```js
test("reads indexable category and offer views with a seven day lifecycle", async () => {
  const db = database([
    [{ niche_id: "games", item_id: "MLB1", title: "Controle", price: "379.90", original_price: "499.90", image_url: "https://http2.mlstatic.com/a.jpg", published_at: "2026-09-12T12:00:00Z", total_count: "1" }],
    [{ niche_id: "games", item_id: "MLB1", title: "Controle", price: "379.90", original_price: "499.90", image_url: "https://http2.mlstatic.com/a.jpg", published_at: "2026-09-12T12:00:00Z", affiliate_url: "https://meli.la/abc" }],
    [{ niche_id: "games", item_id: "MLB2", title: "Console", price: "3000", original_price: null, image_url: null, published_at: "2026-09-13T12:00:00Z" }],
  ]);
  const store = new PublicOffersStore(db, { now: () => new Date("2026-09-14T12:00:00Z") });
  assert.equal((await store.listCategory("games", { limit: 24 })).items[0].itemId, "MLB1");
  assert.equal((await store.findOfferPage("games", "MLB1")).status, "active");
  assert.equal((await store.listRelated("games", "MLB1", 4))[0].itemId, "MLB2");
  assert.match(db.calls[0].text, /published_at\s*>=\s*\$\d/);
});

test("distinguishes expired, unavailable, and unknown offers", async () => {
  const db = database([
    [{ niche_id: "games", item_id: "OLD", title: "Antigo", price: "99", original_price: null, image_url: null, published_at: "2026-09-01T12:00:00Z", affiliate_url: "https://meli.la/old" }],
    [{ niche_id: "games", item_id: "BAD", title: "Sem destino", price: "99", original_price: null, image_url: null, published_at: "2026-09-13T12:00:00Z", affiliate_url: null }],
    [],
  ]);
  const store = new PublicOffersStore(db, { now: () => new Date("2026-09-14T12:00:00Z") });
  assert.equal((await store.findOfferPage("games", "OLD")).status, "expired");
  assert.equal((await store.findOfferPage("games", "BAD")).status, "unavailable");
  assert.equal(await store.findOfferPage("games", "UNKNOWN"), null);
});

test("lists only active category and offer URLs for the sitemap", async () => {
  const db = database([[{ niche_id: "games", latest_at: "2026-09-13T12:00:00Z" }], [{ niche_id: "games", item_id: "MLB1", published_at: "2026-09-13T12:00:00Z" }]]);
  const store = new PublicOffersStore(db, { now: () => new Date("2026-09-14T12:00:00Z") });
  assert.deepEqual(await store.listSitemapCategories(), [{ slug: "games", lastModified: "2026-09-13T12:00:00Z" }]);
  assert.deepEqual(await store.listSitemapOffers(), [{ category: "games", itemId: "MLB1", lastModified: "2026-09-13T12:00:00Z" }]);
  assert.match(db.calls[1].text, /published_at\s*>=\s*\$1/);
});
```

- [ ] **Step 2: Rodar os testes e confirmar a falha por métodos ausentes**

Run: `node --test bot/test/public-offers-store.test.mjs`

Expected: FAIL com `store.listCategory is not a function`.

- [ ] **Step 3: Implementar relógio e janela de publicação**

Alterar o construtor e centralizar a data mínima:

```js
constructor(db, { now = () => new Date() } = {}) { this.db = db; this.now = now; }

activeSince() {
  return new Date(this.now().getTime() - 7 * 24 * 60 * 60 * 1000);
}
```

Aplicar `pub.published_at >= $n` em `list`, `categories` e `listCategory`, garantindo que home, API e páginas indexáveis mostrem o mesmo conjunto ativo. `listCategory` deve devolver o mesmo formato de `list`, sempre filtrado pelo `niche_id` recebido.

- [ ] **Step 4: Implementar o detalhe e seus estados explícitos**

```js
async findOfferPage(nicheId, itemId) {
  const result = await this.db.query(`SELECT p.niche_id,p.item_id,p.title,p.price,p.original_price,p.image_url,
      pub.published_at,pub.affiliate_url
    FROM promonet.offer_previews p
    LEFT JOIN LATERAL (
      SELECT published_at,affiliate_url FROM promonet.offer_publications
      WHERE niche_id=p.niche_id AND item_id=p.item_id ORDER BY published_at DESC LIMIT 1
    ) pub ON true
    WHERE p.niche_id=$1 AND p.item_id=$2 AND p.state='published' LIMIT 1`, [nicheId, itemId]);
  const row = result.rows[0];
  if (!row) return null;
  const status = !row.published_at || !row.affiliate_url ? "unavailable"
    : new Date(row.published_at) < this.activeSince() ? "expired" : "active";
  return {
    status, category: row.niche_id, itemId: row.item_id, title: row.title,
    price: number(row.price), originalPrice: number(row.original_price), imageUrl: row.image_url,
    publishedAt: row.published_at, affiliateUrl: row.affiliate_url,
  };
}
```

Implementar `listRelated(nicheId, excludedItemId, limit)` com ofertas ativas da mesma categoria, `item_id <> $2`, ordenadas pela publicação mais recente e limitadas a no máximo 8.

- [ ] **Step 5: Implementar as consultas compactas do sitemap**

`listSitemapCategories()` deve agrupar por `niche_id` e retornar `MAX(published_at)`; `listSitemapOffers()` deve usar `DISTINCT ON (niche_id,item_id)`, exigir publicação dentro da janela e `affiliate_url IS NOT NULL`. Mapear datas para strings ISO e propriedades `slug/category`, `itemId`, `lastModified` exatamente como nos testes.

- [ ] **Step 6: Rodar os testes do store**

Run: `node --test bot/test/public-offers-store.test.mjs`

Expected: PASS para todos os testes do arquivo.

- [ ] **Step 7: Commitar**

```bash
git add bot/public-offers-store.mjs bot/test/public-offers-store.test.mjs
git commit -m "feat: add indexable offer read model"
```

### Task 3: Renderizador HTML seguro e dados estruturados

**Files:**
- Create: `bot/seo-renderer.mjs`
- Create: `bot/test/seo-renderer.test.mjs`
- Modify: `site/styles.css`

- [ ] **Step 1: Escrever testes de escaping, canonical, cards e JSON-LD**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { renderHomePage, renderCategoryPage, renderOfferPage } from "../seo-renderer.mjs";

const offer = { status: "active", category: "games", itemId: "MLB1", title: `Controle <script>alert("x")</script>`, price: 379.9, originalPrice: 499.9, imageUrl: "https://http2.mlstatic.com/a.jpg", publishedAt: "2026-09-14T12:00:00Z" };

test("renders an indexable home page without trusting offer data", () => {
  const html = renderHomePage({ offers: [offer], total: 1, categories: [{ id: "games", count: 1 }], whatsAppGroupUrl: "" });
  assert.match(html, /<h1>/);
  assert.match(html, /rel="canonical" href="https:\/\/promomega\.com\.br\/"/);
  assert.match(html, /href="\/categoria\/games"/);
  assert.match(html, /href="\/oferta\/games\/MLB1"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /\\u003cscript/);
  assert.match(html, /"@type":"WebSite"/);
});

test("renders unique category metadata and breadcrumb data", () => {
  const html = renderCategoryPage({ category: { slug: "games", name: "Games", description: "Jogos e consoles." }, offers: [offer], total: 1 });
  assert.match(html, /<title>Ofertas de Games/);
  assert.match(html, /https:\/\/promomega\.com\.br\/categoria\/games/);
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
});

test("renders active and expired product pages without invented claims", () => {
  const active = renderOfferPage({ offer, related: [] });
  assert.match(active, /"@type":"Product"/);
  assert.match(active, /"@type":"Offer"/);
  assert.match(active, /href="\/ir\/games\/MLB1"/);
  assert.doesNotMatch(active, /aggregateRating|shippingDetails|priceValidUntil|itemCondition/);
  const expired = renderOfferPage({ offer: { ...offer, status: "expired" }, related: [] });
  assert.match(expired, /name="robots" content="noindex,follow"/);
  assert.match(expired, /Esta oferta pode ter expirado/);
});
```

- [ ] **Step 2: Rodar e confirmar falha por módulo ausente**

Run: `node --test bot/test/seo-renderer.test.mjs`

Expected: FAIL com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar primitivas seguras e um layout comum**

O módulo deve exportar as três funções testadas e manter internamente:

```js
const ORIGIN = "https://promomega.com.br";
const html = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const jsonLd = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
const absolute = (path) => new URL(path, ORIGIN).href;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
```

Criar `layout({ title, description, canonicalPath, robots = "index,follow", body, schemas })` com `lang="pt-BR"`, viewport, theme color, description, canonical, robots, Open Graph (`og:type`, `og:title`, `og:description`, `og:url`, `og:site_name`, imagem quando houver), Twitter `summary_large_image`, favicon, CSS e módulo JS. Inserir cada schema usando somente `jsonLd`.

- [ ] **Step 4: Implementar cards e as três páginas**

O card SSR deve usar `<article class="offer-card">`, imagem HTTPS restrita a `mlstatic.com` e seus subdomínios ou placeholder, dimensões `300x300`, `loading="eager" fetchpriority="high"` apenas no primeiro card e `loading="lazy"` nos demais. O link de título e CTA aponta para `/oferta/{category}/{itemId}`. A home inclui até 24 cards, um H1, links reais para categorias e disclosure de afiliados. A categoria inclui breadcrumb, H1/descrição exclusivos e `CollectionPage`. A oferta inclui breadcrumb, título, imagem, preços, desconto calculado, data, aviso de alteração de preço, botão `/ir/...` com `rel="sponsored nofollow"`, relacionados e schemas `Product`, `Offer` e `BreadcrumbList`; o `seller` no schema deve ser `Mercado Livre`, nunca PromoMega. Omitir `availability` enquanto o banco não trouxer evidência de estoque.

- [ ] **Step 5: Adicionar estilos das novas páginas**

Adicionar classes `.breadcrumb`, `.category-intro`, `.offer-detail`, `.offer-detail-image`, `.offer-detail-copy`, `.expired-notice` e `.related-offers`, reutilizando as variáveis, tipografia e cores existentes. Incluir breakpoint móvel para a página de detalhe virar uma coluna e foco visível para links e botões.

- [ ] **Step 6: Rodar testes puros e verificar sucesso**

Run: `node --test bot/test/seo-renderer.test.mjs`

Expected: PASS, 3 tests.

- [ ] **Step 7: Commitar**

```bash
git add bot/seo-renderer.mjs bot/test/seo-renderer.test.mjs site/styles.css
git commit -m "feat: render secure indexable storefront pages"
```

### Task 4: Rotas SSR e ciclo de vida HTTP

**Files:**
- Modify: `bot/public-site-handler.mjs`
- Modify: `bot/test/public-site-handler.test.mjs`

- [ ] **Step 1: Substituir o teste de redirecionamento antigo por testes das páginas SSR**

```js
test("server renders home, category, and active offer pages", async () => {
  const active = { status: "active", category: "games", itemId: "MLB1", title: "Controle", price: 379.9, originalPrice: 499.9, imageUrl: null, publishedAt: "2026-09-14T12:00:00Z", affiliateUrl: "https://meli.la/abc" };
  const store = {
    list: async () => ({ items: [active], total: 1, page: 1, limit: 24 }),
    categories: async () => [{ id: "games", count: 1 }],
    listCategory: async () => ({ items: [active], total: 1, page: 1, limit: 24 }),
    findOfferPage: async () => active,
    listRelated: async () => [],
  };
  const handler = publicSiteHandler({ store });
  for (const url of ["/", "/categoria/games", "/oferta/games/MLB1"]) {
    const res = response(); await handler({ method: "GET", url, headers: {} }, res);
    assert.equal(res.status, 200); assert.match(res.headers["content-type"], /text\/html/);
    assert.match(String(res.body), /rel="canonical"/);
  }
});

test("canonicalizes filtered pages to their clean landing page", async () => {
  const store = { list: async () => ({ items: [], total: 0, page: 2, limit: 24 }), categories: async () => [] };
  const res = response();
  await publicSiteHandler({ store })({ method: "GET", url: "/?q=controle&sort=discount&page=2", headers: {} }, res);
  assert.match(String(res.body), /rel="canonical" href="https:\/\/promomega\.com\.br\/"/);
  assert.doesNotMatch(String(res.body), /canonical[^>]+\?/);
});

test("applies expired, unavailable, unknown, and empty category semantics", async () => {
  const cases = [
    [{ status: "expired", category: "games", itemId: "OLD", title: "Antigo", price: 99, originalPrice: null, imageUrl: null, publishedAt: "2026-09-01T12:00:00Z", affiliateUrl: "https://meli.la/old" }, 200, /noindex,follow/],
    [{ status: "unavailable" }, 410, /Oferta indisponível/],
    [null, 404, /Oferta não encontrada/],
  ];
  for (const [offer, status, body] of cases) {
    const res = response();
    await publicSiteHandler({ store: { findOfferPage: async () => offer, listRelated: async () => [] } })({ method: "GET", url: "/oferta/games/MLB1", headers: {} }, res);
    assert.equal(res.status, status); assert.match(String(res.body), body);
  }
  const category = response();
  await publicSiteHandler({ store: { listCategory: async () => ({ items: [], total: 0, page: 1, limit: 24 }) } })({ method: "GET", url: "/categoria/games", headers: {} }, category);
  assert.equal(category.status, 404);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que `/oferta` ainda retorna 302**

Run: `node --test bot/test/public-site-handler.test.mjs`

Expected: FAIL porque a home é o arquivo estático e `/oferta/games/MLB1` responde 302.

- [ ] **Step 3: Criar resposta HTML e rotear home e categorias**

Adicionar:

```js
function sendHtml(res, status, body, robots = "index,follow") {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    "x-robots-tag": robots,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": "default-src 'self'; img-src 'self' https://*.mlstatic.com; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}
```

Para `/`, buscar em paralelo `store.list({ limit: 24 })` e `store.categories()` e chamar `renderHomePage`. Para `/categoria/{slug}`, resolver `categoryBySlug`, chamar `store.listCategory(slug, { limit: 24 })` e responder 404 HTML quando o slug for desconhecido ou não houver ofertas.

- [ ] **Step 4: Transformar `/oferta` em detalhe indexável**

Usar `store.findOfferPage`. Responder 404 HTML para `null`, 410 HTML para `status === "unavailable"` ou destino fora da allowlist, e 200 para ativos/expirados. Para ativo, carregar relacionados e enviar `index,follow`; para expirado, enviar `noindex,follow`. As páginas 404 e 410 também recebem `noindex,follow` e não expõem mensagens internas. Ignorar parâmetros de busca, ordenação e página na canonical: a home aponta para `/` e uma categoria aponta para `/categoria/{slug}`.

- [ ] **Step 5: Rodar os testes do handler**

Run: `node --test bot/test/public-site-handler.test.mjs`

Expected: PASS para SSR e APIs existentes, exceto o teste do redirecionamento que será atualizado na próxima tarefa.

- [ ] **Step 6: Commitar**

```bash
git add bot/public-site-handler.mjs bot/test/public-site-handler.test.mjs
git commit -m "feat: serve indexable storefront routes"
```

### Task 5: Rota de saída afiliada isolada

**Files:**
- Modify: `bot/public-site-handler.mjs`
- Modify: `bot/test/public-site-handler.test.mjs`

- [ ] **Step 1: Escrever o teste de `/ir` e ajustar o contrato legado**

```js
test("records an anonymous click only on the validated outbound route", async () => {
  const clicks = [];
  const active = { status: "active", affiliateUrl: "https://meli.la/abc" };
  const handler = publicSiteHandler({ store: {
    findOfferPage: async () => active,
    recordClick: async (...args) => clicks.push(args),
  }, randomUUID: () => "request-id" });
  const res = response();
  await handler({ method: "GET", url: "/ir/games/MLB1", headers: { referer: "https://promomega.com.br/oferta/games/MLB1" } }, res);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "https://meli.la/abc");
  assert.equal(res.headers["x-robots-tag"], "noindex, nofollow");
  assert.deepEqual(clicks, [["games", "MLB1", "request-id", "promomega.com.br"]]);
});

test("never redirects unknown, expired, or unsafe outbound offers", async () => {
  for (const offer of [null, { status: "expired", affiliateUrl: "https://meli.la/old" }, { status: "active", affiliateUrl: "https://evil.example/x" }]) {
    const res = response();
    await publicSiteHandler({ store: { findOfferPage: async () => offer } })({ method: "GET", url: "/ir/games/MLB1", headers: {} }, res);
    assert.ok([404, 410].includes(res.status));
    assert.equal(res.headers.location, undefined);
  }
});
```

- [ ] **Step 2: Rodar e confirmar que `/ir` ainda é 404**

Run: `node --test bot/test/public-site-handler.test.mjs`

Expected: FAIL, status atual 404 em vez de 302.

- [ ] **Step 3: Implementar a saída validada**

Reconhecer `/ir/{nicho}/{itemId}` antes do fallback 404. Buscar `findOfferPage`, exigir `status === "active"`, validar `affiliateUrl` com `safeDestination`, registrar clique e responder:

```js
res.writeHead(302, {
  location: offer.affiliateUrl,
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
});
res.end();
```

Usar 404 para item desconhecido, 410 para expirado/indisponível/destino inseguro e 503 sanitizado para falha do banco.

- [ ] **Step 4: Rodar os testes e confirmar sucesso**

Run: `node --test bot/test/public-site-handler.test.mjs`

Expected: PASS para páginas e saída afiliada.

- [ ] **Step 5: Commitar**

```bash
git add bot/public-site-handler.mjs bot/test/public-site-handler.test.mjs
git commit -m "feat: separate affiliate outbound redirects"
```

### Task 6: Robots e sitemap dinâmico

**Files:**
- Modify: `bot/public-site-handler.mjs`
- Modify: `bot/test/public-site-handler.test.mjs`

- [ ] **Step 1: Escrever testes para arquivos de descoberta**

```js
test("serves robots rules and an active-only XML sitemap", async () => {
  const store = {
    listSitemapCategories: async () => [{ slug: "games", lastModified: "2026-09-13T12:00:00Z" }],
    listSitemapOffers: async () => [{ category: "games", itemId: "MLB1", lastModified: "2026-09-14T12:00:00Z" }],
  };
  const handler = publicSiteHandler({ store });
  const robots = response(); await handler({ method: "GET", url: "/robots.txt" }, robots);
  assert.equal(robots.status, 200);
  assert.match(robots.body, /Disallow: \/api\//);
  assert.match(robots.body, /Disallow: \/ir\//);
  assert.match(robots.body, /Sitemap: https:\/\/promomega\.com\.br\/sitemap\.xml/);
  const sitemap = response(); await handler({ method: "GET", url: "/sitemap.xml" }, sitemap);
  assert.equal(sitemap.headers["content-type"], "application/xml; charset=utf-8");
  assert.match(sitemap.body, /<loc>https:\/\/promomega\.com\.br\/categoria\/games<\/loc>/);
  assert.match(sitemap.body, /<loc>https:\/\/promomega\.com\.br\/oferta\/games\/MLB1<\/loc>/);
  assert.doesNotMatch(sitemap.body, /\/ir\//);
});
```

- [ ] **Step 2: Rodar e confirmar os 404 atuais**

Run: `node --test bot/test/public-site-handler.test.mjs`

Expected: FAIL com status 404 para `/robots.txt`.

- [ ] **Step 3: Implementar `robots.txt`**

Responder `text/plain; charset=utf-8`, cache de 1 hora, com conteúdo exato:

```text
User-agent: *
Allow: /
Disallow: /api/
Disallow: /ir/
Disallow: /oauth/
Disallow: /admin/
Sitemap: https://promomega.com.br/sitemap.xml
```

- [ ] **Step 4: Implementar `sitemap.xml` com escaping XML**

Buscar categorias e ofertas em paralelo. Emitir a home, categorias não vazias e ofertas ativas, com `<lastmod>` ISO quando presente. Codificar cada segmento com `encodeURIComponent`, escapar XML e responder `application/xml; charset=utf-8` com `public, max-age=900, stale-while-revalidate=3600`. Falhas retornam JSON 503 sem detalhes internos.

- [ ] **Step 5: Rodar os testes e confirmar sucesso**

Run: `node --test bot/test/public-site-handler.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commitar**

```bash
git add bot/public-site-handler.mjs bot/test/public-site-handler.test.mjs
git commit -m "feat: publish robots and dynamic sitemap"
```

### Task 7: Melhoria progressiva do frontend

**Files:**
- Modify: `site/app.js`
- Modify: `site/index.html`
- Modify: `bot/test/site-assets.test.mjs`

- [ ] **Step 1: Fixar por teste que o cliente preserva o HTML inicial**

Adicionar ao teste de assets:

```js
assert.match(script, /const hasServerRenderedOffers = elements\.grid\.querySelector\("\.offer-card"\) !== null/);
assert.match(script, /if \(!hasServerRenderedOffers \|\| hasInteractiveFilters\) await loadOffers\(\)/);
assert.doesNotMatch(script, /selectCategory\(initialCategory\);\s*$/);
assert.match(script, /href = `\/categoria\/\$\{category\.id\}`/);
assert.match(html, /id="offer-grid"/);
assert.match(html, /<noscript>/);
```

- [ ] **Step 2: Rodar o teste e confirmar que o cliente ainda força nova carga**

Run: `node --test bot/test/site-assets.test.mjs`

Expected: FAIL porque `app.js` chama `selectCategory(initialCategory)` no carregamento.

- [ ] **Step 3: Preservar SSR e carregar apenas quando necessário**

Depois de ler query string, definir:

```js
const hasServerRenderedOffers = elements.grid.querySelector(".offer-card") !== null;
const hasInteractiveFilters = Boolean(state.query || state.category || state.sort !== "recent");
await loadSiteConfig();
await loadCategories();
if (!hasServerRenderedOffers || hasInteractiveFilters) await loadOffers();
else elements.grid.setAttribute("aria-busy", "false");
```

Separar a ativação visual da categoria de `loadOffers()` para que o carregamento inicial não apague os cards SSR. Busca, ordenação, seleção e “carregar mais” continuam usando `/api/offers`.

- [ ] **Step 4: Gerar navegação rastreável sem perder os filtros interativos**

Em `loadCategories`, criar `<a class="category-chip">` com `href = `/categoria/${category.id}` e `data-category`. O listener deve interceptar somente clique primário sem teclas modificadoras; navegação normal, abrir em nova aba e ausência de JavaScript continuam funcionando. O link “Em alta” aponta para `/`.

- [ ] **Step 5: Alinhar o fallback estático**

Manter `site/index.html` como documento acessível para desenvolvimento/erro de dados, adicionar `<noscript><p>Ative o JavaScript para usar a busca interativa. As ofertas continuam disponíveis pelos links de categoria.</p></noscript>` e trocar chips que existirem no arquivo por links reais. O handler não deve mais usar este arquivo para `/` em produção.

- [ ] **Step 6: Rodar os testes de assets e handler**

Run: `node --test bot/test/site-assets.test.mjs bot/test/public-site-handler.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commitar**

```bash
git add site/app.js site/index.html bot/test/site-assets.test.mjs
git commit -m "feat: preserve server rendered offers in browser"
```

### Task 8: Origem canônica, documentação e verificação final

**Files:**
- Modify: `Caddyfile`
- Modify: `bot/test/site-assets.test.mjs`
- Modify: `README.md`

- [ ] **Step 1: Escrever teste do host canônico**

Adicionar ao teste de assets a leitura do `Caddyfile` e as asserções:

```js
const caddy = await readFile(new URL("../../Caddyfile", import.meta.url), "utf8");
assert.match(caddy, /www\.promomega\.com\.br\s*\{[\s\S]*redir https:\/\/promomega\.com\.br\{uri\} permanent/);
assert.match(caddy, /promomega\.com\.br\s*\{[\s\S]*import promomega_app/);
```

- [ ] **Step 2: Rodar e confirmar que `www` ainda compartilha o mesmo bloco**

Run: `node --test bot/test/site-assets.test.mjs`

Expected: FAIL porque `promomega.com.br, www.promomega.com.br` não redireciona.

- [ ] **Step 3: Separar os blocos do Caddy**

```caddy
promomega.com.br {
	import promomega_app
}

www.promomega.com.br {
	redir https://promomega.com.br{uri} permanent
}
```

Manter `:80` para acesso direto de diagnóstico e o subdomínio Evolution inalterado.

- [ ] **Step 4: Documentar operação e ciclo de vida SEO**

No `README.md`, documentar as rotas `/`, `/categoria/{slug}`, `/oferta/{nicho}/{itemId}`, `/ir/{nicho}/{itemId}`, `/robots.txt` e `/sitemap.xml`; registrar a regra “até 7 dias = indexável; depois = `noindex,follow`; destino ausente/inseguro = 410”; e incluir os comandos:

```bash
npm test
curl -fsS https://promomega.com.br/ | grep -E '<h1>|rel="canonical"|application/ld\+json'
curl -fsS https://promomega.com.br/robots.txt
curl -fsS https://promomega.com.br/sitemap.xml
curl -sI https://www.promomega.com.br/categoria/games
```

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`

Expected: exit code 0 e todos os testes PASS.

- [ ] **Step 6: Fazer validação local sem JavaScript**

Run: `docker compose up -d --build`

Run: `curl.exe -fsS http://localhost/`

Expected: o corpo contém H1, cards, links `/categoria/...`, links `/oferta/...`, canonical e JSON-LD sem depender de uma chamada posterior a `/api/offers`.

Run: `curl.exe -sI http://localhost/oferta/games/MLB1`

Expected: 200 para um item ativo existente; usar um `itemId` retornado pelo sitemap local quando `MLB1` não existir no banco.

- [ ] **Step 7: Validar XML, redirecionamento e segurança**

Run: `curl.exe -fsS http://localhost/robots.txt`

Expected: inclui `/api/`, `/ir/` e a URL absoluta do sitemap.

Run: `curl.exe -fsS http://localhost/sitemap.xml`

Expected: XML bem formado com apenas home, categorias não vazias e ofertas ativas.

Run: `curl.exe -sI -H "Host: www.promomega.com.br" http://127.0.0.1/categoria/games`

Expected: 308 com `Location: https://promomega.com.br/categoria/games`.

- [ ] **Step 8: Commitar**

```bash
git add Caddyfile bot/test/site-assets.test.mjs README.md
git commit -m "docs: finalize storefront SEO operations"
```

### Task 9: Checklist pós-deploy

**Files:**
- No repository changes.

- [ ] **Step 1: Fazer deploy pelo procedimento já documentado no projeto**

Executar o fluxo de produção somente depois de `npm test` e do smoke test local passarem. Não copiar cookies, chaves ou credenciais para logs, commits ou comandos registrados no plano.

- [ ] **Step 2: Confirmar respostas públicas**

Run: `curl -fsS https://promomega.com.br/ | grep -E '<h1>|rel="canonical"|application/ld\+json'`

Expected: os três padrões aparecem no HTML inicial.

Run: `curl -sI https://www.promomega.com.br/`

Expected: redirecionamento permanente para `https://promomega.com.br/`.

Run: `curl -fsS https://promomega.com.br/robots.txt && curl -fsS https://promomega.com.br/sitemap.xml`

Expected: ambos respondem 200 e usam URLs HTTPS do host sem `www`.

- [ ] **Step 3: Validar uma oferta em ferramentas oficiais**

Abrir uma URL ativa do sitemap no [Rich Results Test](https://search.google.com/test/rich-results) e confirmar que `Product`, `Offer` e `BreadcrumbList` são detectados sem erros críticos. Depois enviar `https://promomega.com.br/sitemap.xml` no Google Search Console e solicitar indexação da home, de uma categoria e de uma oferta ativa.

- [ ] **Step 4: Observar o primeiro ciclo de sete dias**

Confirmar que uma oferta ativa aparece no sitemap, que ao ultrapassar sete dias continua acessível com `noindex,follow` e que `/ir/...` deixa de redirecioná-la. Confirmar também que as APIs públicas e o envio automático de WhatsApp continuam operando sem regressão.
