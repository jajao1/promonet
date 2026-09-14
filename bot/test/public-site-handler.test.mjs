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

test("records a click and redirects only to approved marketplace hosts", async () => {
  const clicks = [];
  const handler = publicSiteHandler({ store: {
    findDestination: async () => "https://meli.la/abc",
    recordClick: async (...args) => clicks.push(args),
  }, randomUUID: () => "request-id" });
  const res = response();
  await handler({ method: "GET", url: "/oferta/games/MLB1", headers: { referer: "https://www.google.com/search?q=x" } }, res);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "https://meli.la/abc");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(clicks[0], ["games", "MLB1", "request-id", "www.google.com"]);
});

test("returns fixed missing, unsafe, and unavailable responses", async () => {
  for (const [store, expected] of [
    [{ findDestination: async () => null }, 404],
    [{ findDestination: async () => "https://evil.example/x" }, 410],
    [{ list: async () => { throw Error("secret database detail"); } }, 503],
  ]) {
    const res = response();
    const url = expected === 503 ? "/api/offers" : "/oferta/games/MLB1";
    await publicSiteHandler({ store })({ method: "GET", url, headers: {} }, res);
    assert.equal(res.status, expected);
    assert.doesNotMatch(res.body, /secret|database detail/);
  }
});

test("returns false for routes it does not own", async () => {
  assert.equal(await publicSiteHandler({ store: {} })({ method: "POST", url: "/webhooks/evolution" }, response()), false);
});

test("serves allowlisted storefront assets with content type and cache policy", async () => {
  const handler = publicSiteHandler({ store: {} });
  const page = response();
  assert.equal(await handler({ method: "GET", url: "/" }, page), true);
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.equal(page.headers["cache-control"], "no-cache");
  assert.ok(page.headers.etag);
  assert.match(String(page.body), /PromoNet/i);
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
