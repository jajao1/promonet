import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { CollectorStore } from "../collector-store.mjs";

const RESERVATION_A = "11111111-1111-4111-8111-111111111111";
const RESERVATION_B = "22222222-2222-4222-8222-222222222222";
const ROUND_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_A = "44444444-4444-4444-8444-444444444444";
const CLAIM_B = "55555555-5555-4555-8555-555555555555";
const ITEM_1 = "item:MLB1";
const ITEM_2 = "item:MLB2";
const PRODUCT = `product:${"a".repeat(64)}`;
const COLLISION_URL_A = `url:${"ef72".padStart(64, "0")}`;
const COLLISION_URL_B = `url:${"14899".padStart(64, "0")}`;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class BehavioralDatabase {
  constructor(rows = [], { incidents = [], hasClaimTokenColumn = true } = {}) {
    this.identities = new Map(rows.map((row) => [row.identity_key, { ...row }]));
    this.publications = [];
    this.previews = new Map();
    this.incidents = new Map(incidents.map((row) => [row.incident_key, { ...row }]));
    this.hasClaimTokenColumn = hasClaimTokenColumn;
    this.rounds = [];
    this.calls = [];
    this.locks = new Map();
    this.failNextReservationInsert = false;
    this.failNextFinalizationInsert = false;
    this.failRollback = false;
    this.releases = [];
    this.now = new Date();
    this.nextLockDelay = null;
    this.throwAfterCommit = false;
    this.connections = 0;
  }

  async connect() {
    this.connections++;
    return new BehavioralClient(this);
  }

  delayNextLock() {
    const entered = deferred();
    const released = deferred();
    this.nextLockDelay = { entered, released };
    return {
      entered: entered.promise,
      release: (time) => {
        this.now = new Date(time);
        released.resolve();
      },
    };
  }

  async query(sql, args = []) {
    this.calls.push({ sql, args, client: false });
    if (/\$incident_claim_migration\$/i.test(sql)) {
      if (!this.hasClaimTokenColumn) {
        this.hasClaimTokenColumn = true;
        for (const [key, current] of this.incidents) {
          if (current.active) this.incidents.set(key, {
            ...current,
            active: false,
            notified_at: null,
            claim_until: null,
            claim_token: null,
          });
        }
      }
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT DISTINCT identity_key/i.test(sql)) {
      const cutoff = Date.now() - args[0] * 24 * 60 * 60 * 1_000;
      return {
        rows: [...this.identities.values()]
          .filter((row) =>
            (row.published_at && new Date(row.published_at).getTime() >= cutoff) ||
            (row.review_until && new Date(row.review_until).getTime() > this.now.getTime())
          )
          .map((row) => ({ identity_key: row.identity_key })),
      };
    }
    if (/UPDATE promonet\.offer_identity_keys[\s\S]*review_until=/i.test(sql)) {
      let count = 0;
      for (const [key, row] of this.identities) {
        if (row.reservation_id === args[0] && !row.published_at) {
          this.identities.set(key, {
            ...row,
            reservation_id: null,
            reserved_until: null,
            review_until: new Date(this.now.getTime() + args[1] * 86_400_000),
          });
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (/UPDATE promonet\.offer_identity_keys[\s\S]*reserved_until=now\(\)\+\(\$3 \* interval '1 day'\)/i.test(sql)) {
      const rows = args[1].map((key) => this.identities.get(key));
      if (rows.some((row) => !row || row.reservation_id !== args[0] || !row.reserved_until || row.reserved_until <= this.now)) {
        return { rows: [], rowCount: 0 };
      }
      for (const row of rows) row.reserved_until = new Date(this.now.getTime() + args[2] * 86_400_000);
      return { rows: rows.map((row) => ({ identity_key: row.identity_key })), rowCount: rows.length };
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
      const now = this.now.getTime();
      if (current?.active && (
        current.notified_at ||
        (current.claim_until && current.claim_until.getTime() > now)
      )) return { rows: [], rowCount: 0 };
      this.incidents.set(args[0], {
        active: true,
        notified_at: null,
        claim_until: new Date(now + args[2] * 1_000),
        claim_token: args[1],
      });
      return { rows: [{ claim_token: args[1] }], rowCount: 1 };
    }
    if (/UPDATE promonet\.collector_incidents[\s\S]*notified_at=now\(\)/i.test(sql)) {
      const current = this.incidents.get(args[0]);
      if (current?.active && !current.notified_at && current.claim_token === args[1]) {
        this.incidents.set(args[0], {
          ...current,
          notified_at: new Date(this.now),
          claim_until: null,
          claim_token: null,
        });
      }
      return { rows: [], rowCount: current?.active && !current.notified_at && current.claim_token === args[1] ? 1 : 0 };
    }
    if (/UPDATE promonet\.collector_incidents[\s\S]*active=false/i.test(sql)) {
      const current = this.incidents.get(args[0]);
      const ownsClaim = !/claim_token=\$2/i.test(sql) || current?.claim_token === args[1];
      if (current && ownsClaim) {
        this.incidents.set(args[0], {
          ...current,
          active: false,
          claim_until: null,
          claim_token: null,
        });
      }
      return { rows: [], rowCount: current?.active && ownsClaim ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  async acquire(key, client) {
    if (this.nextLockDelay) {
      const delay = this.nextLockDelay;
      this.nextLockDelay = null;
      delay.entered.resolve();
      await delay.released.promise;
    }
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
    this.pendingPublications = [];
    this.pendingPreviews = new Map();
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
      this.db.publications.push(...this.pendingPublications);
      for (const [key, row] of this.pendingPreviews) this.db.previews.set(key, row);
      this.pending.clear();
      this.pendingPublications = [];
      this.pendingPreviews.clear();
      this.inTransaction = false;
      this.db.release(this);
      if (this.db.throwAfterCommit) {
        this.db.throwAfterCommit = false;
        throw Error("commit_response_lost");
      }
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      if (this.db.failRollback) throw Error("simulated_rollback_failure");
      this.pending.clear();
      this.pendingPublications = [];
      this.pendingPreviews.clear();
      this.inTransaction = false;
      this.db.release(this);
      return { rows: [] };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) {
      await this.db.acquire(args.join(":"), this);
      return { rows: [] };
    }
    if (/clock_timestamp\(\)[\s\S]*reservation_now/i.test(sql)) {
      return { rows: [{ reservation_now: this.db.now }] };
    }
    if (/set_config\('lock_timeout'/i.test(sql)) {
      return { rows: [] };
    }
    if (/AS publication_finalized/i.test(sql)) {
      const [reservationId, nicheId, itemId, affiliateUrl, keys] = args;
      const publication = this.db.publications.some((row) =>
        row.reservationId === reservationId && row.nicheId === nicheId &&
        row.itemId === itemId && row.affiliateUrl === affiliateUrl
      );
      const preview = this.db.previews.get(`${nicheId}:${itemId}`);
      const identities = keys.every((key) => {
        const row = this.db.identities.get(key);
        return row?.niche_id === nicheId && row.item_id === itemId && row.published_at && !row.reservation_id;
      });
      const reservationCleared = ![...this.db.identities.values()].some((row) => row.reservation_id === reservationId);
      return { rows: [{ publication_finalized: Boolean(publication && preview?.state === "published" && identities && reservationCleared) }] };
    }
    if (/SELECT identity_key,niche_id,item_id[\s\S]*reservation_id=\$1::uuid[\s\S]*FOR UPDATE/i.test(sql)) {
      await this.db.acquire(`finalize:${args[0]}`, this);
      return {
        rows: [...this.db.identities.values()]
          .filter((row) => row.reservation_id === args[0] && !row.published_at)
          .map((row) => ({ identity_key: row.identity_key, niche_id: row.niche_id, item_id: row.item_id })),
      };
    }
    if (/UPDATE promonet\.offer_identity_keys[\s\S]*published_at=now\(\)[\s\S]*reservation_id=\$1::uuid/i.test(sql)) {
      let count = 0;
      for (const [key, row] of this.db.identities) {
        if (row.reservation_id === args[0] && !row.published_at) {
          this.pending.set(key, { ...row, published_at: new Date(this.db.now), reservation_id: null, reserved_until: null, review_until: null });
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (/INSERT INTO promonet\.offer_publications/i.test(sql)) {
      if (this.db.failNextFinalizationInsert) {
        this.db.failNextFinalizationInsert = false;
        throw Error("simulated_finalization_failure");
      }
      if (this.db.publications.some((row) => row.nicheId === args[1] && row.itemId === args[2])) return { rows: [], rowCount: 0 };
      this.pendingPublications.push({ reservationId: args[0], nicheId: args[1], itemId: args[2], affiliateUrl: args[3] });
      return { rows: [{ item_id: args[2] }], rowCount: 1 };
    }
    if (/UPDATE promonet\.offer_previews[\s\S]*state='published'/i.test(sql)) {
      const key = `${args[0]}:${args[1]}`;
      const current = this.db.previews.get(key);
      if (!current) return { rows: [], rowCount: 0 };
      this.pendingPreviews.set(key, { ...current, state: "published", affiliateUrl: args[2] });
      return { rows: [], rowCount: 1 };
    }
    if (/DELETE FROM promonet\.offer_identity_keys/i.test(sql)) {
      const now = new Date(args[1] ?? this.db.now).getTime();
      for (const key of args[0]) {
        const row = this.view(key);
        if (row && !row.published_at && row.reserved_until && new Date(row.reserved_until).getTime() <= now) {
          this.pending.set(key, null);
        }
      }
      return { rows: [] };
    }
    if (/SELECT identity_key[\s\S]*FROM promonet\.offer_identity_keys/i.test(sql)) {
      const now = new Date(args[1] ?? this.db.now).getTime();
      const cutoff = now - 7 * 24 * 60 * 60 * 1_000;
      const rows = args[0]
        .map((key) => this.view(key))
        .filter((row) => row && (
          (row.published_at && new Date(row.published_at).getTime() >= cutoff) ||
          (row.review_until && new Date(row.review_until).getTime() > now) ||
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
      const reservationNow = new Date(args[4] ?? this.db.now).getTime();
      for (const key of args[0]) {
        this.pending.set(key, {
          identity_key: key,
          reservation_id: args[1],
          reserved_until: new Date(reservationNow + 10 * 60 * 1_000),
          published_at: null,
          review_until: null,
          niche_id: args[2],
          item_id: args[3],
        });
      }
      return { rows: args[0].map((identity_key) => ({ identity_key })), rowCount: args[0].length };
    }
    return { rows: [] };
  }

  release(force = false) {
    this.db.releases.push(force);
    if (force) {
      this.pending.clear();
      this.pendingPublications = [];
      this.pendingPreviews.clear();
      this.inTransaction = false;
      this.db.release(this);
      return;
    }
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
  assert.match(schema, /offer_publications[\s\S]*reservation_id UUID/i);
  assert.match(schema, /offer_publications_reservation_id_idx/i);
  assert.match(schema, /offer_identity_keys[\s\S]*identity_key TEXT PRIMARY KEY/i);
  assert.doesNotMatch(schema, /\{1,256\}/);
  assert.match(schema, /length\(split_part\(identity_key,':',2\)\) BETWEEN 1 AND 256/i);
  assert.match(schema, /CONSTRAINT offer_identity_keys_identity_key_format_check/i);
  assert.match(schema, /offer_identity_keys_identity_key_check[\s\S]*DROP CONSTRAINT/i);
  assert.match(schema, /reserved_until TIMESTAMPTZ/i);
  assert.match(schema, /review_until TIMESTAMPTZ/i);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS review_until TIMESTAMPTZ/i);
  assert.match(schema, /collector_rounds[\s\S]*metrics JSONB NOT NULL/i);
  assert.match(schema, /collector_incidents[\s\S]*active BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(schema, /collector_incidents[\s\S]*claim_until TIMESTAMPTZ/i);
  assert.match(schema, /collector_incidents[\s\S]*claim_token UUID/i);
  assert.match(schema, /\$incident_claim_migration\$[\s\S]*ADD COLUMN IF NOT EXISTS claim_until/i);
  assert.match(schema, /\$incident_claim_migration\$[\s\S]*ADD COLUMN IF NOT EXISTS claim_token/i);
  assert.match(schema, /\$incident_claim_migration\$[\s\S]*UPDATE promonet\.collector_incidents[\s\S]*active=false[\s\S]*notified_at=NULL/i);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS[\s\S]*published_at/i);
  assert.doesNotMatch(JSON.stringify(calls.map(({ args }) => args)), /access.?token|cookie|csrf|secret/i);
});

test("creates and records idempotent twenty-minute offer metric snapshots", async () => {
  const calls = [];
  const db = { query: async (sql, args = []) => { calls.push({ sql, args }); return { rows: [], rowCount: 0 }; } };
  const store = new CollectorStore(db);
  await store.init();
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS promonet\.offer_metric_snapshots[\s\S]*PRIMARY KEY\(item_id,category_id,observed_at\)/i);
  assert.match(calls[0].sql, /offer_metric_snapshots_category_observed_idx/i);

  await store.recordOfferSnapshots("MLB23332", [{
    itemId: "MLB1", rank: 2, soldQuantity: 850, price: 100, originalPrice: 150,
    ratingAverage: 4.8, reviewCount: 240,
  }, { itemId: "", rank: 1 }], new Date("2026-09-15T12:07:00.000Z"));

  const insert = calls.find(({ sql }) => /INSERT INTO promonet\.offer_metric_snapshots/i.test(sql));
  assert.ok(insert);
  assert.match(insert.sql, /jsonb_to_recordset/i);
  assert.match(insert.sql, /ON CONFLICT\(item_id,category_id,observed_at\) DO UPDATE/i);
  assert.equal(insert.args[1], "MLB23332");
  assert.deepEqual(insert.args[2], new Date("2026-09-15T12:00:00.000Z"));
  assert.deepEqual(JSON.parse(insert.args[0]), [{
    itemId: "MLB1", rank: 2, soldQuantity: 850, price: 100, originalPrice: 150,
    ratingAverage: 4.8, reviewCount: 240,
  }]);
  await assert.rejects(() => store.recordOfferSnapshots("bad", [], new Date()), /invalid_category_id/);
  await assert.rejects(() => store.recordOfferSnapshots("MLB23332", [], new Date("invalid")), /invalid_observed_at/);
});

test("initialization backfills recent historical publications into every dedup identity", async () => {
  const publishedAt = new Date("2026-09-15T18:00:00.000Z");
  const calls = [];
  const db = { query: async (sql, args = []) => {
    calls.push({ sql, args });
    if (/SELECT DISTINCT ON \(publication\.niche_id,publication\.item_id\)/i.test(sql)) {
      return { rows: [{
        niche_id: "sneakers",
        item_id: "MLB27154049",
        title: "Tenis Olympikus Dynamic Masculino",
        product_url: "https://produto.mercadolivre.com.br/MLB-27154049-tenis",
        published_at: publishedAt,
      }] };
    }
    return { rows: [], rowCount: 0 };
  } };

  await new CollectorStore(db).init();

  const select = calls.find(({ sql }) => /SELECT DISTINCT ON \(publication\.niche_id,publication\.item_id\)/i.test(sql));
  const insert = calls.find(({ sql }) => /INSERT INTO promonet\.offer_identity_keys/i.test(sql) && /unnest/i.test(sql));
  assert.ok(select);
  assert.deepEqual(select.args, [7]);
  assert.match(select.sql, /publication\.published_at >= now\(\) - \(\$1 \* interval '1 day'\)/i);
  assert.ok(insert);
  assert.equal(insert.args[0].length, 3);
  assert.ok(insert.args[0].includes("item:MLB27154049"));
  assert.ok(insert.args[0].some((key) => /^url:[a-f0-9]{64}$/.test(key)));
  assert.ok(insert.args[0].some((key) => /^product:[a-f0-9]{64}$/.test(key)));
  assert.deepEqual(insert.args[1], ["sneakers", "sneakers", "sneakers"]);
  assert.deepEqual(insert.args[2], ["MLB27154049", "MLB27154049", "MLB27154049"]);
  assert.deepEqual(insert.args[3], [publishedAt, publishedAt, publishedAt]);
  assert.match(insert.sql, /ON CONFLICT\(identity_key\) DO UPDATE/i);
  assert.match(insert.sql, /GREATEST/i);
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

test("sets a bounded lock wait then uses one post-lock clock value for the whole lease decision", async () => {
  const db = new BehavioralDatabase();
  db.now = new Date("2026-09-15T12:00:00.000Z");
  const delayed = db.delayNextLock();
  const pending = new CollectorStore(db).reserveOffer([ITEM_1], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  });
  await delayed.entered;
  const freshNow = new Date("2026-09-15T12:00:04.000Z");
  delayed.release(freshNow);
  assert.equal(await pending, true);

  const clientCalls = db.calls.filter((call) => call.client);
  const timeoutIndex = clientCalls.findIndex((call) => /set_config\('lock_timeout'/i.test(call.sql));
  const lockIndex = clientCalls.findIndex((call) => /pg_advisory_xact_lock/i.test(call.sql));
  const clockIndex = clientCalls.findIndex((call) => /clock_timestamp\(\)/i.test(call.sql));
  const deleteIndex = clientCalls.findIndex((call) => /DELETE FROM promonet\.offer_identity_keys/i.test(call.sql));
  assert.deepEqual(clientCalls[timeoutIndex].args, ["5s"]);
  assert.ok(timeoutIndex > 0 && timeoutIndex < lockIndex);
  assert.ok(lockIndex < clockIndex && clockIndex < deleteIndex);
  assert.equal(clientCalls.filter((call) => /clock_timestamp\(\)/i.test(call.sql)).length, 1);

  const cleanup = clientCalls[deleteIndex];
  const conflict = clientCalls.find((call) => /SELECT identity_key[\s\S]*FROM promonet\.offer_identity_keys/i.test(call.sql));
  const insert = clientCalls.find((call) => /INSERT INTO promonet\.offer_identity_keys/i.test(call.sql));
  assert.equal(cleanup.args[1].getTime(), freshNow.getTime());
  assert.equal(conflict.args[1].getTime(), freshNow.getTime());
  assert.equal(insert.args[4].getTime(), freshNow.getTime());
  assert.equal(
    db.identities.get(ITEM_1).reserved_until.getTime(),
    new Date("2026-09-15T12:10:04.000Z").getTime(),
  );
});

test("locks a documented two-integer namespace in numeric physical order and deduplicates hash collisions", async () => {
  const db = new BehavioralDatabase();
  const keys = [ITEM_2, COLLISION_URL_B, PRODUCT, ITEM_1, COLLISION_URL_A];
  assert.equal(
    createHash("sha256").update(COLLISION_URL_A).digest().readInt32BE(),
    createHash("sha256").update(COLLISION_URL_B).digest().readInt32BE(),
  );
  assert.equal(await new CollectorStore(db).reserveOffer(keys, {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), true);

  const lockCalls = db.calls.filter((call) => /pg_advisory_xact_lock/i.test(call.sql));
  const expectedIds = [...new Set(keys.map((key) =>
    createHash("sha256").update(key).digest().readInt32BE()
  ))].sort((left, right) => left - right);
  assert.equal(lockCalls.length, expectedIds.length);
  assert.deepEqual(lockCalls.map((call) => call.args[1]), expectedIds);
  assert.equal(new Set(lockCalls.map((call) => call.args[0])).size, 1);
  assert.ok(lockCalls.every((call) => /\$1::integer\s*,\s*\$2::integer/i.test(call.sql)));
  assert.equal(db.identities.size, keys.length);
});

test("real PostgreSQL contention grants a fresh ten-minute lease after the lock wait", {
  skip: !process.env.PROMONET_TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PROMONET_TEST_DATABASE_URL, max: 3 });
  const blocker = await pool.connect();
  const key = `url:${createHash("sha256").update(randomUUID()).digest("hex")}`;
  const lockId = createHash("sha256").update(key).digest().readInt32BE();
  const reservationId = randomUUID();
  let blockerTransaction = false;
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS promonet");
    const store = new CollectorStore(pool);
    await store.init();
    await store.init();
    await blocker.query("BEGIN");
    blockerTransaction = true;
    await blocker.query(
      "SELECT pg_advisory_xact_lock($1::integer,$2::integer)",
      [0x50524f4d, lockId],
    );

    let settled = false;
    const reservation = store.reserveOffer([key], {
      nicheId: "integration", itemId: "MLB999999999", reservationId,
    }).finally(() => { settled = true; });
    let waiting = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      waiting = (await blocker.query(
        "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting",
      )).rows[0].waiting;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(waiting, true);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(settled, false);
    const releasedAt = (await blocker.query("SELECT clock_timestamp() AS released_at")).rows[0].released_at;
    await blocker.query("COMMIT");
    blockerTransaction = false;
    assert.equal(await reservation, true);

    const row = (await pool.query(
      "SELECT reserved_until FROM promonet.offer_identity_keys WHERE identity_key=$1",
      [key],
    )).rows[0];
    assert.ok(row.reserved_until.getTime() >= releasedAt.getTime() + 599_000);
    await store.releaseOffer(reservationId);
  } finally {
    if (blockerTransaction) await blocker.query("ROLLBACK");
    blocker.release();
    await pool.end();
  }
});

test("real PostgreSQL rolls back earlier due claims when a later claim fails", {
  skip: !process.env.PROMONET_TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PROMONET_TEST_DATABASE_URL });
  const suffix = randomUUID().replaceAll("-", "");
  const ids = [`atomic_first_${suffix}`, `atomic_second_${suffix}`];
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS promonet");
    const store = new CollectorStore(pool);
    await store.init();
    await assert.rejects(() => store.claimDueNiches([
      { id: ids[0], enabled: true, intervalMinutes: 5 },
      { id: ids[1], enabled: true, intervalMinutes: "invalid" },
    ]));
    const result = await pool.query(
      "SELECT niche_id FROM promonet.collector_runs WHERE niche_id=ANY($1::text[])",
      [ids],
    );
    assert.deepEqual(result.rows, []);
  } finally {
    await pool.query("DELETE FROM promonet.collector_runs WHERE niche_id=ANY($1::text[])", [ids]);
    await pool.end();
  }
});

test("real PostgreSQL init migrates only the legacy identity format constraint", {
  skip: !process.env.PROMONET_UPGRADE_TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PROMONET_UPGRADE_TEST_DATABASE_URL });
  const key = `url:${createHash("sha256").update(randomUUID()).digest("hex")}`;
  const reservationId = randomUUID();
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS promonet");
    await pool.query(`CREATE TABLE promonet.offer_identity_keys(
      identity_key TEXT PRIMARY KEY CHECK(identity_key ~ '^(item|url|product):[A-Za-z0-9._-]{1,256}$'),
      reservation_id UUID,
      reserved_until TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      niche_id TEXT,
      item_id TEXT,
      CHECK((reservation_id IS NULL) = (reserved_until IS NULL)),
      CONSTRAINT offer_identity_keys_unrelated_check CHECK(niche_id IS NULL OR length(niche_id)>0)
    )`);
    const before = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid='promonet.offer_identity_keys'::regclass AND contype='c'`,
    );
    assert.ok(before.rows.some((row) => row.conname === "offer_identity_keys_identity_key_check"));

    const store = new CollectorStore(pool);
    await store.init();
    await store.init();
    assert.equal(await store.reserveOffer([key], {
      nicheId: "upgrade", itemId: "MLB999999998", reservationId,
    }), true);
    const after = await pool.query(
      `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid='promonet.offer_identity_keys'::regclass AND contype='c'`,
    );
    assert.equal(
      after.rows.filter((row) => row.conname === "offer_identity_keys_identity_key_format_check").length,
      1,
    );
    assert.ok(after.rows.some((row) => row.conname === "offer_identity_keys_unrelated_check"));
    assert.ok(!after.rows.some((row) => row.conname === "offer_identity_keys_identity_key_check"));
    assert.ok(!after.rows.some((row) => row.definition.includes("{1,256}")));
    await store.releaseOffer(reservationId);
  } finally {
    await pool.end();
  }
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

test("destroys a checked-out client when rollback fails", async () => {
  const db = new BehavioralDatabase();
  db.failNextReservationInsert = true;
  db.failRollback = true;
  await assert.rejects(() => new CollectorStore(db).reserveOffer([ITEM_1], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), /simulated_insert_failure/);
  assert.deepEqual(db.releases, [true]);
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

test("finalizes identities publication and preview atomically with one concurrent winner", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  db.previews.set("games:MLB1", { state: "selected" });
  assert.equal(await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), true);

  const attempts = await Promise.all([
    store.finalizePublication(RESERVATION_A, "games", "MLB1", "https://meli.la/ours"),
    store.finalizePublication(RESERVATION_A, "games", "MLB1", "https://meli.la/ours"),
  ]);
  assert.deepEqual(attempts.sort(), [false, true]);
  assert.equal(db.publications.length, 1);
  assert.equal(db.previews.get("games:MLB1").state, "published");
  assert.ok([...db.identities.values()].every((row) => row.published_at && !row.reservation_id));
});

test("a fresh store instance sees finalized identities after a simulated process restart", async () => {
  const sharedDatabase = new BehavioralDatabase();
  const beforeRestart = new CollectorStore(sharedDatabase);
  sharedDatabase.previews.set("games:MLB1", { state: "selected" });
  assert.equal(await beforeRestart.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  }), true);
  assert.equal(await beforeRestart.finalizePublication(
    RESERVATION_A, "games", "MLB1", "https://meli.la/ours",
  ), true);

  const afterRestart = new CollectorStore(sharedDatabase);
  assert.deepEqual(await afterRestart.recentIdentityKeys(7), new Set([ITEM_1, PRODUCT]));
  assert.equal(await afterRestart.reserveOffer([ITEM_2, PRODUCT], {
    nicheId: "tools", itemId: "MLB2", reservationId: RESERVATION_B,
  }), false);
});

test("reconciles a committed finalization when the COMMIT response is lost", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  db.previews.set("games:MLB1", { state: "selected" });
  await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  });
  db.throwAfterCommit = true;
  await assert.rejects(
    () => store.finalizePublication(RESERVATION_A, "games", "MLB1", "https://meli.la/ours"),
    /commit_response_lost/,
  );
  const connectionsBeforeReconciliation = db.connections;
  assert.equal(await store.publicationFinalized(
    RESERVATION_A, "games", "MLB1", "https://meli.la/ours", [ITEM_1, PRODUCT],
  ), true);
  assert.equal(db.connections, connectionsBeforeReconciliation + 1);
  assert.ok(db.releases.includes(true));
  assert.equal(await store.publicationFinalized(
    RESERVATION_B, "games", "MLB1", "https://meli.la/ours", [ITEM_1, PRODUCT],
  ), false);
  assert.equal(db.previews.get("games:MLB1").state, "published");
});

test("finalization rolls back every write and poisons the client only when rollback fails", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  db.previews.set("games:MLB1", { state: "selected" });
  await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  });
  db.failNextFinalizationInsert = true;
  await assert.rejects(
    () => store.finalizePublication(RESERVATION_A, "games", "MLB1", "https://meli.la/ours"),
    /simulated_finalization_failure/,
  );
  assert.equal(db.publications.length, 0);
  assert.equal(db.previews.get("games:MLB1").state, "selected");
  assert.ok([...db.identities.values()].every((row) => !row.published_at && row.reservation_id === RESERVATION_A));
  assert.equal(db.releases.at(-1), false);

  db.failNextFinalizationInsert = true;
  db.failRollback = true;
  await assert.rejects(
    () => store.finalizePublication(RESERVATION_A, "games", "MLB1", "https://meli.la/ours"),
    /simulated_finalization_failure/,
  );
  assert.equal(db.releases.at(-1), true);
});

test("quarantines an ambiguous reservation for seven days without marking it published", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  });
  assert.equal(await store.quarantineOffer(RESERVATION_A), true);
  assert.deepEqual(await store.recentIdentityKeys(), new Set([ITEM_1, PRODUCT]));
  assert.ok([...db.identities.values()].every((row) => !row.published_at && !row.reservation_id && row.review_until));
  assert.equal(await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_B,
  }), false);
  db.now = new Date(db.now.getTime() + 8 * 86_400_000);
  assert.equal(await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_B,
  }), true);
});

test("rechecks every reserved identity and arms a seven-day hold immediately before delivery", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  await store.reserveOffer([ITEM_1, PRODUCT], {
    nicheId: "games", itemId: "MLB1", reservationId: RESERVATION_A,
  });
  assert.equal(await store.prepareDelivery(RESERVATION_A, [ITEM_1, PRODUCT]), true);
  assert.ok([...db.identities.values()].every((row) =>
    row.reserved_until.getTime() === db.now.getTime() + 7 * 86_400_000
  ));

  db.identities.get(PRODUCT).reservation_id = RESERVATION_B;
  assert.equal(await store.prepareDelivery(RESERVATION_A, [ITEM_1, PRODUCT]), false);
  assert.equal(db.identities.get(ITEM_1).reservation_id, RESERVATION_A);
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
  const summary = { discovered: 12, rejected: 4, rejectedUrl: 1, skipped: 2, delivered: 5, failed: 1 };
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
  await assert.rejects(
    () => store.recordRound(ROUND_ID, summary),
    /invalid_round_started_at/,
  );
  assert.equal(db.rounds.length, 1);
});

test("incident claims are concurrent, leased, and reclaimable after an unacknowledged crash", async () => {
  const db = new BehavioralDatabase();
  const first = new CollectorStore(db);
  const second = new CollectorStore(db);
  assert.deepEqual(
    await Promise.all([
      first.beginIncident("meli_session", CLAIM_A),
      second.beginIncident("meli_session", CLAIM_B),
    ]),
    [CLAIM_A, null],
  );
  const claim = db.incidents.get("meli_session");
  assert.equal(claim.active, true);
  assert.equal(claim.notified_at, null);
  assert.equal(claim.claim_token, CLAIM_A);
  assert.ok(claim.claim_until.getTime() > db.now.getTime());
  assert.equal(await second.beginIncident("meli_session", CLAIM_B), null);
  db.now = new Date(claim.claim_until.getTime() + 1);
  assert.equal(await second.beginIncident("meli_session", CLAIM_B), CLAIM_B);
  assert.equal(db.incidents.get("meli_session").claim_token, CLAIM_B);
});

test("acknowledged incidents stay suppressed until restoration", async () => {
  const db = new BehavioralDatabase();
  const first = new CollectorStore(db);
  const second = new CollectorStore(db);
  assert.equal(await first.beginIncident("meli_session", CLAIM_A), CLAIM_A);
  assert.equal(await first.markIncidentNotified("meli_session", CLAIM_A), true);
  const acknowledged = db.incidents.get("meli_session");
  assert.ok(acknowledged.notified_at instanceof Date);
  assert.equal(acknowledged.claim_until, null);
  assert.equal(acknowledged.claim_token, null);
  db.now = new Date(db.now.getTime() + 24 * 60 * 60 * 1_000);
  assert.equal(await second.beginIncident("meli_session", CLAIM_B), null);
  await first.resolveIncident("meli_session");
  await first.resolveIncident("meli_session");
  assert.equal(db.incidents.get("meli_session").claim_until, null);
  assert.equal(await second.beginIncident("meli_session", CLAIM_B), CLAIM_B);
});

test("stale claimants cannot acknowledge or abandon a reclaimed incident", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  assert.equal(await store.beginIncident("meli_session", CLAIM_A), CLAIM_A);
  db.now = new Date(db.incidents.get("meli_session").claim_until.getTime() + 1);
  assert.equal(await store.beginIncident("meli_session", CLAIM_B), CLAIM_B);
  assert.equal(await store.markIncidentNotified("meli_session", CLAIM_A), false);
  assert.equal(db.incidents.get("meli_session").claim_token, CLAIM_B);
  assert.equal(await store.abandonIncident("meli_session", CLAIM_A), false);
  assert.equal(db.incidents.get("meli_session").claim_token, CLAIM_B);
  assert.equal(db.incidents.get("meli_session").active, true);
  assert.equal(await store.markIncidentNotified("meli_session", CLAIM_B), true);
  assert.ok(db.incidents.get("meli_session").notified_at instanceof Date);
});

test("the current claimant alone can abandon an unacknowledged incident", async () => {
  const db = new BehavioralDatabase();
  const store = new CollectorStore(db);
  assert.equal(await store.beginIncident("meli_session", CLAIM_A), CLAIM_A);
  db.now = new Date(db.incidents.get("meli_session").claim_until.getTime() + 1);
  assert.equal(await store.beginIncident("meli_session", CLAIM_B), CLAIM_B);
  assert.equal(await store.abandonIncident("meli_session", CLAIM_A), false);
  assert.equal(await store.abandonIncident("meli_session", CLAIM_B), true);
  assert.equal(db.incidents.get("meli_session").active, false);
});

test("restoration clears a stale claim even when the incident is already inactive", async () => {
  const db = new BehavioralDatabase();
  db.incidents.set("meli_session", {
    active: false,
    notified_at: new Date(db.now),
    claim_until: new Date(db.now.getTime() + 60_000),
  });
  await new CollectorStore(db).resolveIncident("meli_session");
  assert.equal(db.incidents.get("meli_session").active, false);
  assert.equal(db.incidents.get("meli_session").claim_until, null);
});

test("legacy incident migration resets once and preserves later acknowledged incidents", async () => {
  const legacyNotification = new Date("2026-09-15T12:00:00.000Z");
  const db = new BehavioralDatabase([], {
    hasClaimTokenColumn: false,
    incidents: [{
      incident_key: "meli_session",
      active: true,
      notified_at: legacyNotification,
      claim_until: null,
    }],
  });
  const store = new CollectorStore(db);
  await store.init();
  assert.deepEqual(db.incidents.get("meli_session"), {
    incident_key: "meli_session",
    active: false,
    notified_at: null,
    claim_until: null,
    claim_token: null,
  });
  assert.equal(await store.beginIncident("meli_session", CLAIM_A), CLAIM_A);
  assert.equal(await store.markIncidentNotified("meli_session", CLAIM_A), true);
  const acknowledgedAt = db.incidents.get("meli_session").notified_at;
  await store.init();
  assert.equal(db.incidents.get("meli_session").active, true);
  assert.equal(db.incidents.get("meli_session").notified_at, acknowledgedAt);
});

test("real PostgreSQL incident leases recover crashes and suppress acknowledged notifications", {
  skip: !process.env.PROMONET_TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PROMONET_TEST_DATABASE_URL });
  const key = `meli_session_${randomUUID().replaceAll("-", "")}`;
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS promonet");
    const store = new CollectorStore(pool);
    await store.init();
    assert.equal(await store.beginIncident(key, CLAIM_A), CLAIM_A);
    assert.equal(await store.beginIncident(key, CLAIM_B), null);
    await pool.query(
      "UPDATE promonet.collector_incidents SET claim_until=now()-interval '1 second' WHERE incident_key=$1",
      [key],
    );
    assert.equal(await store.beginIncident(key, CLAIM_B), CLAIM_B);
    assert.equal(await store.markIncidentNotified(key, CLAIM_B), true);
    assert.equal(await store.beginIncident(key, CLAIM_A), null);
    await store.resolveIncident(key);
    assert.equal(await store.beginIncident(key, CLAIM_A), CLAIM_A);
  } finally {
    await pool.query("DELETE FROM promonet.collector_incidents WHERE incident_key=$1", [key]);
    await pool.end();
  }
});

test("real PostgreSQL migration resets legacy incidents once", {
  skip: !process.env.PROMONET_UPGRADE_TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PROMONET_UPGRADE_TEST_DATABASE_URL });
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("CREATE SCHEMA IF NOT EXISTS promonet");
    await client.query("DROP TABLE IF EXISTS promonet.collector_incidents");
    await client.query(`CREATE TABLE promonet.collector_incidents(
      incident_key TEXT PRIMARY KEY,
      active BOOLEAN NOT NULL DEFAULT false,
      notified_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(
      "INSERT INTO promonet.collector_incidents(incident_key,active,notified_at) VALUES($1,true,now())",
      ["meli_session"],
    );
    const store = new CollectorStore(client);
    await store.init();
    const migrated = (await client.query(
      "SELECT active,notified_at,claim_until,claim_token FROM promonet.collector_incidents WHERE incident_key=$1",
      ["meli_session"],
    )).rows[0];
    assert.deepEqual(migrated, {
      active: false,
      notified_at: null,
      claim_until: null,
      claim_token: null,
    });
    assert.equal(await store.beginIncident("meli_session", CLAIM_A), CLAIM_A);
    assert.equal(await store.markIncidentNotified("meli_session", CLAIM_A), true);
    await store.init();
    const acknowledged = (await client.query(
      "SELECT active,notified_at FROM promonet.collector_incidents WHERE incident_key=$1",
      ["meli_session"],
    )).rows[0];
    assert.equal(acknowledged.active, true);
    assert.ok(acknowledged.notified_at instanceof Date);
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});

class ClaimDatabase {
  constructor({ failClaimId = null, failRotation = false, failRollback = false, rotation = 0 } = {}) {
    this.failClaimId = failClaimId;
    this.failRotation = failRotation;
    this.failRollback = failRollback;
    this.rotation = rotation;
    this.runs = new Map();
    this.calls = [];
    this.releases = [];
  }

  execute(sql, args, pending = this.runs) {
    if (/INSERT INTO promonet\.collector_runs/i.test(sql)) {
      if (args[0] === this.failClaimId) throw Error("claim_failed");
      pending.set(args[0], "running");
      return { rows: [{ niche_id: args[0] }], rowCount: 1 };
    }
    if (/INSERT INTO promonet\.collector_rotation/i.test(sql)) {
      if (this.failRotation) throw Error("rotation_failed");
      return { rows: [{ vertical_cursor: this.rotation }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  async query(sql, args = []) {
    this.calls.push({ sql, args, client: false });
    return this.execute(sql, args);
  }

  async connect() {
    const database = this;
    const pending = new Map();
    let transactionOpen = false;
    return {
      async query(sql, args = []) {
        database.calls.push({ sql, args, client: true });
        if (sql === "BEGIN") { transactionOpen = true; return { rows: [] }; }
        if (sql === "COMMIT") {
          for (const [key, value] of pending) database.runs.set(key, value);
          transactionOpen = false;
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          if (database.failRollback) throw Error("rollback_failed");
          pending.clear();
          transactionOpen = false;
          return { rows: [] };
        }
        return database.execute(sql, args, pending);
      },
      release(force = false) {
        database.releases.push(force);
        if (!force) assert.equal(transactionOpen, false);
      },
    };
  }
}

test("due niche claims and rotation roll back atomically after any later failure", async () => {
  const niches = [
    { id: "tools", enabled: true, intervalMinutes: 5 },
    { id: "games", enabled: true, intervalMinutes: 5 },
    { id: "home", enabled: true, intervalMinutes: 5 },
  ];
  for (const failure of [{ failClaimId: "games" }, { failRotation: true }]) {
    const db = new ClaimDatabase(failure);
    await assert.rejects(() => new CollectorStore(db).claimDueNiches(niches), /(?:claim|rotation)_failed/);
    assert.equal(db.runs.size, 0);
    assert.ok(db.calls.every((call) => call.client));
    assert.deepEqual(db.releases, [false]);
  }
});

test("due claim rollback failure destroys the checked-out client", async () => {
  const db = new ClaimDatabase({ failRotation: true, failRollback: true });
  const niches = [
    { id: "tools", enabled: true, intervalMinutes: 5 },
    { id: "games", enabled: true, intervalMinutes: 5 },
  ];
  await assert.rejects(() => new CollectorStore(db).claimDueNiches(niches), /rotation_failed/);
  assert.equal(db.runs.size, 0);
  assert.deepEqual(db.releases, [true]);
});

test("claims enabled due niches in persisted rotated order", async () => {
  const db = new ClaimDatabase({ rotation: 1 });
  const store = new CollectorStore(db);
  const niches = [
    { id: "technology", enabled: true, intervalMinutes: 5 },
    { id: "home", enabled: false, intervalMinutes: 5 },
    { id: "games", enabled: true, intervalMinutes: 5 },
    { id: "tools", enabled: true, intervalMinutes: 5 },
  ];
  assert.deepEqual((await store.claimDueNiches(niches)).map((niche) => niche.id), ["games", "tools", "technology"]);
  assert.deepEqual(db.calls.filter((call) => /INSERT INTO promonet\.collector_runs/i.test(call.sql)).map((call) => call.args[0]), ["technology", "games", "tools"]);
  assert.ok(db.calls.every((call) => call.client));
  assert.deepEqual(db.releases, [false]);
});

test("claims exactly one enabled due niche in persisted rotation order", async () => {
  const db = new ClaimDatabase({ rotation: 1 });
  const store = new CollectorStore(db);
  const niches = [
    { id: "technology", enabled: true, intervalMinutes: 5 },
    { id: "home", enabled: false, intervalMinutes: 5 },
    { id: "games", enabled: true, intervalMinutes: 5 },
    { id: "tools", enabled: true, intervalMinutes: 5 },
  ];

  assert.equal((await store.claimDueNiche(niches)).id, "games");
  assert.deepEqual([...db.runs.keys()], ["games"]);
  assert.deepEqual(
    db.calls.filter((call) => /INSERT INTO promonet\.collector_runs/i.test(call.sql)).map((call) => call.args[0]),
    ["games"],
  );
  assert.ok(db.calls.every((call) => call.client));
  assert.deepEqual(db.releases, [false]);
});

test("single due niche claiming rolls back rotation and claims together", async () => {
  const db = new ClaimDatabase({ rotation: 1, failClaimId: "games" });
  const niches = [
    { id: "tools", enabled: true, intervalMinutes: 5 },
    { id: "games", enabled: true, intervalMinutes: 5 },
  ];

  await assert.rejects(() => new CollectorStore(db).claimDueNiche(niches), /claim_failed/);
  assert.equal(db.runs.size, 0);
  assert.ok(db.calls.every((call) => call.client));
  assert.deepEqual(db.releases, [false]);
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
