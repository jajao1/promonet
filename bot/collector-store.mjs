import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY_KEY = /^(?:item|url|product):[A-Za-z0-9._-]{1,256}$/;
const INCIDENT_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
const ROUND_METRICS = new Set([
  "claimed",
  "discovered",
  "eligible",
  "rejected",
  "rejectedFood",
  "rejectedRecent",
  "rejectedFingerprint",
  "skipped",
  "reserved",
  "reservationRejected",
  "empty",
  "review",
  "delivered",
  "published",
  "failed",
  "affiliateFailed",
  "sessionFailed",
  "composeFailed",
  "deliveryFailed",
]);

function validText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function requireUuid(value, name) {
  if (typeof value !== "string" || !UUID.test(value)) throw Error(`invalid_${name}`);
}

function requireIncidentKey(key) {
  if (typeof key !== "string" || !INCIDENT_KEY.test(key)) throw Error("invalid_incident_key");
}

function advisoryLockId(key) {
  return createHash("sha256").update(key).digest().readBigInt64BE().toString();
}

function validateMetrics(summary) {
  if (
    !summary ||
    typeof summary !== "object" ||
    Array.isArray(summary) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(summary))
  ) {
    throw Error("invalid_round_metrics");
  }
  for (const [key, value] of Object.entries(summary)) {
    if (!ROUND_METRICS.has(key) || !Number.isSafeInteger(value) || value < 0) {
      throw Error("invalid_round_metrics");
    }
  }
}

export class CollectorStore {
  constructor(db) {
    this.db = db;
  }

