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

test("lists only published offers using bounded parameterized filters", async () => {
  const db = database([[{
    niche_id: "games", item_id: "MLB1", title: "Controle", price: "379.90",
    original_price: "499.90", image_url: "https://http2.mlstatic.com/a.jpg",
    published_at: "2026-09-12T12:00:00Z", total_count: "1",
  }]]);
  const result = await new PublicOffersStore(db).list({ query: "controle", category: "games", sort: "discount", page: 2, limit: 500 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].redirectUrl, "/oferta/games/MLB1");
  assert.match(db.calls[0].text, /offer_publications/);
  assert.match(db.calls[0].text, /state\s*=\s*'published'/);
  assert.deepEqual(db.calls[0].values, ["%controle%", "games", 48, 48]);
  assert.ok(!db.calls[0].text.includes("controle"));
});

test("returns populated categories, destination, and records an anonymous click", async () => {
  const db = database([
    [{ id: "games", count: "3" }],
    [{ affiliate_url: "https://meli.la/abc" }],
    [],
  ]);
  const store = new PublicOffersStore(db);
  assert.deepEqual(await store.categories(), [{ id: "games", count: 3 }]);
  assert.equal(await store.findDestination("games", "MLB1"), "https://meli.la/abc");
  await store.recordClick("games", "MLB1", "request-id", "google.com");
  assert.match(db.calls[2].text, /INSERT INTO promonet\.offer_clicks/);
  assert.deepEqual(db.calls[2].values, ["games", "MLB1", "request-id", "google.com"]);
});
