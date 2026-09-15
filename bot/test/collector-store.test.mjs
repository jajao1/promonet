import test from "node:test";
import assert from "node:assert/strict";
import { CollectorStore } from "../collector-store.mjs";

const RESERVATION_A = "11111111-1111-4111-8111-111111111111";
const RESERVATION_B = "22222222-2222-4222-8222-222222222222";
const ROUND_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_1 = "item:MLB1";
const ITEM_2 = "item:MLB2";
const PRODUCT = `product:${"a".repeat(64)}`;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class BehavioralDatabase {
  constructor(rows = []) {
    this.identities = new Map(rows.map((row) => [row.identity_key, { ...row }]));
    this.incidents = new Map();
    this.rounds = [];
    this.calls = [];
    this.locks = new Map();
    this.failNextReservationInsert = false;
  }

  async connect() {
    return new BehavioralClient(this);
  }

  async query(sql, args = []) {
    this.calls.push({ sql, args, client: false });
    if (/SELECT DISTINCT identity_key/i.test(sql)) {
      const cutoff = Date.now() - args[0] * 24 * 60 * 60 * 1_000;
      return {
        rows: [...this.identities.values()]
          .filter((row) => row.published_at && new Date(row.published_at).getTime() >= cutoff)
          .map((row) => ({ identity_key: row.identity_key })),
      };
    }
    if (/UPDATE promonet\.offer_identity_keys[\s\S]*published_at=now\(\)/i.test(sql)) {
      let count = 0;
      for (const [key, row] of this.identities) {
        if (row.reservation_id === args[0] && !row.published_at) {
          this.identities.set(key, {
            ...row,
            published_at: new Date(),
            reservation_id: null,
            reserved_until: null,
          });
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (/DELETE FROM promonet\.offer_identity_keys/i.test(sql)) {
      let count = 0;
      for (const [key, row] of this.identities) {
        if (row.reservation_id === args[0] && !row.published_at) {
          this.identities.delete(key);
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (/INSERT INTO promonet\.collector_rounds/i.test(sql)) {
      this.rounds.push({ roundId: args[0], metrics: JSON.parse(args[2]), startedAt: args[1] });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO promonet\.collector_incidents/i.test(sql)) {
      const current = this.incidents.get(args[0]);
      if (current?.active) return { rows: [], rowCount: 0 };
      this.incidents.set(args[0], { active: true });
      return { rows: [{ incident_key: args[0] }], rowCount: 1 };
    }
    if (/UPDATE promonet\.collector_incidents/i.test(sql)) {
      const current = this.incidents.get(args[0]);
      if (current) this.incidents.set(args[0], { ...current, active: false });
      return { rows: [], rowCount: current?.active ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  async acquire(key, client) {
    while (this.locks.has(key) && this.locks.get(key).client !== client) {
      await this.locks.get(key).released.promise;
    }
    if (!this.locks.has(key)) this.locks.set(key, { client, released: deferred() });
  }

  release(client) {
    for (const [key, lock] of this.locks) {
      if (lock.client === client) {
        this.locks.delete(key);
        lock.released.resolve();
      }
    }
  }
}

class BehavioralClient {
  constructor(db) {
    this.db = db;
    this.pending = new Map();
    this.inTransaction = false;
  }

  view(key) {
    if (this.pending.has(key)) return this.pending.get(key);
    return this.db.identities.get(key);
  }

  async query(sql, args = []) {
    this.db.calls.push({ sql, args, client: true });
    if (sql === "BEGIN") {
      this.inTransaction = true;
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      for (const [key, row] of this.pending) {
        if (row === null) this.db.identities.delete(key);
        else this.db.identities.set(key, row);
      }
      this.pending.clear();
      this.inTransaction = false;
      this.db.release(this);
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      this.pending.clear();
      this.inTransaction = false;
      this.db.release(this);
      return { rows: [] };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) {
      await this.db.acquire(args[0], this);
      return { rows: [] };
    }
    if (/DELETE FROM promonet\.offer_identity_keys/i.test(sql)) {
      const now = Date.now();
      for (const key of args[0]) {
        const row = this.view(key);
        if (row && !row.published_at && new Date(row.reserved_until).getTime() <= now) {
          this.pending.set(key, null);
        }
      }
      return { rows: [] };
    }
    if (/SELECT identity_key[\s\S]*FROM promonet\.offer_identity_keys/i.test(sql)) {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1_000;
      const now = Date.now();
      const rows = args[0]
        .map((key) => this.view(key))
        .filter((row) => row && (
          (row.published_at && new Date(row.published_at).getTime() >= cutoff) ||
          (row.reservation_id && new Date(row.reserved_until).getTime() > now)
        ))
        .map((row) => ({ identity_key: row.identity_key }));
      return { rows };
    }
    if (/INSERT INTO promonet\.offer_identity_keys/i.test(sql)) {
      if (this.db.failNextReservationInsert) {
        this.db.failNextReservationInsert = false;
        throw Error("simulated_insert_failure");
      }
      for (const key of args[0]) {
        this.pending.set(key, {
          identity_key: key,
          reservation_id: args[1],
          reserved_until: new Date(Date.now() + 10 * 60 * 1_000),
          published_at: null,
          niche_id: args[2],
          item_id: args[3],
        });
      }
      return { rows: args[0].map((identity_key) => ({ identity_key })), rowCount: args[0].length };
    }
    return { rows: [] };
  }

  release() {
    assert.equal(this.inTransaction, false, "client released with an open transaction");
  }
}

test("creates durable collector schema and saves previews without secrets", async () => {
  const calls = [];
  const db = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: [] }; } };
  const store = new CollectorStore(db);
  await store.init();
  await store.savePreview("games", {
    itemId: "MLB1",
    title: "Console",
    price: 100,
    originalPrice: 150,
    imageUrl: "https://http2.mlstatic.com/a.jpg",
    permalink: "https://produto.mercadolivre.com.br/MLB-1",
  }, "simulated");
  const schema = calls[0].sql;
  assert.match(schema, /collector_runs/);
  assert.match(schema, /offer_previews/);
  assert.match(schema, /offer_publications/);
  assert.match(schema, /offer_identity_keys[\s\S]*identity_key TEXT PRIMARY KEY/i);
  assert.match(schema, /reserved_until TIMESTAMPTZ/i);
  assert.match(schema, /collector_rounds[\s\S]*metrics JSONB NOT NULL/i);
  assert.match(schema, /collector_incidents[\s\S]*active BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS[\s\S]*published_at/i);
  assert.doesNotMatch(JSON.stringify(calls), /token|cookie|csrf/i);
});

test("recent item ids remain global for seven days and publication is recorded", async () => {
  const calls = [];
  const db = { query: async (sql, args) => {
    calls.push({ sql, args });
    return sql.includes("SELECT DISTINCT item_id") ? { rows: [{ item_id: "MLB1" }] } : { rows: [] };
  } };
  const store = new CollectorStore(db);
  assert.deepEqual(await store.recentItemIds(), new Set(["MLB1"]));
  assert.doesNotMatch(calls[0].sql, /WHERE\s+niche_id\s*=/i);
  assert.deepEqual(calls[0].args ?? [], []);
  await store.markPublished("games", "MLB1", "https://meli.la/ours");
  assert.match(calls.at(-1).sql, /offer_publications/);
});

test("returns globally published identity keys inside a bounded parameterized retention window", async () => {
  const db = new BehavioralDatabase([
    { identity_key: ITEM_1, niche_id: "games", published_at: new Date(Date.now() - 2 * 86_400_000) },
    { identity_key: ITEM_2, niche_id: "tools", published_at: new Date(Date.now() - 8 * 86_400_000) },
  ]);
  const store = new CollectorStore(db);
  assert.deepEqual(await store.recentIdentityKeys(), new Set([ITEM_1]));
  const call = db.calls.at(-1);
  assert.deepEqual(call.args, [7]);
  assert.doesNotMatch(call.sql, /niche_id\s*=/i);
  assert.doesNotMatch(call.sql, /interval\s+'7 days'/i);
  for (const invalid of [0, 31, 1.5, "7", NaN]) {
    await assert.rejects(() => store.recentIdentityKeys(invalid), /invalid_retention_days/);
  }
});

test("only one of two concurrent overlapping reservations wins", async () => {
  const db = new BehavioralDatabase();
  const first = new CollectorStore(db).reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  });
  const second = new CollectorStore(db).reserveOffer([ITEM_2, PRODUCT], {
    nicheId: "tools", itemId: "MLB2", reservationId: RESERVATION_B,
  });
  const results = await Promise.all([first, second]);
  assert.equal(results.filter(Boolean).length, 1);
  const winner = results[0] ? RESERVATION_A : RESERVATION_B;
  assert.equal(db.identities.get(PRODUCT).reservation_id, winner);
  assert.equal(db.identities.size, 2);
});

test("reservation is all-or-nothing when any identity was recently published", async () => {
  const db = new BehavioralDatabase([
    { identity_key: PRODUCT, published_at: new Date(), reservation_id: null, reserved_until: null },
  ]);
  const store = new CollectorStore(db);
  assert.equal(await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), false);
  assert.equal(db.identities.has(ITEM_1), false);
  assert.equal(db.calls.at(-1).sql, "COMMIT");
  assert.equal(db.calls.some((call) => /INSERT INTO promonet\.offer_identity_keys/i.test(call.sql)), false);
});

test("reservation rolls back on failure and can be retried without a partial claim", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  db.failNextReservationInsert = true;
  await assert.rejects(() => store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), /simulated_insert_failure/);
  assert.equal(db.identities.size, 0);
  assert.equal(db.calls.some((call) => call.sql === "ROLLBACK"), true);
  assert.equal(await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), true);
});

