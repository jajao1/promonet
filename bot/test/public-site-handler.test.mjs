import test from "node:test";
import assert from "node:assert/strict";
import { publicSiteHandler } from "../public-site-handler.mjs";

function response() {
  return { status: 0, headers: {}, body: "", writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(body = "") { this.body = body; } };
}

test("serves bounded offer queries and categories as public JSON", async () => {
  let options;
  const store = {
    list: async (value) => { options = value; return { items: [], total: 0, page: value.page, limit: value.limit }; },
    categories: async () => [{ id: "games", count: 2 }],
  };
  const handler = publicSiteHandler({ store });
  const offers = response();
  assert.equal(await handler({ method: "GET", url: "/api/offers?q=controle&category=games&sort=discount&page=2&limit=500" }, offers), true);
  assert.equal(offers.status, 200);
  assert.deepEqual(options, { query: "controle", category: "games", sort: "discount", page: 2, limit: 48 });
  assert.equal(offers.headers["content-type"], "application/json; charset=utf-8");
  const categories = response();
  await handler({ method: "GET", url: "/api/categories" }, categories);
  assert.deepEqual(JSON.parse(categories.body), { categories: [{ id: "games", count: 2 }] });
});

test("exposes only a valid WhatsApp group invite in public site config", async () => {
  const valid = response();
  await publicSiteHandler({
    store: {},
    siteConfig: { whatsAppGroupUrl: "https://chat.whatsapp.com/H2mx04zJYff3fTVJMqp8Uu" },
  })({ method: "GET", url: "/api/site-config" }, valid);
  assert.equal(valid.status, 200);
  assert.deepEqual(JSON.parse(valid.body), { whatsAppGroupUrl: "https://chat.whatsapp.com/H2mx04zJYff3fTVJMqp8Uu" });

  const invalid = response();
  await publicSiteHandler({
    store: {},
    siteConfig: { whatsAppGroupUrl: "https://evil.example/steal" },
  })({ method: "GET", url: "/api/site-config" }, invalid);
  assert.deepEqual(JSON.parse(invalid.body), { whatsAppGroupUrl: "" });
});

test("rejects invalid public query parameters", async () => {
  const handler = publicSiteHandler({ store: {} });
  for (const url of ["/api/offers?sort=price", "/api/offers?page=0", "/api/offers?category=../../x", `/api/offers?q=${"x".repeat(101)}`]) {
    const res = response();
    await handler({ method: "GET", url }, res);
    assert.equal(res.status, 400);
  }
});

test("returns fixed missing, unsafe, and unavailable responses", async () => {
  for (const [store, expected] of [
    [{ findOfferPage: async () => null }, 404],
    [{ findOfferPage: async () => ({ status: "active", affiliateUrl: "https://evil.example/x" }) }, 410],
    [{ list: async () => { throw Error("secret database detail"); } }, 503],
  ]) {
    const res = response();
    const url = expected === 503 ? "/api/offers" : "/oferta/games/MLB1";
    await publicSiteHandler({ store })({ method: "GET", url, headers: {} }, res);
    assert.equal(res.status, expected);
    assert.doesNotMatch(res.body, /secret|database detail/);
  }
});

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

test("returns false for routes it does not own", async () => {
  assert.equal(await publicSiteHandler({ store: {} })({ method: "POST", url: "/webhooks/evolution" }, response()), false);
});

test("serves allowlisted storefront assets with content type and cache policy", async () => {
  const handler = publicSiteHandler({ store: {} });
  const page = response();
  assert.equal(await handler({ method: "GET", url: "/index.html" }, page), true);
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.equal(page.headers["cache-control"], "no-cache");
  assert.ok(page.headers.etag);
  assert.match(String(page.body), /PromoMega/i);
  const css = response();
  await handler({ method: "GET", url: "/styles.css" }, css);
  assert.equal(css.status, 200);
  assert.match(css.headers["content-type"], /text\/css/);
  assert.match(css.headers["cache-control"], /max-age/);
  const logo = response();
  await handler({ method: "GET", url: "/logo.jpg" }, logo);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers["content-type"], "image/jpeg");
});

test("does not expose unknown files or traversal paths", async () => {
  const handler = publicSiteHandler({ store: {} });
  for (const url of ["/missing.css", "/../secrets/meli-session.json", "/%2e%2e/secrets/meli-session.json"]) {
    const res = response();
    assert.equal(await handler({ method: "GET", url }, res), true);
    assert.equal(res.status, 404);
    assert.doesNotMatch(String(res.body), /cookie|csrf|session/i);
  }
});
