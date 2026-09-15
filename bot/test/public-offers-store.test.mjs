import test from "node:test";
import assert from "node:assert/strict";
import { PublicOffersStore } from "../public-offers-store.mjs";

function database(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, values = []) {
      calls.push({ text, values });
      return { rows: rows.shift() ?? [] };
    },
  };
}

test("initializes anonymous click storage without personal identifiers", async () => {
  const db = database();
  await new PublicOffersStore(db).init();
  assert.match(db.calls[0].text, /CREATE TABLE IF NOT EXISTS promonet\.offer_clicks/);
  assert.doesNotMatch(db.calls[0].text, /ip_address|user_agent|fingerprint/i);
});

test("lists only recent published offers using bounded parameterized filters", async () => {
  const db = database([[{
    niche_id: "games", item_id: "MLB1", title: "Controle", price: "379.90",
    original_price: "499.90", image_url: "https://http2.mlstatic.com/a.jpg",
    published_at: "2026-09-12T12:00:00Z", total_count: "1",
  }]]);
  const result = await new PublicOffersStore(db, { now: () => new Date("2026-09-14T12:00:00Z") }).list({ query: "controle", category: "games", sort: "discount", page: 2, limit: 500 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].redirectUrl, "/oferta/games/MLB1");
  assert.match(db.calls[0].text, /offer_publications/);
  assert.match(db.calls[0].text, /state\s*=\s*'published'/);
  assert.deepEqual(db.calls[0].values, ["%controle%", "games", new Date("2026-09-07T12:00:00Z"), 48, 48]);
  assert.match(db.calls[0].text, /published_at\s*>=\s*\$3/);
  assert.ok(!db.calls[0].text.includes("controle"));
});

test("returns populated categories, destination, and records an anonymous click", async () => {
  const db = database([
    [{ id: "games", count: "3" }],
    [{ affiliate_url: "https://meli.la/abc" }],
    [],
  ]);
  const store = new PublicOffersStore(db);
  assert.deepEqual(await store.categories(), [{ id: "games", slug: "games", name: "Games", count: 3 }]);
  assert.equal(await store.findDestination("games", "MLB1"), "https://meli.la/abc");
  await store.recordClick("games", "MLB1", "request-id", "google.com");
  assert.match(db.calls[2].text, /INSERT INTO promonet\.offer_clicks/);
  assert.deepEqual(db.calls[2].values, ["games", "MLB1", "request-id", "google.com"]);
});

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
  assert.deepEqual(await store.listSitemapCategories(), [{ slug: "games", lastModified: "2026-09-13T12:00:00.000Z" }]);
  assert.deepEqual(await store.listSitemapOffers(), [{ category: "games", itemId: "MLB1", lastModified: "2026-09-13T12:00:00.000Z" }]);
  assert.match(db.calls[1].text, /published_at\s*>=\s*\$1/);
  assert.match(db.calls[0].text, /JOIN promonet\.offer_previews/);
  assert.match(db.calls[1].text, /JOIN promonet\.offer_previews/);
  assert.match(db.calls[1].text, /state\s*=\s*'published'/);
});

test("maps internal niche ids to stable Portuguese public slugs", async () => {
  const db = database([
    [{ niche_id: "clothing", item_id: "MLB9", title: "Camiseta", price: "199", original_price: "299", image_url: null, published_at: "2026-09-14T12:00:00Z", total_count: "1" }],
    [{ niche_id: "fashion-accessories", latest_at: "2026-09-14T12:00:00Z" }],
    [{ id: "fashion-accessories", count: "2" }],
  ]);
  const store = new PublicOffersStore(db, { now: () => new Date("2026-09-14T12:00:00Z") });
  const [offer] = (await store.list()).items;
  assert.equal(offer.category, "roupas");
  assert.equal(offer.redirectUrl, "/oferta/roupas/MLB9");
  assert.equal((await store.listSitemapCategories())[0].slug, "acessorios-de-moda");
  assert.deepEqual(await store.categories(), [{ id: "acessorios-de-moda", slug: "acessorios-de-moda", name: "Acessórios de Moda", count: 2 }]);
});

test("translates a public fashion slug before filtering database niches", async () => {
  const db = database([[]]);
  await new PublicOffersStore(db).list({ category: "roupas" });
  assert.equal(db.calls[0].values[1], "clothing");
});

test("omits unmapped internal niches instead of exposing dead public routes",async()=>{
  const row={niche_id:"unknown",item_id:"MLBX",title:"Unknown",price:"10",original_price:"20",published_at:"2026-09-14T12:00:00Z",total_count:"1"};
  const db=database([
    [row],
    [{id:"unknown",count:"1"}],
    [{niche_id:"unknown",latest_at:"2026-09-14T12:00:00Z"}],
    [{niche_id:"unknown",item_id:"MLBX",published_at:"2026-09-14T12:00:00Z"}],
  ]);
  const store=new PublicOffersStore(db,{now:()=>new Date("2026-09-14T12:00:00Z")});
  assert.deepEqual(await store.list(),{items:[],total:0,page:1,limit:24});
  assert.deepEqual(await store.categories(),[]);
  assert.deepEqual(await store.listSitemapCategories(),[]);
  assert.deepEqual(await store.listSitemapOffers(),[]);
});