test("confirmation publishes only after acknowledgement and release removes only unconfirmed keys", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  assert.equal(await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), true);
  assert.deepEqual(await store.recentIdentityKeys(), new Set());
  assert.equal(await store.confirmOffer(RESERVATION_A), true);
  assert.deepEqual(await store.recentIdentityKeys(), new Set([ITEM_1, PRODUCT]));
  assert.equal(await store.confirmOffer(RESERVATION_A), false);
  await store.releaseOffer(RESERVATION_A);
  assert.deepEqual(await store.recentIdentityKeys(), new Set([ITEM_1, PRODUCT]));

  assert.equal(await store.reserveOffer([ITEM_2], {
    nicheId: "tools", itemId: "MLB2", reservationId: RESERVATION_B,
  }), true);
  assert.equal(await store.releaseOffer(RESERVATION_B), true);
  assert.equal(db.identities.has(ITEM_2), false);
});

test("expired unconfirmed reservations are reclaimed", async () => {
  const db = new BehavioralDatabase([{
    identity_key: ITEM_1,
    reservation_id: RESERVATION_A,
    reserved_until: new Date(Date.now() - 1_000),
    published_at: null,
    niche_id: "games",
    item_id: "MLB1",
  }]);
  const store = new CollectorStore(db);
  assert.equal(await store.reserveOffer([ITEM_1, ITEM_1], {
    nicheId: "tools", itemId: "MLB2", reservationId: RESERVATION_B,
  }), true);
  assert.equal(db.identities.get(ITEM_1).reservation_id, RESERVATION_B);
  assert.equal(db.calls.filter((call) => /pg_advisory_xact_lock/i.test(call.sql)).length, 1);
  assert.match(db.calls.find((call) => /INSERT INTO promonet\.offer_identity_keys/i.test(call.sql)).sql, /interval '10 minutes'/i);
});

