import { createHash } from "node:crypto";

const SALES_NOISE = new Set([
  "da", "das", "de", "do", "dos", "e", "em", "com",
  "desconto", "descontos", "envio", "entrega", "frete", "gratis",
  "imperdivel", "imperdiveis", "novo", "nova", "novos", "novas",
  "oferta", "ofertas", "original", "promocao", "promocoes",
]);

const COLORS = new Set([
  "amarelo", "amarela", "azul", "bege", "branco", "branca", "cinza",
  "dourado", "dourada", "laranja", "marrom", "prata", "preto", "preta",
  "rosa", "roxo", "roxa", "verde", "vermelho", "vermelha",
]);

const GENDERS = new Set([
  "feminino", "feminina", "femininos", "femininas",
  "masculino", "masculina", "masculinos", "masculinas", "unissex",
]);

const APPAREL = new Set([
  "bermuda", "blusa", "calca", "camisa", "camiseta", "chinelo", "jaqueta",
  "sandalia", "sapato", "short", "tenis", "vestido",
]);

const APPAREL_SIZES = new Set([
  "pp", "p", "m", "g", "gg", "xg", "xgg", "xl", "xxl",
]);

const PRODUCT_NOUNS = new Set([
  "adaptador", "aspirador", "bicicleta", "camera", "camiseta", "controle",
  "controles", "fone", "furadeira", "monitor", "notebook", "smartphone",
  "tenis", "tv",
]);

const TRACKING_PARAMETERS = new Set([
  "_gl", "fbclid", "gclid", "mkt_campaign", "mkt_content", "mkt_medium",
  "mkt_source", "mkt_term", "mkt_tool", "ref", "referrer", "tracking",
]);

const digest = (value) => createHash("sha256").update(value).digest("hex");
const capacity = (token) => /^\d+(?:[.,]\d+)?(?:mb|gb|tb)$/i.test(token);
const number = (token) => /^\d+(?:[.,]\d+)?$/.test(token);
const apparelSize = (token) => APPAREL_SIZES.has(token) ||
  (/^\d{2}$/.test(token) && Number(token) >= 30 && Number(token) <= 60);

function ineligible() {
  throw Error("ineligible_url");
}

function normalizedItemId(value) {
  if (typeof value !== "string" || !/^MLB\d+$/i.test(value.trim())) {
    throw Error("invalid_item_id");
  }
  return value.trim().toUpperCase();
}

function productIdFromUrl(value) {
  const pathname = new URL(value).pathname;
  const item = /^\/MLB-(\d+)/i.exec(pathname);
  if (item) return `MLB${item[1]}`;
  return /\/p\/(MLB\d+)\/?$/i.exec(pathname)?.[1].toUpperCase();
}

export function canonicalProductUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    ineligible();
  }

  const itemPath = /^\/MLB-\d+(?:[-_][^/]*)?\/?$/i.test(url.pathname);
  const catalogPath = /^\/(?:[^/]+\/)?p\/MLB\d+\/?$/i.test(url.pathname);
  const itemRoute = url.hostname === "produto.mercadolivre.com.br" && itemPath;
  const websiteRoute = url.hostname === "www.mercadolivre.com.br" && (itemPath || catalogPath);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    (!itemRoute && !websiteRoute)
  ) {
    ineligible();
  }
  url.pathname = url.pathname.replace(/\/$/, "");

  const parameters = [];
  for (const [key, parameterValue] of url.searchParams) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith("utm_") ||
      /^tracking(?:_|$)/.test(normalizedKey) ||
      TRACKING_PARAMETERS.has(normalizedKey)
    ) continue;
    parameters.push({ key, normalizedKey, parameterValue, index: parameters.length });
  }
  parameters.sort((left, right) =>
    left.normalizedKey < right.normalizedKey ? -1 :
      left.normalizedKey > right.normalizedKey ? 1 :
        left.key < right.key ? -1 : left.key > right.key ? 1 : left.index - right.index,
  );

  url.hash = "";
  url.search = "";
  for (const { key, parameterValue } of parameters) url.searchParams.append(key, parameterValue);
  return url.toString();
}

export function productFingerprint(title) {
  if (typeof title !== "string") return "";
  const tokens = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/([\p{L}\p{N}])\s*[+＋](?=\s|$)/gu, "$1 plus ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mb|gb|tb)\b/gi, " ")
    .match(/[a-z0-9]+/g) ?? [];
  const apparel = tokens.some((token) => APPAREL.has(token));
  const productNouns = [];
  const meaningful = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token === "cor") {
      if (COLORS.has(next)) index++;
      continue;
    }
    if (token === "tam" || token === "tamanho") {
      if (apparel && apparelSize(next)) index++;
      continue;
    }
    if (capacity(token)) continue;
    if (number(token) && /^(?:mb|gb|tb)$/i.test(next ?? "")) {
      index++;
      continue;
    }
    if (SALES_NOISE.has(token) || COLORS.has(token) || GENDERS.has(token)) continue;
    if (apparel && apparelSize(token)) continue;
    (PRODUCT_NOUNS.has(token) ? productNouns : meaningful).push(token);
  }

  if (productNouns.length + meaningful.length < 2) return "";
  return productNouns.concat(meaningful).join(" ");
}

export function offerIdentities(offer) {
  const itemId = normalizedItemId(offer.itemId);
  const canonicalUrl = canonicalProductUrl(offer.permalink);
  if (itemId !== productIdFromUrl(canonicalUrl)) throw Error("item_id_mismatch");
  const fingerprint = productFingerprint(offer.title);
  const identities = [
    `item:${itemId}`,
    `url:${digest(canonicalUrl)}`,
  ];
  if (fingerprint) identities.push(`product:${digest(fingerprint)}`);
  return identities;
}
