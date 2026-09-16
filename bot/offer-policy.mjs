import { isFoodCategoryId } from "./category-policy.mjs";
import { rankCategoryOffers } from "./offer-ranking.mjs";

const FOOD_TITLE_SIGNALS = [
  "macarrao", "acucar", "refrigerante", "arroz", "bebida", "alimento",
  "feijao", "cerveja", "suco", "cha", "pao",
  "biscoito", "bolacha", "carne", "frango", "farinha", "azeite", "molho",
  "cereal", "salgadinho", "queijo", "mussarela", "manteiga", "margarina",
  "iogurte", "presunto", "mortadela", "salame", "bacon", "ovos", "achocolatado",
  "bombom", "bombons", "racao", "acai", "sorvete", "linguica",
];

const CONTEXTUAL_FOOD_PHRASES = [
  /(?:^| )agua (?:mineral|com gas)(?: |$)/,
  /(?:^| )agua de coco(?: |$)/,
  /(?:^| )oleo de soja(?: |$)/,
  /(?:^| )oleo de (?:girassol|canola|milho|coco|azeitona)(?: |$)/,
  /(?:^| )sal (?:refinado|de cozinha|marinho|grosso|rosa)(?: |$)/,
  /(?:^| )bala (?:fini|doce|de gelatina|mastigavel)(?: |$)/,
  /(?:^| )mel (?:puro|natural|organico|silvestre|de abelha)(?: |$)/,
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
const POLYSEMOUS_FOOD_TITLE_SIGNALS = ["oleo", "sal", "bala", "mel"];
const NON_FOOD_CONTEXTUAL_PHRASES = [
  /(?:^| )oleo (?:de )?(?:motor|corporal|lubrificante|hidratante|essencial)(?: |$)/,
  /(?:^| )sal (?:de|para) (?:banho|piscina|aquario)(?: |$)/,
  /(?:^| )bala (?:de )?airsoft(?: |$)/,
  /(?:^| )shampoo (?:de |com )?mel(?: |$)/,
];
const NON_FOOD_HEAD_SIGNALS = new Set([
  "moedor", "espremedor", "maquina", "porta", "fatiador", "adega", "espumador",
  "taca", "caneca", "jarra", "forma", "pote", "galheteiro", "cafeteira", "chaleira",
  "panela", "acucareiro", "bebedouro", "alimentador", "capacete", "filtro", "timer", "suporte",
  "shampoo", "condicionador",
  "camiseta", "camisa", "vestido", "sapato", "tenis", "body", "blusa", "calca",
  "bermuda", "short", "saia", "casaco", "jaqueta", "moletom", "sandalia",
  "chinelo", "bolsa", "bone", "chapeu", "cinto", "gravata", "roupa",
]);
const FOOD_HEAD_SIGNALS = new Set([
  ...FOOD_TITLE_SIGNALS,
  ...AMBIGUOUS_FOOD_TITLE_SIGNALS,
  ...POLYSEMOUS_FOOD_TITLE_SIGNALS,
]);
const FOOD_BRAND_SIGNALS = new Set([
  "bis", "lacta", "nestle", "garoto", "hersheys", "milka", "neugebauer",
  "pilao", "nescau", "fini", "ferrero", "rocher", "starbucks",
]);
const CAPSULE_SIGNALS = new Set(["capsula"]);
const CAPSULE_BRAND_SIGNALS = new Set(["starbucks", "dolce", "gusto", "nescafe", "nespresso", "pilao"]);
const PACKAGE_EVIDENCE = /(?:^| )(?:\d+x)?\d+(?:g|kg|ml|l)(?: |$)|(?:^| )(?:pacote|garrafa|caixa|lata|sache)(?:s)?(?: |$)/;
const PACKAGE_NOUN_SIGNALS = new Set(["pacote", "garrafa", "caixa", "lata", "sache"]);
const USAGE_RELATION_SIGNALS = new Set(["para", "de"]);
const EARLY_HEAD_WINDOW = 5;

function normalizedWords(value) {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function matchesSignal(word, signals) {
  return signals.has(word) ||
    (word.endsWith("s") && signals.has(word.slice(0, -1))) ||
    (word.endsWith("es") && signals.has(word.slice(0, -2)));
}

function withoutMerchandisingPrefix(words) {
  let start = 0;
  if (words[start] === "kit" || words[start] === "conjunto") start += 1;
  while (words[start] === "de" || /^\d+(?:x\d+)?$/.test(words[start] ?? "")) start += 1;
  return words.slice(start);
}

function isInclusionSignal(word) {
  return /^(?:inclus[oa]s?|acompanha|acompanhando|inclui)$/.test(word);
}

function componentIsFood(component) {
  const words = withoutMerchandisingPrefix(component.split(/\s+/));
  const text = words.join(" ");
  const tokens = new Set(words);
  const earlyWords = words.slice(0, EARLY_HEAD_WINDOW);
  const nonFoodHeadIndex = earlyWords.findIndex(word => matchesSignal(word, NON_FOOD_HEAD_SIGNALS));
  const capsuleIndexes = words.flatMap((word, index) => matchesSignal(word, CAPSULE_SIGNALS) ? [index] : []);
  if (capsuleIndexes.length) {
    for (let occurrence = 0; occurrence < capsuleIndexes.length; occurrence += 1) {
      const capsuleIndex = capsuleIndexes[occurrence];
      const previousCapsuleIndex = capsuleIndexes[occurrence - 1] ?? nonFoodHeadIndex;
      const nextCapsuleIndex = capsuleIndexes[occurrence + 1] ?? words.length;
      const capsuleRelations = words.slice(Math.max(0, previousCapsuleIndex + 1), capsuleIndex);
      const included = capsuleRelations.slice(-2).some(isInclusionSignal) ||
        words.slice(capsuleIndex + 1, Math.min(nextCapsuleIndex, capsuleIndex + 4)).some(isInclusionSignal);
      if (included) return true;
      const compatible = nonFoodHeadIndex >= 0 &&
        (words[capsuleIndex - 1] === "para" || capsuleRelations.includes("compativel"));
      if (compatible) continue;
      const quantified = /^\d+$/.test(words[capsuleIndex - 1] ?? "");
      const branded = words.slice(capsuleIndex + 1, nextCapsuleIndex)
        .some(word => CAPSULE_BRAND_SIGNALS.has(word));
      if (nonFoodHeadIndex < 0 || quantified || branded) return true;
    }
    return false;
  }
  const hasSignal = signal => tokens.has(signal) || tokens.has(`${signal}s`);
  const hasFoodToken = FOOD_TITLE_SIGNALS.some(hasSignal) ||
    AMBIGUOUS_FOOD_TITLE_SIGNALS.some(hasSignal) ||
    POLYSEMOUS_FOOD_TITLE_SIGNALS.some(hasSignal);
  const hasFoodPhrase = CONTEXTUAL_FOOD_PHRASES.some(pattern => pattern.test(text));
  if (!hasFoodToken && !hasFoodPhrase) return false;

  const nonFoodContext = NON_FOOD_CONTEXTUAL_PHRASES.some(pattern => pattern.test(text));
  if (nonFoodContext) return false;
  if (nonFoodHeadIndex >= 0) {
    const foodIndex = words.findIndex(word => matchesSignal(word, FOOD_HEAD_SIGNALS));
    if (foodIndex <= nonFoodHeadIndex) return false;
    const relationWords = words.slice(nonFoodHeadIndex + 1, foodIndex);
    const interveningNonFoodHead = relationWords.some(word => matchesSignal(word, NON_FOOD_HEAD_SIGNALS));
    const packagingHead = relationWords.some(word => matchesSignal(word, PACKAGE_NOUN_SIGNALS));
    const explicitInclusion = isInclusionSignal(words[foodIndex - 1]) ||
      words.slice(foodIndex + 1, foodIndex + 3).some(isInclusionSignal);
    const usageTarget = USAGE_RELATION_SIGNALS.has(words[foodIndex - 1]) || interveningNonFoodHead;
    if (usageTarget && !packagingHead && !explicitInclusion) return false;
    const foodWords = words.slice(foodIndex);
    return explicitInclusion || packagingHead || foodWords.some(word => FOOD_BRAND_SIGNALS.has(word)) ||
      PACKAGE_EVIDENCE.test(foodWords.join(" "));
  }

  if (hasFoodPhrase) return true;
  return words.slice(0, EARLY_HEAD_WINDOW).some(word => matchesSignal(word, FOOD_HEAD_SIGNALS)) || hasFoodToken;
}

export function isFoodOrBeverage(offer) {
  if (!offer || typeof offer !== "object") return false;
  if (isFoodCategoryId(offer.categoryId) || isFoodCategoryId(offer.scopeCategoryId) ||
      isFoodCategoryId(offer.requestedCategoryId)) return true;

  const title = normalizedWords(offer.title);
  if (!title) return false;
  return title.split(/\s+plus\s+/).some(componentIsFood);
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
  return rankCategoryOffers(candidates
    .filter(candidate => isEligibleOffer(candidate, { categoryId, recentIds }) && !seen.has(candidate.itemId) && seen.add(candidate.itemId)))
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

const IDENTITY_KEY = /^(?:item|url|product):[A-Za-z0-9._-]{1,256}$/;

function trustedIdentityKeys(candidate) {
  if (!Array.isArray(candidate.identityKeys) || candidate.identityKeys.length === 0 ||
      candidate.identityKeys.some((key) => typeof key !== "string" || !IDENTITY_KEY.test(key))) return [];
  return [...new Set(candidate.identityKeys)];
}

export function compareOffers(a, b) {
  return (Number.isFinite(b.hybridScore) ? b.hybridScore : 0) - (Number.isFinite(a.hybridScore) ? a.hybridScore : 0) ||
    a.rank - b.rank || discount(b) - discount(a) || a.itemId.localeCompare(b.itemId);
}

export function diversifyOfferPool(candidates, { limit = 10, perNiche = 2, recentIds = new Set() } = {}) {
  const effectiveLimit = boundedQuota(limit, 10, 10);
  const effectivePerNiche = boundedQuota(perNiche, 2, 2);
  if (!Array.isArray(candidates) || effectiveLimit === null || effectivePerNiche === null) {
    return { selected: [], rejectedDuplicate: [], rejectedQuota: [] };
  }

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

  for (const group of groups.values()) group.offers = rankCategoryOffers(group.offers);

  const cursors = new Map([...groups.keys()].map(nicheId => [nicheId, 0]));
  const selected = [];
  const selectedIds = new Set();
  const selectedIdentityKeys = new Set();
  const rejectedDuplicate = new Set();
  const counts = new Map();
  let progressed = true;
  while (selected.length < effectiveLimit && progressed) {
    progressed = false;
    for (const [nicheId, group] of groups) {
      if (selected.length >= effectiveLimit || (counts.get(nicheId) ?? 0) >= group.cap) continue;
      const offers = group.offers;
      let cursor = cursors.get(nicheId);
      while (cursor < offers.length) {
        const offer = offers[cursor];
        const identityKeys = trustedIdentityKeys(offer);
        if (!selectedIds.has(offer.itemId) && !identityKeys.some((key) => selectedIdentityKeys.has(key))) break;
        rejectedDuplicate.add(offer);
        cursor += 1;
      }
      cursors.set(nicheId, cursor + 1);
      if (cursor >= offers.length) continue;
      const offer = offers[cursor];
      selected.push(offer);
      selectedIds.add(offer.itemId);
      for (const key of trustedIdentityKeys(offer)) selectedIdentityKeys.add(key);
      counts.set(nicheId, (counts.get(nicheId) ?? 0) + 1);
      progressed = true;
    }
  }
  const selectedSet = new Set(selected);
  const rejectedQuota = [];
  for (const group of groups.values()) {
    for (const offer of group.offers) {
      if (!selectedSet.has(offer) && !rejectedDuplicate.has(offer)) rejectedQuota.push(offer);
    }
  }
  return { selected, rejectedDuplicate: [...rejectedDuplicate], rejectedQuota };
}

export function diversifyOffers(candidates, options) {
  return diversifyOfferPool(candidates, options).selected;
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