  async init() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS promonet.collector_runs(
  niche_id TEXT PRIMARY KEY,
  last_started_at TIMESTAMPTZ,
  last_result TEXT,
  category_cursor INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE promonet.collector_runs ADD COLUMN IF NOT EXISTS category_cursor INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS promonet.collector_rotation(
  id SMALLINT PRIMARY KEY CHECK(id=1),
  vertical_cursor INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS promonet.offer_previews(
  niche_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  price NUMERIC NOT NULL,
  original_price NUMERIC,
  image_url TEXT NOT NULL,
  product_url TEXT NOT NULL,
  affiliate_url TEXT,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(niche_id,item_id)
);
CREATE TABLE IF NOT EXISTS promonet.offer_publications(
  niche_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  published_day DATE NOT NULL DEFAULT CURRENT_DATE,
  affiliate_url TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(niche_id,item_id,published_day)
);
CREATE TABLE IF NOT EXISTS promonet.offer_identity_keys(
  identity_key TEXT PRIMARY KEY CHECK(identity_key ~ '^(item|url|product):[A-Za-z0-9._-]{1,256}$'),
  reservation_id UUID,
  reserved_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  niche_id TEXT,
  item_id TEXT,
  CHECK((reservation_id IS NULL) = (reserved_until IS NULL))
);
CREATE INDEX IF NOT EXISTS offer_identity_keys_published_at_idx
  ON promonet.offer_identity_keys(published_at) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_identity_keys_reserved_until_idx
  ON promonet.offer_identity_keys(reserved_until) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_identity_keys_reservation_id_idx
  ON promonet.offer_identity_keys(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS promonet.collector_rounds(
  round_id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metrics JSONB NOT NULL CHECK(jsonb_typeof(metrics)='object')
);
CREATE INDEX IF NOT EXISTS collector_rounds_started_at_idx
  ON promonet.collector_rounds(started_at DESC);
CREATE TABLE IF NOT EXISTS promonet.collector_incidents(
  incident_key TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT false,
  notified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collector_incidents_active_idx
  ON promonet.collector_incidents(incident_key) WHERE active;
`);
  }

  async claimDueNiches(niches) {
    const claimed = [];
    for (const niche of niches.filter((candidate) => candidate.enabled)) {
      const result = await this.db.query(
        `INSERT INTO promonet.collector_runs(niche_id,last_started_at,last_result)
         VALUES($1,now(),'running')
         ON CONFLICT(niche_id) DO UPDATE
         SET last_started_at=now(),last_result='running',updated_at=now()
         WHERE promonet.collector_runs.last_started_at IS NULL
           OR promonet.collector_runs.last_started_at + ($2 * interval '1 minute') <= now()
         RETURNING niche_id`,
        [niche.id, niche.intervalMinutes],
      );
      if (result.rows.length) claimed.push(niche);
    }
    if (claimed.length < 2) return claimed;
    const rotation = await this.db.query(
      `INSERT INTO promonet.collector_rotation(id,vertical_cursor) VALUES(1,0)
       ON CONFLICT(id) DO UPDATE
       SET vertical_cursor=(promonet.collector_rotation.vertical_cursor+1)%$1
       RETURNING vertical_cursor`,
      [claimed.length],
    );
    const start = Number(rotation.rows[0]?.vertical_cursor ?? 0) % claimed.length;
    return claimed.slice(start).concat(claimed.slice(0, start));
  }

  async nextCategory(niche) {
    const count = niche.categoryIds.length;
    const result = await this.db.query(
      `UPDATE promonet.collector_runs
       SET category_cursor=(category_cursor+1)%$2,updated_at=now()
       WHERE niche_id=$1
       RETURNING (category_cursor-1+$2)%$2 AS selected_cursor`,
      [niche.id, count],
    );
    if (!result.rows.length) throw Error("collector_state_missing");
    return niche.categoryIds[Number(result.rows[0].selected_cursor)];
  }

  async recentItemIds() {
    const result = await this.db.query(
      `SELECT DISTINCT item_id
       FROM promonet.offer_publications
       WHERE published_at>=now()-interval '7 days'`,
    );
    return new Set(result.rows.map((row) => row.item_id));
  }

  async recentIdentityKeys(retentionDays = 7) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
      throw Error("invalid_retention_days");
    }
    const result = await this.db.query(
      `SELECT DISTINCT identity_key
       FROM promonet.offer_identity_keys
       WHERE published_at >= now() - ($1 * interval '1 day')`,
      [retentionDays],
    );
    return new Set(result.rows.map((row) => row.identity_key));
  }

  async reserveOffer(keys, options = {}) {
    if (!Array.isArray(keys) || keys.length === 0 || keys.some((key) =>
      typeof key !== "string" || !IDENTITY_KEY.test(key)
    )) {
      throw Error("invalid_identity_keys");
    }
    if (!validText(options.nicheId)) throw Error("invalid_niche_id");
    if (!validText(options.itemId)) throw Error("invalid_item_id");
    requireUuid(options.reservationId, "reservation_id");

    const uniqueKeys = [...new Set(keys)].sort();
    const client = await this.db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      for (const key of uniqueKeys) {
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [advisoryLockId(key)]);
      }
      await client.query(
        `DELETE FROM promonet.offer_identity_keys
         WHERE identity_key=ANY($1::text[])
           AND published_at IS NULL
           AND reserved_until <= now()`,
        [uniqueKeys],
      );
      const conflict = await client.query(
        `SELECT identity_key
         FROM promonet.offer_identity_keys
         WHERE identity_key=ANY($1::text[])
           AND (
             published_at >= now()-interval '7 days'
             OR (reservation_id IS NOT NULL AND reserved_until > now())
           )
         LIMIT 1`,
        [uniqueKeys],
      );
      if (conflict.rows.length) {
        await client.query("COMMIT");
        transactionOpen = false;
        return false;
      }
      const inserted = await client.query(
        `INSERT INTO promonet.offer_identity_keys(
           identity_key,reservation_id,reserved_until,published_at,niche_id,item_id
         )
         SELECT identity_key,$2::uuid,now()+interval '10 minutes',NULL,$3,$4
         FROM unnest($1::text[]) AS keys(identity_key)
         ON CONFLICT(identity_key) DO UPDATE SET
           reservation_id=EXCLUDED.reservation_id,
           reserved_until=EXCLUDED.reserved_until,
           published_at=NULL,
           niche_id=EXCLUDED.niche_id,
           item_id=EXCLUDED.item_id
         RETURNING identity_key`,
        [uniqueKeys, options.reservationId, options.nicheId.trim(), options.itemId.trim()],
      );
      if (inserted.rows.length !== uniqueKeys.length) throw Error("reservation_incomplete");
      await client.query("COMMIT");
      transactionOpen = false;
      return true;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the transaction's original failure.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmOffer(reservationId) {
    requireUuid(reservationId, "reservation_id");
    const result = await this.db.query(
      `UPDATE promonet.offer_identity_keys
       SET published_at=now(),reservation_id=NULL,reserved_until=NULL
       WHERE reservation_id=$1::uuid AND published_at IS NULL`,
      [reservationId],
    );
    return result.rowCount > 0;
  }

  async releaseOffer(reservationId) {
    requireUuid(reservationId, "reservation_id");
    const result = await this.db.query(
      `DELETE FROM promonet.offer_identity_keys
       WHERE reservation_id=$1::uuid AND published_at IS NULL`,
      [reservationId],
    );
    return result.rowCount > 0;
  }

  async recordRound(roundId, summary, startedAt = new Date()) {
    requireUuid(roundId, "round_id");
    validateMetrics(summary);
    if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
      throw Error("invalid_round_started_at");
    }
    await this.db.query(
      `INSERT INTO promonet.collector_rounds(round_id,started_at,metrics)
       VALUES($1,$2,$3::jsonb)`,
      [roundId, startedAt, JSON.stringify(summary)],
    );
  }

  async beginIncident(key) {
    requireIncidentKey(key);
    const result = await this.db.query(
      `INSERT INTO promonet.collector_incidents(incident_key,active,notified_at,updated_at)
       VALUES($1,true,now(),now())
       ON CONFLICT(incident_key) DO UPDATE SET
         active=true,notified_at=now(),updated_at=now()
       WHERE promonet.collector_incidents.active=false
       RETURNING incident_key`,
      [key],
    );
    return result.rows.length > 0;
  }

  async resolveIncident(key) {
    requireIncidentKey(key);
    await this.db.query(
      `UPDATE promonet.collector_incidents
       SET active=false,updated_at=now()
       WHERE incident_key=$1 AND active=true`,
      [key],
    );
  }

  async savePreview(nicheId, candidate, state) {
    await this.db.query(
      `INSERT INTO promonet.offer_previews(
         niche_id,item_id,title,price,original_price,image_url,product_url,state
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(niche_id,item_id) DO UPDATE SET
         title=EXCLUDED.title,
         price=EXCLUDED.price,
         original_price=EXCLUDED.original_price,
         image_url=EXCLUDED.image_url,
         product_url=EXCLUDED.product_url,
         state=EXCLUDED.state,
         updated_at=now()`,
      [
        nicheId,
        candidate.itemId,
        candidate.title,
        candidate.price,
        candidate.originalPrice,
        candidate.imageUrl,
        candidate.permalink,
        state,
      ],
    );
  }

  async completeRun(nicheId, result) {
    await this.db.query(
      `UPDATE promonet.collector_runs
       SET last_result=$2,updated_at=now()
       WHERE niche_id=$1`,
      [nicheId, result],
    );
  }

  async markPublished(nicheId, itemId, url) {
    await this.db.query(
      `WITH inserted AS (
         INSERT INTO promonet.offer_publications(niche_id,item_id,affiliate_url)
         VALUES($1,$2,$3)
         ON CONFLICT DO NOTHING
         RETURNING item_id
       )
       UPDATE promonet.offer_previews
       SET state='published',affiliate_url=$3,updated_at=now()
       WHERE niche_id=$1 AND item_id=$2 AND EXISTS(SELECT 1 FROM inserted)`,
      [nicheId, itemId, url],
    );
  }

  async markReview(nicheId, itemId) {
    await this.db.query(
      `UPDATE promonet.offer_previews
       SET state='review',updated_at=now()
       WHERE niche_id=$1 AND item_id=$2`,
      [nicheId, itemId],
    );
  }
}
