import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY_KEY = /^(?:item|url|product):[A-Za-z0-9._-]{1,256}$/;
const INCIDENT_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
const INCIDENT_CLAIM_SECONDS = 5 * 60;
// PostgreSQL's two-integer advisory locks occupy a namespace distinct from
// bigint singleton locks. "PROM" scopes the second integer to reservations.
const RESERVATION_LOCK_NAMESPACE = 0x50524f4d;
const RESERVATION_LOCK_TIMEOUT = "5s";
export const COLLECTOR_ROUND_METRIC_KEYS = Object.freeze([
  "claimed",
  "discovered",
  "eligible",
  "rejected",
  "rejectedFood",
  "rejectedIneligible",
  "rejectedRecent",
  "rejectedFingerprint",
  "rejectedQuota",
  "rejectedDuplicate",
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
  "finalizationFailed",
]);
const ROUND_METRICS = new Set(COLLECTOR_ROUND_METRIC_KEYS);

function validText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function requireUuid(value, name) {
  if (typeof value !== "string" || !UUID.test(value)) throw Error(`invalid_${name}`);
}

function requireIncidentKey(key) {
  if (typeof key !== "string" || !INCIDENT_KEY.test(key)) throw Error("invalid_incident_key");
}

function requireIdentityKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.some((key) =>
    typeof key !== "string" || !IDENTITY_KEY.test(key)
  )) throw Error("invalid_identity_keys");
  return [...new Set(keys)].sort();
}

function reservationLockIds(keys) {
  return [...new Set(keys.map((key) =>
    createHash("sha256").update(key).digest().readInt32BE()
  ))].sort((left, right) => left - right);
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
  identity_key TEXT PRIMARY KEY,
  reservation_id UUID,
  reserved_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  review_until TIMESTAMPTZ,
  niche_id TEXT,
  item_id TEXT,
  CHECK((reservation_id IS NULL) = (reserved_until IS NULL))
);
ALTER TABLE promonet.offer_identity_keys ADD COLUMN IF NOT EXISTS review_until TIMESTAMPTZ;
DO $identity_constraint_migration$
BEGIN
  IF EXISTS(
    SELECT 1
    FROM pg_constraint AS constraint_record
    JOIN pg_class AS table_record ON table_record.oid=constraint_record.conrelid
    JOIN pg_namespace AS schema_record ON schema_record.oid=table_record.relnamespace
    WHERE schema_record.nspname='promonet'
      AND table_record.relname='offer_identity_keys'
      AND constraint_record.contype='c'
      AND constraint_record.conname='offer_identity_keys_identity_key_check'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%identity_key%'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%item|url|product%'
  ) THEN
    ALTER TABLE promonet.offer_identity_keys
      DROP CONSTRAINT offer_identity_keys_identity_key_check;
  END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM pg_constraint AS constraint_record
    JOIN pg_class AS table_record ON table_record.oid=constraint_record.conrelid
    JOIN pg_namespace AS schema_record ON schema_record.oid=table_record.relnamespace
    WHERE schema_record.nspname='promonet'
      AND table_record.relname='offer_identity_keys'
      AND constraint_record.contype='c'
      AND constraint_record.conname='offer_identity_keys_identity_key_format_check'
  ) THEN
    ALTER TABLE promonet.offer_identity_keys
      ADD CONSTRAINT offer_identity_keys_identity_key_format_check CHECK(
        identity_key ~ '^(item|url|product):[A-Za-z0-9._-]+$'
        AND length(split_part(identity_key,':',2)) BETWEEN 1 AND 256
      );
  END IF;
