const number = (value) => value == null ? null : Number(value);

export class PublicOffersStore {
  constructor(db) { this.db = db; }

  async init() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS promonet.offer_clicks(
      id BIGSERIAL PRIMARY KEY,
      niche_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      referrer_host TEXT,
      clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS offer_clicks_offer_time_idx
      ON promonet.offer_clicks(niche_id,item_id,clicked_at DESC);`);
  }

  async list({ query = "", category = "", sort = "recent", page = 1, limit = 24 } = {}) {
    const safeLimit = Math.min(48, Math.max(1, Number(limit) || 24));
    const safePage = Math.max(1, Number(page) || 1);
    const search = query ? `%${query}%` : "";
    const order = sort === "discount"
      ? `(CASE WHEN p.original_price > p.price THEN (p.original_price-p.price)/p.original_price ELSE 0 END) DESC, pub.published_at DESC`
      : "pub.published_at DESC";
    const result = await this.db.query(`WITH latest_publications AS (
      SELECT DISTINCT ON (niche_id,item_id) niche_id,item_id,published_at
      FROM promonet.offer_publications
      ORDER BY niche_id,item_id,published_at DESC
    )
    SELECT p.niche_id,p.item_id,p.title,p.price,p.original_price,p.image_url,
           pub.published_at,COUNT(*) OVER() AS total_count
    FROM promonet.offer_previews p
    JOIN latest_publications pub USING(niche_id,item_id)
    WHERE p.state = 'published'
      AND ($1 = '' OR p.title ILIKE $1)
      AND ($2 = '' OR p.niche_id = $2)
    ORDER BY ${order}
    LIMIT $3 OFFSET $4`, [search, category, safeLimit, (safePage - 1) * safeLimit]);
    return {
      items: result.rows.map((row) => ({
        category: row.niche_id,
        itemId: row.item_id,
        title: row.title,
        price: number(row.price),
        originalPrice: number(row.original_price),
        imageUrl: row.image_url,
        publishedAt: row.published_at,
        redirectUrl: `/oferta/${encodeURIComponent(row.niche_id)}/${encodeURIComponent(row.item_id)}`,
      })),
      total: Number(result.rows[0]?.total_count ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async categories() {
    const result = await this.db.query(`SELECT p.niche_id AS id,COUNT(*) AS count
      FROM promonet.offer_previews p
      WHERE p.state = 'published' AND EXISTS (
        SELECT 1 FROM promonet.offer_publications pub
        WHERE pub.niche_id=p.niche_id AND pub.item_id=p.item_id
      )
      GROUP BY p.niche_id ORDER BY p.niche_id`);
    return result.rows.map((row) => ({ id: row.id, count: Number(row.count) }));
  }

  async findDestination(nicheId, itemId) {
    const result = await this.db.query(`SELECT pub.affiliate_url
      FROM promonet.offer_publications pub
      JOIN promonet.offer_previews p USING(niche_id,item_id)
      WHERE pub.niche_id=$1 AND pub.item_id=$2 AND p.state='published'
      ORDER BY pub.published_at DESC LIMIT 1`, [nicheId, itemId]);
    return result.rows[0]?.affiliate_url ?? null;
  }

  async recordClick(nicheId, itemId, requestId, referrerHost) {
    await this.db.query(`INSERT INTO promonet.offer_clicks(niche_id,item_id,request_id,referrer_host)
      VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING`,
      [nicheId, itemId, requestId, referrerHost]);
  }
}
