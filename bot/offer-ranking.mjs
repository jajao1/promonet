const clamp = value => Math.min(1, Math.max(0, value));
const RECOGNIZED_BRANDS = new Set([
  "acer", "adidas", "apple", "asics", "bosch", "boticario", "dewalt", "dell",
  "electrolux", "fila", "gedore", "lancome", "lenovo", "logitech", "makita",
  "microsoft", "motorola", "natura", "nike", "nintendo", "olympikus", "oster",
  "philco", "puma", "reserva", "samsung", "sony", "stanley", "tramontina", "vans", "wap",
]);

function normalizedBrand(value) {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function brandBoost(candidate) {
  const words = normalizedBrand(candidate.brand).split(" ");
  return words.some(word => RECOGNIZED_BRANDS.has(word)) ? 0.08 : 0;
}

function normalize(value, minimum, maximum, fallback = 0.5) {
  if (!Number.isFinite(value) || minimum === maximum) return fallback;
  return clamp((value - minimum) / (maximum - minimum));
}

function discount(candidate) {
  return Number.isFinite(candidate.originalPrice) && candidate.originalPrice > 0 &&
    Number.isFinite(candidate.price) && candidate.price < candidate.originalPrice
    ? clamp((candidate.originalPrice - candidate.price) / candidate.originalPrice)
    : 0;
}

function scoreCategory(candidates) {
  const ranks = candidates.map(candidate => candidate.rank).filter(Number.isFinite);
  const sales = candidates.map(candidate => candidate.soldQuantity)
    .filter(value => Number.isFinite(value) && value >= 0).map(Math.log1p);
  const minimumRank = Math.min(...ranks);
  const maximumRank = Math.max(...ranks);
  const minimumSales = Math.min(...sales);
  const maximumSales = Math.max(...sales);
  return candidates.map(candidate => {
    const normalizedRank = normalize(candidate.rank, minimumRank, maximumRank);
    const rankScore = 1 - normalizedRank;
    const salesValue = Number.isFinite(candidate.soldQuantity) && candidate.soldQuantity >= 0
      ? Math.log1p(candidate.soldQuantity)
      : Number.NaN;
    const salesScore = normalize(salesValue, minimumSales, maximumSales);
    const discountScore = discount(candidate);
    return {
      ...candidate,
      hybridScore: (0.40 * rankScore) + (0.35 * salesScore) + (0.25 * discountScore) + brandBoost(candidate),
    };
  });
}

export function rankCategoryOffers(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const groups = new Map();
  for (const candidate of candidates) {
    const category = candidate?.requestedCategoryId ?? candidate?.scopeCategoryId ?? candidate?.categoryId ?? "";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(candidate);
  }
  return [...groups.values()].flatMap(scoreCategory).sort((a, b) =>
    b.hybridScore - a.hybridScore ||
    (Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER) - (Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER) ||
    discount(b) - discount(a) ||
    String(a.itemId).localeCompare(String(b.itemId))
  );
}
