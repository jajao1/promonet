import { createHash } from "node:crypto";

const SALES_NOISE = new Set([
  "da", "das", "de", "do", "dos", "e", "em", "com", "para",
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

const TRACKING_PARAMETERS = new Set([
  "_gl", "fbclid", "gclid", "mkt_campaign", "mkt_content", "mkt_medium",
  "mkt_source", "mkt_term", "mkt_tool", "ref", "referrer", "tracking",
]);

const digest = (value) => createHash("sha256").update(value).digest("hex");
const marketplaceHost = (hostname) => /(^|\.)mercadolivre\.com\.br$/i.test(hostname);
const capacity = (token) => /^\d+(?:[.,]\d+)?(?:mb|gb|tb)$/i.test(token);
const number = (token) => /^\d+(?:[.,]\d+)?$/.test(token);

function ineligible() {
  throw Error("ineligible_url");
}

export function canonicalProductUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    ineligible();
  }

  const itemPath = /(?:^|\/)MLB-\d+(?:[-_/]|$)/i.test(url.pathname);
  const catalogPath = /(?:^|\/)p\/MLB\d+(?:\/|$)/i.test(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !marketplaceHost(url.hostname) ||
    (!itemPath && !catalogPath)
  ) {
    ineligible();
  }

  const parameters = [];
  for (const [key, parameterValue] of url.searchParams) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.startsWith("utm_") || TRACKING_PARAMETERS.has(normalizedKey)) continue;
    parameters.push([normalizedKey, parameterValue]);
  }
  parameters.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0,
  );

  url.hash = "";
  url.search = "";
  for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue);
  return url.toString();
}

export function productFingerprint(title) {
  if (typeof title !== "string") return "";
  const tokens = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .match(/[a-z0-9]+/g) ?? [];
  const apparel = tokens.some((token) => APPAREL.has(token));
  const meaningful = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token === "cor" || token === "tam" || token === "tamanho") {
      if (next) index++;
      continue;
    }
    if (capacity(token)) continue;
    if (number(token) && /^(?:mb|gb|tb)$/i.test(next ?? "")) {
      index++;
      continue;
    }
    if (SALES_NOISE.has(token) || COLORS.has(token) || GENDERS.has(token)) continue;
    if (apparel && (APPAREL_SIZES.has(token) || (/^\d{2}$/.test(token) && Number(token) >= 30 && Number(token) <= 60))) continue;
    meaningful.push(token);
  }

  if (meaningful.length < 2) return "";
  return meaningful.sort().join(" ");
}

export function offerIdentities(offer) {
  const canonicalUrl = canonicalProductUrl(offer.permalink);
  const fingerprint = productFingerprint(offer.title);
  const identities = [
    `item:${String(offer.itemId).trim().toUpperCase()}`,
    `url:${digest(canonicalUrl)}`,
  ];
  if (fingerprint) identities.push(`product:${digest(fingerprint)}`);
  return identities;
}
