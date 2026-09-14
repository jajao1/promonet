import test from "node:test";
import assert from "node:assert/strict";
import { ConversionStore } from "../store.mjs";

test("initializes a constrained durable conversion queue", async () => {
  const calls = [];
  await new ConversionStore({ query: async (...args) => { calls.push(args); return { rows: [] }; } }).init();
  const sql = calls[0][0];
  assert.match(sql, /affiliate_conversions/);
  assert.match(sql, /awaiting_confirmation/);
  assert.match(sql, /UNIQUE\s*\(source_id\)/i);
});

test("enqueues idempotently and claims serially", async () => {
  const calls = [];
  const db = { query: async (...args) => { calls.push(args); return { rows: [{ id: 1 }] }; } };
  const store = new ConversionStore(db);
  assert.equal(await store.enqueue({ sourceId: "manual-1", url: "https://produto.mercadolivre.com.br/MLB-1234567890-item", tag: "vijo3432338" }), 1);
  await store.claim();
  assert.match(calls[0][0], /ON CONFLICT\s*\(source_id\)/i);
  assert.match(calls[1][0], /FOR UPDATE SKIP LOCKED/i);
});

test("uses fixed state transitions and confirmed cache", async () => {
  const calls = [];
  const db = { query: async (...args) => { calls.push(args); return { rows: [] }; } };
  const store = new ConversionStore(db);
  await store.generated(1, "https://meli.la/AbC123");
  await store.confirm(1);
  await store.reject(2);
  await store.block(3, "blocked_auth");
  await store.cached("https://produto.mercadolivre.com.br/MLB-1234567890-item", "vijo3432338");
  assert.deepEqual(calls[0][1], [1, "https://meli.la/AbC123"]);
  assert.match(calls[1][0], /confirmed/);
  assert.match(calls[2][0], /review/);
  assert.deepEqual(calls[3][1], [3, "blocked_auth"]);
  assert.match(calls[4][0], /status='confirmed'/);
});

test("recovery quarantines interrupted conversions", async () => {
  let sql;
  await new ConversionStore({ query: async (value) => { sql = value; return { rows: [] }; } }).recover();
  assert.match(sql, /SET status='review'/);
  assert.match(sql, /status='processing'/);
});