test("reservation inputs fail closed before opening a transaction", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  const options = { nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A };
  for (const keys of [[], ["unnamespaced"], ["secret:abc"], [ITEM_1, ""]]) {
    await assert.rejects(() => store.reserveOffer(keys, options), /invalid_identity_keys/);
  }
  for (const invalid of [
    { ...options, nicheId: "" },
    { ...options, itemId: "" },
    { ...options, reservationId: "not-a-uuid" },
  ]) {
    await assert.rejects(() => store.reserveOffer([ITEM_1], invalid), /invalid_/);
  }
  assert.equal(db.calls.length, 0);
});

test("records only fixed nonnegative integer metrics through parameters", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  const startedAt = new Date("2026-09-15T12:00:00.000Z");
  const summary = { discovered: 12, rejected: 4, skipped: 2, delivered: 5, failed: 1 };
  await store.recordRound(ROUND_ID, summary, startedAt);
  const call = db.calls.at(-1);
  assert.match(call.sql, /VALUES\(\$1,\$2,\$3::jsonb\)/i);
  assert.deepEqual(call.args, [ROUND_ID, startedAt, JSON.stringify(summary)]);
  assert.doesNotMatch(call.sql, /discovered|delivered|12|5/);
  for (const invalid of [
    { ...summary, accessToken: 1 },
    { ...summary, note: "secret" },
    { ...summary, failed: -1 },
    { ...summary, failed: 1.5 },
    { ...summary, failed: Infinity },
    { ...summary, failed: "1" },
    new Date(),
  ]) {
    await assert.rejects(() => store.recordRound(ROUND_ID, invalid, startedAt), /invalid_round_metrics/);
  }
  assert.equal(db.rounds.length, 1);
});

test("incident notification responsibility persists across store instances and resets", async () => {
  const db = new BehavioralDatabase();
  const first = new CollectorStore(db);
  const second = new CollectorStore(db);
  assert.equal(await first.beginIncident("meli_session"), true);
  assert.equal(await second.beginIncident("meli_session"), false);
  await first.resolveIncident("meli_session");
  await first.resolveIncident("meli_session");
  assert.equal(await second.beginIncident("meli_session"), true);
});

test("claims enabled due niches in persisted rotated order", async () => {
  const calls = [];
  const db = { query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes("collector_rotation")) return { rows: [{ vertical_cursor: 1 }] };
    return { rows: [{ niche_id: args[0] }] };
  } };
  const store = new CollectorStore(db);
  const niches = [
    { id: "technology", enabled: true, intervalMinutes: 5 },
    { id: "home", enabled: false, intervalMinutes: 5 },
    { id: "games", enabled: true, intervalMinutes: 5 },
    { id: "tools", enabled: true, intervalMinutes: 5 },
  ];
  assert.deepEqual((await store.claimDueNiches(niches)).map((niche) => niche.id), ["games", "tools", "technology"]);
  assert.deepEqual(calls.filter((call) => !call.sql.includes("collector_rotation")).map((call) => call.args[0]), ["technology", "games", "tools"]);
});

test("leaf rotation advances and wraps", async () => {
  let cursor = 0;
  const db = { query: async () => {
    const selected_cursor = cursor;
    cursor = (cursor + 1) % 2;
    return { rows: [{ selected_cursor }] };
  } };
  const store = new CollectorStore(db);
  const niche = { id: "tools", categoryIds: ["MLB10", "MLB20"] };
  assert.equal(await store.nextCategory(niche), "MLB10");
  assert.equal(await store.nextCategory(niche), "MLB20");
  assert.equal(await store.nextCategory(niche), "MLB10");
});
