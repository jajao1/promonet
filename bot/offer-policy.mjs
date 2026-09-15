const FOOD_CATEGORY_IDS = new Set([
  "MLB1403",
  "MLB278123",
  "MLB410883",
  "MLB455292",
  "MLB439739",
  "MLB455505",
  "MLB1423",
  "MLB1417",
]);

const FOOD_TITLE_SIGNALS = [
  "macarrao", "acucar", "refrigerante", "cafe", "arroz", "bebida", "alimento",
  "feijao", "leite", "chocolate", "cerveja", "vinho", "suco", "cha", "pao",
  "biscoito", "bolacha", "carne", "frango", "farinha", "azeite", "molho",
  "cereal", "salgadinho",
];

function normalizedWords(value) {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

export function isFoodOrBeverage(offer) {
  if (!offer || typeof offer !== "object") return false;
  if (FOOD_CATEGORY_IDS.has(offer.categoryId) || FOOD_CATEGORY_IDS.has(offer.scopeCategoryId)) return true;

  let title = normalizedWords(offer.title);
  if (!title) return false;
  title = title
    .replace(/(?:^| )cafe racer(?: |$)/g, " ")
    .replace(/(?:^| )panela(?: eletrica)? (?:de|para) arroz(?: |$)/g, " ");
  const tokens = new Set(title.trim().split(/\s+/).filter(Boolean));
  return FOOD_TITLE_SIGNALS.some(signal => tokens.has(signal));
}

function valid(candidate, categoryId, recentIds) {
  try {
    const product = new URL(candidate.permalink);
    const image = new URL(candidate.imageUrl);
    return candidate.status === "active" &&
      (candidate.scopeCategoryId ?? candidate.categoryId) === categoryId &&
      !recentIds.has(candidate.itemId) &&
      !isFoodOrBeverage(candidate) &&
      typeof candidate.title === "string" && candidate.title.trim() &&
      Number.isFinite(candidate.price) && candidate.price > 0 &&
      Number.isFinite(candidate.originalPrice) && candidate.originalPrice > candidate.price &&
      product.protocol === "https:" && /(^|\.)mercadolivre\.com\.br$/.test(product.hostname) &&
      /MLB-?\d+/i.test(product.pathname) && image.protocol === "https:" &&
      /(^|\.)mlstatic\.com$/.test(image.hostname);
  } catch {
    return false;
  }
}

const discount = candidate => Number.isFinite(candidate.originalPrice) && candidate.originalPrice > candidate.price
  ? (candidate.originalPrice - candidate.price) / candidate.originalPrice
  : 0;

export function selectOffers(candidates, { categoryId, recentIds, limit }) {
  const seen = new Set();
  return candidates
    .filter(candidate => valid(candidate, categoryId, recentIds) && !seen.has(candidate.itemId) && seen.add(candidate.itemId))
    .sort((a, b) => a.rank - b.rank || discount(b) - discount(a) || a.itemId.localeCompare(b.itemId))
    .slice(0, limit);
}

export function selectOffer(candidates, options) {
  return selectOffers(candidates, { ...options, limit: 1 })[0] ?? null;
}

export function diversifyOffers(candidates, { limit = 10, perNiche = 2 } = {}) {
  if (!Array.isArray(candidates) || !Number.isInteger(limit) || limit < 1 ||
      !Number.isInteger(perNiche) || perNiche < 1) return [];

  const groups = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.nicheId !== "string" ||
        !/^[a-z0-9_-]+$/.test(candidate.nicheId) ||
        typeof candidate.itemId !== "string" || !candidate.itemId) continue;
    if (!groups.has(candidate.nicheId)) groups.set(candidate.nicheId, []);
    groups.get(candidate.nicheId).push(candidate);
  }

  const cursors = new Map([...groups.keys()].map(nicheId => [nicheId, 0]));
  const selected = [];
  const selectedIds = new Set();
  const counts = new Map();
  let progressed = true;
  while (selected.length < limit && progressed) {
    progressed = false;
    for (const [nicheId, offers] of groups) {
      if (selected.length >= limit || (counts.get(nicheId) ?? 0) >= perNiche) continue;
      let cursor = cursors.get(nicheId);
      while (cursor < offers.length && selectedIds.has(offers[cursor].itemId)) cursor += 1;
      cursors.set(nicheId, cursor + 1);
      if (cursor >= offers.length) continue;
      const offer = offers[cursor];
      selected.push(offer);
      selectedIds.add(offer.itemId);
      counts.set(nicheId, (counts.get(nicheId) ?? 0) + 1);
      progressed = true;
    }
  }
  return selected;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatOffer(candidate, url) {
  const value = discount(candidate);
  return [
    "📢 Publicidade",
    `*${candidate.title.trim()}*`,
    value
      ? `De ${brl.format(candidate.originalPrice)} por *${brl.format(candidate.price)}* (${Math.round(value * 100)}% OFF)`
      : `Preço: *${brl.format(candidate.price)}*`,
    url,
  ].join("\n\n");
}