END
$identity_constraint_migration$;
CREATE INDEX IF NOT EXISTS offer_identity_keys_published_at_idx
  ON promonet.offer_identity_keys(published_at) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_identity_keys_reserved_until_idx
  ON promonet.offer_identity_keys(reserved_until) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_identity_keys_reservation_id_idx
  ON promonet.offer_identity_keys(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_identity_keys_review_until_idx
  ON promonet.offer_identity_keys(review_until) WHERE review_until IS NOT NULL;
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
  claim_until TIMESTAMPTZ,
  claim_token UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $incident_claim_migration$
DECLARE
  claim_token_missing BOOLEAN;
BEGIN
  SELECT NOT EXISTS(
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='promonet'
      AND table_name='collector_incidents'
      AND column_name='claim_token'
  ) INTO claim_token_missing;
  ALTER TABLE promonet.collector_incidents ADD COLUMN IF NOT EXISTS claim_until TIMESTAMPTZ;
  ALTER TABLE promonet.collector_incidents ADD COLUMN IF NOT EXISTS claim_token UUID;
  IF claim_token_missing THEN
    UPDATE promonet.collector_incidents
    SET active=false,notified_at=NULL,claim_until=NULL,claim_token=NULL,updated_at=now()
    WHERE active=true;
  END IF;
END
$incident_claim_migration$;
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
       WHERE published_at >= now() - ($1 * interval '1 day')
          OR review_until > now()`,
      [retentionDays],
    );
    return new Set(result.rows.map((row) => row.identity_key));
  }

  async reserveOffer(keys, options = {}) {
    const uniqueKeys = requireIdentityKeys(keys);
    if (!validText(options.nicheId)) throw Error("invalid_niche_id");
    if (!validText(options.itemId)) throw Error("invalid_item_id");
    requireUuid(options.reservationId, "reservation_id");

    const lockIds = reservationLockIds(uniqueKeys);
    const client = await this.db.connect();
    let transactionOpen = false;
    let reusableClient = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT set_config('lock_timeout',$1,true)",
        [RESERVATION_LOCK_TIMEOUT],
      );
      for (const lockId of lockIds) {
        await client.query(
          "SELECT pg_advisory_xact_lock($1::integer,$2::integer)",
          [RESERVATION_LOCK_NAMESPACE, lockId],
        );
      }
      const clock = await client.query("SELECT clock_timestamp() AS reservation_now");
      const reservationNow = clock.rows[0]?.reservation_now;
      if (!(reservationNow instanceof Date) || !Number.isFinite(reservationNow.getTime())) {
        throw Error("reservation_clock_invalid");
      }
      await client.query(
        `DELETE FROM promonet.offer_identity_keys
         WHERE identity_key=ANY($1::text[])
           AND published_at IS NULL
           AND reserved_until <= $2::timestamptz`,
        [uniqueKeys, reservationNow],
      );
      const conflict = await client.query(
        `SELECT identity_key
         FROM promonet.offer_identity_keys
         WHERE identity_key=ANY($1::text[])
           AND (
             published_at >= $2::timestamptz-interval '7 days'
             OR review_until > $2::timestamptz
             OR (reservation_id IS NOT NULL AND reserved_until > $2::timestamptz)
           )
         LIMIT 1`,
        [uniqueKeys, reservationNow],
      );
      if (conflict.rows.length) {
        await client.query("COMMIT");
        transactionOpen = false;
        reusableClient = true;
        return false;
      }
      const inserted = await client.query(
        `INSERT INTO promonet.offer_identity_keys(
           identity_key,reservation_id,reserved_until,published_at,niche_id,item_id
         )
         SELECT identity_key,$2::uuid,$5::timestamptz+interval '10 minutes',NULL,$3,$4
         FROM unnest($1::text[]) AS keys(identity_key)
         ON CONFLICT(identity_key) DO UPDATE SET
           reservation_id=EXCLUDED.reservation_id,
           reserved_until=EXCLUDED.reserved_until,
           published_at=NULL,
           review_until=NULL,
           niche_id=EXCLUDED.niche_id,
           item_id=EXCLUDED.item_id
         RETURNING identity_key`,
        [
          uniqueKeys,
          options.reservationId,
          options.nicheId.trim(),
          options.itemId.trim(),
          reservationNow,
        ],
      );
      if (inserted.rows.length !== uniqueKeys.length) throw Error("reservation_incomplete");
      await client.query("COMMIT");
      transactionOpen = false;
      reusableClient = true;
      return true;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
          transactionOpen = false;
          reusableClient = true;
        } catch {
          // Preserve the transaction's original failure.
        }
      }
      throw error;
    } finally {
      if (reusableClient) client.release();
      else client.release(true);
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

  async quarantineOffer(reservationId) {
    requireUuid(reservationId, "reservation_id");
    const result = await this.db.query(
      `UPDATE promonet.offer_identity_keys
       SET reservation_id=NULL,reserved_until=NULL,
           review_until=now()+($2 * interval '1 day')
       WHERE reservation_id=$1::uuid AND published_at IS NULL`,
      [reservationId, 7],
    );
    return result.rowCount > 0;
  }

  async prepareDelivery(reservationId, keys) {
    requireUuid(reservationId, "reservation_id");
    const uniqueKeys = requireIdentityKeys(keys);
    const result = await this.db.query(
      `UPDATE promonet.offer_identity_keys
       SET reserved_until=now()+($3 * interval '1 day')
       WHERE reservation_id=$1::uuid
         AND identity_key=ANY($2::text[])
         AND published_at IS NULL
         AND reserved_until>now()
         AND (
           SELECT count(*)
           FROM promonet.offer_identity_keys AS owned
           WHERE owned.reservation_id=$1::uuid
             AND owned.identity_key=ANY($2::text[])
             AND owned.published_at IS NULL
             AND owned.reserved_until>now()
         )=cardinality($2::text[])
       RETURNING identity_key`,
      [reservationId, uniqueKeys, 7],
    );
    return result.rowCount === uniqueKeys.length;
  }

  async finalizePublication(reservationId, nicheId, itemId, url) {
    requireUuid(reservationId, "reservation_id");
    if (!validText(nicheId)) throw Error("invalid_niche_id");
    if (!validText(itemId)) throw Error("invalid_item_id");
    if (!validText(url)) throw Error("invalid_affiliate_url");

    const client = await this.db.connect();
    let transactionOpen = false;
    let reusableClient = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const reserved = await client.query(
        `SELECT identity_key,niche_id,item_id
         FROM promonet.offer_identity_keys
         WHERE reservation_id=$1::uuid AND published_at IS NULL
         FOR UPDATE`,
        [reservationId],
      );
      if (!reserved.rows.length) {
        await client.query("COMMIT");
        transactionOpen = false;
        reusableClient = true;
        return false;
      }
      if (reserved.rows.some((row) => row.niche_id !== nicheId || row.item_id !== itemId)) {
        throw Error("finalization_reservation_mismatch");
      }
      const confirmed = await client.query(
        `UPDATE promonet.offer_identity_keys
         SET published_at=now(),reservation_id=NULL,reserved_until=NULL,review_until=NULL
         WHERE reservation_id=$1::uuid AND published_at IS NULL`,
        [reservationId],
      );
      if (confirmed.rowCount !== reserved.rows.length) throw Error("finalization_incomplete");
      const publication = await client.query(
        `INSERT INTO promonet.offer_publications(niche_id,item_id,affiliate_url)
         VALUES($1,$2,$3)
         ON CONFLICT DO NOTHING
         RETURNING item_id`,
        [nicheId, itemId, url],
      );
      if (publication.rowCount !== 1) throw Error("finalization_publication_conflict");
      const preview = await client.query(
        `UPDATE promonet.offer_previews
         SET state='published',affiliate_url=$3,updated_at=now()
         WHERE niche_id=$1 AND item_id=$2`,
        [nicheId, itemId, url],
      );
      if (preview.rowCount !== 1) throw Error("finalization_preview_missing");
      await client.query("COMMIT");
      transactionOpen = false;
      reusableClient = true;
      return true;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
          transactionOpen = false;
          reusableClient = true;
        } catch {
          // Preserve the transaction's original failure.
        }
      }
      throw error;
    } finally {
      if (reusableClient) client.release();
      else client.release(true);
    }
  }

  async recordRound(roundId, summary, startedAt) {
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

  async beginIncident(key, claimToken) {
    requireIncidentKey(key);
    requireUuid(claimToken, "incident_claim_token");
    const result = await this.db.query(
      `INSERT INTO promonet.collector_incidents(
         incident_key,active,notified_at,claim_until,claim_token,updated_at
       )
       VALUES($1,true,NULL,now()+($3 * interval '1 second'),$2::uuid,now())
       ON CONFLICT(incident_key) DO UPDATE SET
         active=true,
         notified_at=NULL,
         claim_until=now()+($3 * interval '1 second'),
         claim_token=$2::uuid,
         updated_at=now()
       WHERE promonet.collector_incidents.active=false
          OR (
            promonet.collector_incidents.active=true
            AND promonet.collector_incidents.notified_at IS NULL
            AND (
              promonet.collector_incidents.claim_until IS NULL
              OR promonet.collector_incidents.claim_until<=now()
            )
          )
       RETURNING claim_token`,
      [key, claimToken, INCIDENT_CLAIM_SECONDS],
    );
    return result.rows[0]?.claim_token ?? null;
  }

  async markIncidentNotified(key, claimToken) {
    requireIncidentKey(key);
    requireUuid(claimToken, "incident_claim_token");
    const result = await this.db.query(
      `UPDATE promonet.collector_incidents
       SET notified_at=now(),claim_until=NULL,claim_token=NULL,updated_at=now()
       WHERE incident_key=$1
         AND active=true
         AND notified_at IS NULL
         AND claim_token=$2::uuid`,
      [key, claimToken],
    );
    return result.rowCount > 0;
  }

  async abandonIncident(key, claimToken) {
    requireIncidentKey(key);
    requireUuid(claimToken, "incident_claim_token");
    const result = await this.db.query(
      `UPDATE promonet.collector_incidents
       SET active=false,notified_at=NULL,claim_until=NULL,claim_token=NULL,updated_at=now()
       WHERE incident_key=$1
         AND active=true
         AND notified_at IS NULL
         AND claim_token=$2::uuid`,
      [key, claimToken],
    );
    return result.rowCount > 0;
  }

  async resolveIncident(key) {
    requireIncidentKey(key);
    await this.db.query(
      `UPDATE promonet.collector_incidents
       SET active=false,claim_until=NULL,claim_token=NULL,updated_at=now()
       WHERE incident_key=$1`,
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
