const FOOD_CATEGORY_IDS = new Set([
  "MLB1403",
  "MLB278123",
  "MLB410883",
  "MLB455292",
  "MLB439739",
  "MLB455505",
  "MLB1423",
  "MLB1417",
  "MLB269718",
  "MLB455580",
  "MLB194832",
]);

const FOOD_TITLE_SIGNALS = [
  "macarrao", "acucar", "refrigerante", "arroz", "bebida", "alimento",
  "feijao", "cerveja", "suco", "cha", "pao",
  "biscoito", "bolacha", "carne", "frango", "farinha", "azeite", "molho",
  "cereal", "salgadinho", "queijo", "mussarela", "manteiga", "margarina",
  "iogurte", "presunto", "mortadela", "salame", "bacon", "ovos",
];

const CONTEXTUAL_FOOD_PHRASES = [
  /(?:^| )agua (?:mineral|com gas)(?: |$)/,
  /(?:^| )hamburguer(?:es)?(?: |$)/,
  /(?:^| )cafe (?:torrado|moido|em graos|soluvel|em capsulas?)(?: |$)/,
  /(?:^| )leite (?:integral|desnatado|semidesnatado|em po|condensado|zero lactose)(?: |$)/,
  /(?:^| )vinho (?:tinto|branco|rose|seco|suave|espumante)(?: |$)/,
  /(?:^| )(?:garrafa|caixa|kit) (?:de )?vinho(?: |$)/,
  /(?:^| )chocolate (?:ao leite|amargo|meio amargo|branco|em po|\d+g)(?: |$)/,
  /(?:^| )(?:barra|caixa|bombom|ovo) (?:de )?chocolate(?: |$)/,
  /(?:^| )chocolate (?:[^ ]+ )*(?:lacta|nestle|garoto|hersheys|milka|neugebauer)(?: |$)/,
  /(?:^| )(?:lacta|nestle|garoto|hersheys|milka|neugebauer)(?: [^ ]+)* chocolate(?: |$)/,
  /(?:^| )chocolate(?: |$).* \d+(?:g|kg)(?: |$)/,
];

const AMBIGUOUS_FOOD_TITLE_SIGNALS = ["cafe", "leite", "vinho", "chocolate"];
const FASHION_TITLE_SIGNALS = new Set([
  "camiseta", "camisa", "vestido", "sapato", "tenis", "body", "blusa", "calca",
  "bermuda", "short", "saia", "casaco", "jaqueta", "moletom", "sandalia",
  "chinelo", "bolsa", "bone", "chapeu", "cinto", "gravata", "roupa",
]);

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
  if (FOOD_TITLE_SIGNALS.some(signal => tokens.has(signal)) ||
      CONTEXTUAL_FOOD_PHRASES.some(pattern => pattern.test(title))) return true;
  const ambiguousFood = AMBIGUOUS_FOOD_TITLE_SIGNALS.some(signal => tokens.has(signal));
  if (!ambiguousFood) return false;
  if ([...tokens].some(token => FASHION_TITLE_SIGNALS.has(token))) return false;
  return true;
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

function boundedQuota(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) return null;
  return Math.min(maximum, Math.max(1, value));
}

export function diversifyOffers(candidates, { limit = 10, perNiche = 2 } = {}) {
  const effectiveLimit = boundedQuota(limit, 10, 10);
  const effectivePerNiche = boundedQuota(perNiche, 2, 2);
  if (!Array.isArray(candidates) || effectiveLimit === null || effectivePerNiche === null) return [];

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
  while (selected.length < effectiveLimit && progressed) {
    progressed = false;
    for (const [nicheId, offers] of groups) {
      if (selected.length >= effectiveLimit || (counts.get(nicheId) ?? 0) >= effectivePerNiche) continue;
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
