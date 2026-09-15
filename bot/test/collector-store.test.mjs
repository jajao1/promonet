import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { CollectorStore } from "../collector-store.mjs";

const RESERVATION_A = "11111111-1111-4111-8111-111111111111";
const RESERVATION_B = "22222222-2222-4222-8222-222222222222";
const ROUND_ID = "33333333-3333-4333-8333-333333333333";
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
  constructor(rows = []) {
    this.identities = new Map(rows.map((row) => [row.identity_key, { ...row }]));
    this.incidents = new Map();
    this.rounds = [];
    this.calls = [];
    this.locks = new Map();
    this.failNextReservationInsert = false;
    this.failRollback = false;
    this.releases = [];
    this.now = new Date();
    this.nextLockDelay = null;
  }

  async connect() {
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
      const now = this.now.getTime();
      if (current?.active && (
        current.notified_at ||
        (current.claim_until && current.claim_until.getTime() > now)
      )) return { rows: [], rowCount: 0 };
      this.incidents.set(args[0], {
        active: true,
        notified_at: null,
        claim_until: new Date(now + args[1] * 1_000),
      });
      return { rows: [{ incident_key: args[0] }], rowCount: 1 };
    }
    if (/UPDATE promonet\.collector_incidents[\s\S]*notified_at=now\(\)/i.test(sql)) {
      const current = this.incidents.get(args[0]);
      if (current?.active && !current.notified_at) {
        this.incidents.set(args[0], {
          ...current,
          notified_at: new Date(this.now),
          claim_until: null,
        });
      }
      return { rows: [], rowCount: current?.active && !current.notified_at ? 1 : 0 };
    }
    if (/UPDATE promonet\.collector_incidents[\s\S]*active=false/i.test(sql)) {
      const current = this.incidents.get(args[0]);
      if (current && (!/AND active=true/i.test(sql) || current.active)) {
        this.incidents.set(args[0], { ...current, active: false, claim_until: null });
      }
      return { rows: [], rowCount: current?.active ? 1 : 0 };
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
      if (this.db.failRollback) throw Error("simulated_rollback_failure");
      this.pending.clear();
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
    if (/DELETE FROM promonet\.offer_identity_keys/i.test(sql)) {
      const now = new Date(args[1] ?? this.db.now).getTime();
      for (const key of args[0]) {
        const row = this.view(key);
        if (row && !row.published_at && new Date(row.reserved_until).getTime() <= now) {
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
  assert.match(schema, /offer_identity_keys[\s\S]*identity_key TEXT PRIMARY KEY/i);
  assert.doesNotMatch(schema, /\{1,256\}/);
  assert.match(schema, /length\(split_part\(identity_key,':',2\)\) BETWEEN 1 AND 256/i);
  assert.match(schema, /CONSTRAINT offer_identity_keys_identity_key_format_check/i);
  assert.match(schema, /offer_identity_keys_identity_key_check[\s\S]*DROP CONSTRAINT/i);
  assert.match(schema, /reserved_until TIMESTAMPTZ/i);
  assert.match(schema, /collector_rounds[\s\S]*metrics JSONB NOT NULL/i);
  assert.match(schema, /collector_incidents[\s\S]*active BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(schema, /collector_incidents[\s\S]*claim_until TIMESTAMPTZ/i);
  assert.match(schema, /ALTER TABLE promonet\.collector_incidents ADD COLUMN IF NOT EXISTS claim_until/i);
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
    await Promise.all([first.beginIncident("meli_session"), second.beginIncident("meli_session")]),
    [true, false],
  );
  const claim = db.incidents.get("meli_session");
  assert.equal(claim.active, true);
  assert.equal(claim.notified_at, null);
  assert.ok(claim.claim_until.getTime() > db.now.getTime());
  assert.equal(await second.beginIncident("meli_session"), false);
  db.now = new Date(claim.claim_until.getTime() + 1);
  assert.equal(await second.beginIncident("meli_session"), true);
});

test("acknowledged incidents stay suppressed until restoration", async () => {
  const db = new BehavioralDatabase();
  const first = new CollectorStore(db);
  const second = new CollectorStore(db);
  assert.equal(await first.beginIncident("meli_session"), true);
  await first.markIncidentNotified("meli_session");
  const acknowledged = db.incidents.get("meli_session");
  assert.ok(acknowledged.notified_at instanceof Date);
  assert.equal(acknowledged.claim_until, null);
  db.now = new Date(db.now.getTime() + 24 * 60 * 60 * 1_000);
  assert.equal(await second.beginIncident("meli_session"), false);
  await first.resolveIncident("meli_session");
  await first.resolveIncident("meli_session");
  assert.equal(db.incidents.get("meli_session").claim_until, null);
  assert.equal(await second.beginIncident("meli_session"), true);
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

test("real PostgreSQL incident leases recover crashes and suppress acknowledged notifications", {
  skip: !process.env.PROMONET_TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PROMONET_TEST_DATABASE_URL });
  const key = `meli_session_${randomUUID().replaceAll("-", "")}`;
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS promonet");
    const store = new CollectorStore(pool);
    await store.init();
    assert.equal(await store.beginIncident(key), true);
    assert.equal(await store.beginIncident(key), false);
    await pool.query(
      "UPDATE promonet.collector_incidents SET claim_until=now()-interval '1 second' WHERE incident_key=$1",
      [key],
    );
    assert.equal(await store.beginIncident(key), true);
    await store.markIncidentNotified(key);
    assert.equal(await store.beginIncident(key), false);
    await store.resolveIncident(key);
    assert.equal(await store.beginIncident(key), true);
  } finally {
    await pool.query("DELETE FROM promonet.collector_incidents WHERE incident_key=$1", [key]);
    await pool.end();
  }
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
