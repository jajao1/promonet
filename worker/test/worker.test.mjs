import test from "node:test";
import assert from "node:assert/strict";
import { AffiliateWorker } from "../worker.mjs";

const item = { id: 1, canonical_url: "https://produto.mercadolivre.com.br/MLB-1234567890-item", tag: "vijo3432338" };

test("generates one item and waits for confirmation", async () => {
  const calls = [];
  const store = { claim: async () => item, cached: async () => null, generated: async (...args) => calls.push(args), block: async () => {} };
  const worker = new AffiliateWorker({ store, page: { generate: async () => "https://meli.la/AbC123" } });
  assert.deepEqual(await worker.once(), { state: "awaiting_confirmation", id: 1, url: item.canonical_url, affiliateUrl: "https://meli.la/AbC123" });
  assert.deepEqual(calls, [[1, "https://meli.la/AbC123"]]);
});

test("reuses confirmed cache without opening the page", async () => {
  let pageCalls = 0;
  const store = { claim: async () => item, cached: async () => "https://meli.la/Cached", generated: async () => {}, block: async () => {} };
  const result = await new AffiliateWorker({ store, page: { generate: async () => { pageCalls++; } } }).once();
  assert.equal(result.affiliateUrl, "https://meli.la/Cached");
  assert.equal(pageCalls, 0);
});

test("opens the circuit after three consecutive UI failures", async () => {
  const blocked = [];
  const store = { claim: async () => item, cached: async () => null, generated: async () => {}, block: async (...args) => blocked.push(args) };
  const worker = new AffiliateWorker({ store, page: { generate: async () => { throw Error("ui_changed"); } } });
  assert.equal((await worker.once()).state, "review");
  assert.equal((await worker.once()).state, "review");
  assert.equal((await worker.once()).state, "review");
  assert.deepEqual(await worker.once(), { state: "circuit_open" });
  assert.deepEqual(blocked[0], [1, "ui_changed"]);
});

test("pauses authentication without retry", async () => {
  const blocked = [];
  const store = { claim: async () => item, cached: async () => null, generated: async () => {}, block: async (...args) => blocked.push(args) };
  const result = await new AffiliateWorker({ store, page: { generate: async () => { throw Error("authentication_required"); } } }).once();
  assert.equal(result.state, "blocked_auth");
  assert.deepEqual(blocked, [[1, "blocked_auth"]]);
});
