export class ConversionStore {
  constructor(db) { this.db = db; }

  async init() {
    await this.db.query(`CREATE SCHEMA IF NOT EXISTS promonet;
CREATE TABLE IF NOT EXISTS promonet.affiliate_conversions(
 id BIGSERIAL PRIMARY KEY,
 source_id TEXT NOT NULL,
 canonical_url TEXT NOT NULL,
 tag TEXT NOT NULL,
 affiliate_url TEXT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','awaiting_confirmation','confirmed','review','blocked_auth')),
 diagnostic TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(source_id)
);
CREATE INDEX IF NOT EXISTS affiliate_conversions_queue ON promonet.affiliate_conversions(status,id);
CREATE INDEX IF NOT EXISTS affiliate_conversions_cache ON promonet.affiliate_conversions(canonical_url,tag) WHERE status='confirmed';`);
  }

  async enqueue({ sourceId, url, tag }) {
    const result = await this.db.query(`INSERT INTO promonet.affiliate_conversions(source_id,canonical_url,tag) VALUES($1,$2,$3) ON CONFLICT(source_id) DO UPDATE SET source_id=EXCLUDED.source_id RETURNING id`, [sourceId, url, tag]);
    return result.rows[0]?.id ?? null;
  }

  async cached(url, tag) {
    const result = await this.db.query("SELECT affiliate_url FROM promonet.affiliate_conversions WHERE canonical_url=$1 AND tag=$2 AND status='confirmed' ORDER BY id DESC LIMIT 1", [url, tag]);
    return result.rows[0]?.affiliate_url ?? null;
  }

  async claim() {
    const result = await this.db.query(`UPDATE promonet.affiliate_conversions SET status='processing',attempts=attempts+1,updated_at=now() WHERE id=(SELECT id FROM promonet.affiliate_conversions WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,source_id,canonical_url,tag`);
    return result.rows[0] ?? null;
  }

  async generated(id, affiliateUrl) { await this.db.query("UPDATE promonet.affiliate_conversions SET status='awaiting_confirmation',affiliate_url=$2,diagnostic=NULL,updated_at=now() WHERE id=$1", [id, affiliateUrl]); }
  async confirm(id) { await this.db.query("UPDATE promonet.affiliate_conversions SET status='confirmed',diagnostic=NULL,updated_at=now() WHERE id=$1 AND status='awaiting_confirmation'", [id]); }
  async reject(id) { await this.db.query("UPDATE promonet.affiliate_conversions SET status='review',diagnostic='operator_rejected',updated_at=now() WHERE id=$1 AND status='awaiting_confirmation'", [id]); }
  async block(id, category) {
    if (!['blocked_auth','captcha_required','ui_changed','ineligible_url','invalid_affiliate_result','worker_failed'].includes(category)) category = 'worker_failed';
    await this.db.query("UPDATE promonet.affiliate_conversions SET status=CASE WHEN $2 IN ('blocked_auth','captcha_required') THEN 'blocked_auth' ELSE 'review' END,diagnostic=$2,updated_at=now() WHERE id=$1", [id, category]);
  }
  async recover() { await this.db.query("UPDATE promonet.affiliate_conversions SET status='review',diagnostic='worker_interrupted',updated_at=now() WHERE status='processing'"); }
  async status() { return (await this.db.query("SELECT id,source_id,canonical_url,tag,affiliate_url,status,diagnostic,attempts FROM promonet.affiliate_conversions ORDER BY id DESC LIMIT 20")).rows; }
}
