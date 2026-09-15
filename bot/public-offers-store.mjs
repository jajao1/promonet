import { categoryByNicheId, categoryBySlug } from "./storefront-catalog.mjs";

const number = (value) => value == null ? null : Number(value);

export class PublicOffersStore {
  constructor(db, { now = () => new Date() } = {}) { this.db = db; this.now = now; }

  activeSince() {
    return new Date(this.now().getTime() - 7 * 24 * 60 * 60 * 1000);
  }

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
    const nicheId = category ? categoryBySlug(category)?.nicheId : "";
    if (category && !nicheId) return { items: [], total: 0, page: safePage, limit: safeLimit };
    const order = sort === "discount"
      ? `(CASE WHEN p.original_price > p.price THEN (p.original_price-p.price)/p.original_price ELSE 0 END) DESC, pub.published_at DESC`
      : "pub.published_at DESC";
    const result = await this.db.query(`WITH latest_publications AS (
      SELECT DISTINCT ON (niche_id,item_id) niche_id,item_id,published_at
      FROM promonet.offer_publications
      WHERE published_at >= $3
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
    LIMIT $4 OFFSET $5`, [search, nicheId, this.activeSince(), safeLimit, (safePage - 1) * safeLimit]);
    const items = result.rows.map((row) => this.mapOffer(row)).filter(Boolean);
    return {
      items,
      total: items.length === result.rows.length ? Number(result.rows[0]?.total_count ?? 0) : items.length,
      page: safePage,
      limit: safeLimit,
    };
  }

  async categories() {
    const result = await this.db.query(`SELECT p.niche_id AS id,COUNT(*) AS count
      FROM promonet.offer_previews p
      WHERE p.state = 'published' AND EXISTS (
        SELECT 1 FROM promonet.offer_publications pub
        WHERE pub.niche_id=p.niche_id AND pub.item_id=p.item_id AND pub.published_at >= $1
      )
      GROUP BY p.niche_id ORDER BY p.niche_id`, [this.activeSince()]);
    return result.rows.flatMap((row) => {
      const category = categoryByNicheId(row.id);
      return category ? [{ id: category.slug, slug: category.slug, name: category.name, count: Number(row.count) }] : [];
    });
  }

  async listCategory(category, { page = 1, limit = 24 } = {}) {
    const safeLimit = Math.min(48, Math.max(1, Number(limit) || 24));
    const safePage = Math.max(1, Number(page) || 1);
    const result = await this.db.query(`WITH latest_publications AS (
      SELECT DISTINCT ON (niche_id,item_id) niche_id,item_id,published_at
      FROM promonet.offer_publications
      WHERE published_at >= $2
      ORDER BY niche_id,item_id,published_at DESC
    )
    SELECT p.niche_id,p.item_id,p.title,p.price,p.original_price,p.image_url,
           pub.published_at,COUNT(*) OVER() AS total_count
    FROM promonet.offer_previews p
    JOIN latest_publications pub USING(niche_id,item_id)
    WHERE p.state='published' AND p.niche_id=$1
    ORDER BY pub.published_at DESC LIMIT $3 OFFSET $4`,
    [category, this.activeSince(), safeLimit, (safePage - 1) * safeLimit]);
    const items = result.rows.map((row) => this.mapOffer(row)).filter(Boolean);
    return {
      items,
      total: items.length === result.rows.length ? Number(result.rows[0]?.total_count ?? 0) : items.length,
      page: safePage, limit: safeLimit,
    };
  }

  mapOffer(row) {
    const category = categoryByNicheId(row.niche_id);
    if (!category) return null;
    return {
      category: category.slug, itemId: row.item_id, title: row.title,
      price: number(row.price), originalPrice: number(row.original_price), imageUrl: row.image_url,
      publishedAt: row.published_at,
      redirectUrl: `/oferta/${encodeURIComponent(category.slug)}/${encodeURIComponent(row.item_id)}`,
    };
  }

  async findOfferPage(nicheId, itemId) {
    const result = await this.db.query(`SELECT p.niche_id,p.item_id,p.title,p.price,p.original_price,p.image_url,
        pub.published_at,pub.affiliate_url
      FROM promonet.offer_previews p
      LEFT JOIN LATERAL (
        SELECT published_at,affiliate_url FROM promonet.offer_publications
        WHERE niche_id=p.niche_id AND item_id=p.item_id ORDER BY published_at DESC LIMIT 1
      ) pub ON true
      WHERE p.niche_id=$1 AND p.item_id=$2 AND p.state='published' LIMIT 1`, [nicheId, itemId]);
    const row = result.rows[0];
    if (!row) return null;
    const status = !row.published_at || !row.affiliate_url ? "unavailable"
      : new Date(row.published_at) < this.activeSince() ? "expired" : "active";
    const offer = this.mapOffer(row);
    return offer ? { ...offer, status, affiliateUrl: row.affiliate_url } : null;
  }

  async listRelated(nicheId, excludedItemId, limit = 4) {
    const safeLimit = Math.min(8, Math.max(1, Number(limit) || 4));
    const result = await this.db.query(`WITH latest_publications AS (
      SELECT DISTINCT ON (niche_id,item_id) niche_id,item_id,published_at
      FROM promonet.offer_publications WHERE published_at >= $3
      ORDER BY niche_id,item_id,published_at DESC
    ) SELECT p.niche_id,p.item_id,p.title,p.price,p.original_price,p.image_url,pub.published_at
      FROM promonet.offer_previews p JOIN latest_publications pub USING(niche_id,item_id)
      WHERE p.state='published' AND p.niche_id=$1 AND p.item_id<>$2
      ORDER BY pub.published_at DESC LIMIT $4`, [nicheId, excludedItemId, this.activeSince(), safeLimit]);
    return result.rows.map((row) => this.mapOffer(row)).filter(Boolean);
  }

  async listSitemapCategories() {
    const result = await this.db.query(`SELECT pub.niche_id,MAX(pub.published_at) AS latest_at
      FROM promonet.offer_publications pub
      JOIN promonet.offer_previews p USING(niche_id,item_id)
      WHERE pub.published_at >= $1 AND p.state='published'
      GROUP BY pub.niche_id ORDER BY pub.niche_id`, [this.activeSince()]);
    return result.rows.flatMap((row) => {
      const category = categoryByNicheId(row.niche_id);
      return category ? [{ slug: category.slug, lastModified: new Date(row.latest_at).toISOString() }] : [];
    });
  }

  async listSitemapOffers() {
    const result = await this.db.query(`SELECT DISTINCT ON (pub.niche_id,pub.item_id) pub.niche_id,pub.item_id,pub.published_at
      FROM promonet.offer_publications pub
      JOIN promonet.offer_previews p USING(niche_id,item_id)
      WHERE pub.published_at >= $1 AND pub.affiliate_url IS NOT NULL AND p.state='published'
      ORDER BY pub.niche_id,pub.item_id,pub.published_at DESC`, [this.activeSince()]);
    return result.rows.flatMap((row) => {
      const category = categoryByNicheId(row.niche_id);
      return category ? [{ category: category.slug, itemId: row.item_id, lastModified: new Date(row.published_at).toISOString() }] : [];
    });
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
