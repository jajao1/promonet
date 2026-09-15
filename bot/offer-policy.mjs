import { isFoodCategoryId } from "./category-policy.mjs";

const FOOD_TITLE_SIGNALS = [
  "macarrao", "acucar", "refrigerante", "arroz", "bebida", "alimento",
  "feijao", "cerveja", "suco", "cha", "pao",
  "biscoito", "bolacha", "carne", "frango", "farinha", "azeite", "molho",
  "cereal", "salgadinho", "queijo", "mussarela", "manteiga", "margarina",
  "iogurte", "presunto", "mortadela", "salame", "bacon", "ovos", "achocolatado",
  "bombom", "bombons", "racao", "acai", "sorvete", "linguica", "bala", "mel",
  "oleo", "sal",
];

const CONTEXTUAL_FOOD_PHRASES = [
  /(?:^| )agua (?:mineral|com gas)(?: |$)/,
  /(?:^| )agua de coco(?: |$)/,
  /(?:^| )oleo de soja(?: |$)/,
  /(?:^| )sal refinado(?: |$)/,
  /(?:^| )hamburguer(?:es)?(?: |$)/,
  /(?:^| )cafe (?:torrado|moido|em graos|soluvel|em capsulas?)(?: |$)/,
  /(?:^| )leite (?:integral|desnatado|semidesnatado|em po|condensado|zero lactose)(?: |$)/,
  /(?:^| )vinho (?:tinto|branco|rose|seco|suave|espumante)(?: |$)/,
  /(?:^| )(?:garrafa|caixa|kit) (?:de )?vinho(?: |$)/,
  /(?:^| )chocolate (?:ao leite|amargo|meio amargo|branco|em po|\d+g)(?: |$)/,
  /(?:^| )(?:barra|caixa|bombom|ovo) (?:de )?chocolate(?: |$)/,
  /(?:^| )chocolate (?:[^ ]+ )*(?:bis|lacta|nestle|garoto|hersheys|milka|neugebauer)(?: |$)/,
  /(?:^| )(?:bis|lacta|nestle|garoto|hersheys|milka|neugebauer)(?: [^ ]+)* chocolate(?: |$)/,
  /(?:^| )chocolate(?: |$).* \d+(?:g|kg)(?: |$)/,
];

const AMBIGUOUS_FOOD_TITLE_SIGNALS = ["cafe", "leite", "vinho", "chocolate"];
const NON_FOOD_HEAD_SIGNALS = new Set([
  "moedor", "espremedor", "maquina", "porta", "fatiador", "adega", "espumador",
  "taca", "caneca", "jarra", "forma", "pote", "galheteiro", "cafeteira", "chaleira",
  "panela", "acucareiro", "bebedouro", "alimentador", "capacete",
  "camiseta", "camisa", "vestido", "sapato", "tenis", "body", "blusa", "calca",
  "bermuda", "short", "saia", "casaco", "jaqueta", "moletom", "sandalia",
  "chinelo", "bolsa", "bone", "chapeu", "cinto", "gravata", "roupa",
]);
const FOOD_HEAD_SIGNALS = new Set([...FOOD_TITLE_SIGNALS, ...AMBIGUOUS_FOOD_TITLE_SIGNALS]);
const UNIT_EVIDENCE = /(?:^| )\d+(?:g|kg|ml|l)(?: |$)/;

function normalizedWords(value) {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

export function isFoodOrBeverage(offer) {
  if (!offer || typeof offer !== "object") return false;
  if (isFoodCategoryId(offer.categoryId) || isFoodCategoryId(offer.scopeCategoryId) ||
      isFoodCategoryId(offer.requestedCategoryId)) return true;

  const title = normalizedWords(offer.title);
  if (!title) return false;
  const words = title.split(/\s+/);
  const tokens = new Set(words);
  const hasFoodToken = FOOD_TITLE_SIGNALS.some(signal => tokens.has(signal)) ||
    AMBIGUOUS_FOOD_TITLE_SIGNALS.some(signal => tokens.has(signal));
  const hasFoodPhrase = CONTEXTUAL_FOOD_PHRASES.some(pattern => pattern.test(title));
  if (hasFoodPhrase || FOOD_HEAD_SIGNALS.has(words[0]) ||
      (tokens.has("plus") && hasFoodToken) || (UNIT_EVIDENCE.test(title) && hasFoodToken)) return true;
  if (NON_FOOD_HEAD_SIGNALS.has(words[0]) && hasFoodToken) return false;
  return hasFoodToken;
}

export function isEligibleOffer(candidate, { categoryId, recentIds = new Set() } = {}) {
  try {
    const product = new URL(candidate.permalink);
    const image = new URL(candidate.imageUrl);
    const requestedCategoryId = candidate.requestedCategoryId ?? candidate.scopeCategoryId ?? candidate.categoryId;
    return typeof categoryId === "string" && /^MLB\d+$/.test(categoryId) &&
      candidate.status === "active" &&
      requestedCategoryId === categoryId &&
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
    .filter(candidate => isEligibleOffer(candidate, { categoryId, recentIds }) && !seen.has(candidate.itemId) && seen.add(candidate.itemId))
    .sort(compareOffers)
    .slice(0, limit);
}

export function selectOffer(candidates, options) {
  return selectOffers(candidates, { ...options, limit: 1 })[0] ?? null;
}

function boundedQuota(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) return null;
  return Math.min(maximum, value);
}

export function compareOffers(a, b) {
  return a.rank - b.rank || discount(b) - discount(a) || a.itemId.localeCompare(b.itemId);
}

export function diversifyOffers(candidates, { limit = 10, perNiche = 2, recentIds = new Set() } = {}) {
  const effectiveLimit = boundedQuota(limit, 10, 10);
  const effectivePerNiche = boundedQuota(perNiche, 2, 2);
  if (!Array.isArray(candidates) || effectiveLimit === null || effectivePerNiche === null) return [];

  const groups = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.nicheId !== "string" ||
        !/^[a-z0-9_-]+$/.test(candidate.nicheId) ||
        typeof candidate.itemId !== "string" || !candidate.itemId) continue;
    const categoryId = candidate.requestedCategoryId ?? candidate.scopeCategoryId ?? candidate.categoryId;
    if (!isEligibleOffer(candidate, { categoryId, recentIds })) continue;
    const candidateCap = candidate.maxPerRound === undefined
      ? effectivePerNiche
      : boundedQuota(candidate.maxPerRound, effectivePerNiche, 2);
    if (candidateCap === null) continue;
    if (!groups.has(candidate.nicheId)) groups.set(candidate.nicheId, { offers: [], cap: effectivePerNiche });
    const group = groups.get(candidate.nicheId);
    group.offers.push(candidate);
    group.cap = Math.min(group.cap, candidateCap);
  }

  for (const group of groups.values()) group.offers.sort(compareOffers);

  const cursors = new Map([...groups.keys()].map(nicheId => [nicheId, 0]));
  const selected = [];
  const selectedIds = new Set();
  const counts = new Map();
  let progressed = true;
  while (selected.length < effectiveLimit && progressed) {
    progressed = false;
    for (const [nicheId, group] of groups) {
      if (selected.length >= effectiveLimit || (counts.get(nicheId) ?? 0) >= group.cap) continue;
      const offers = group.offers;
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
