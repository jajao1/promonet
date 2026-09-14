const marketplaceHost = (hostname) => /(^|\.)mercadolivre\.com\.br$/i.test(hostname);

function parsed(input, error) {
  try { return new URL(input); } catch { throw Error(error); }
}

export function canonicalProductUrl(input) {
  const url = parsed(input, "ineligible_url");
  if (url.protocol !== "https:" || !marketplaceHost(url.hostname) || !/MLB-?\d+/i.test(url.pathname)) throw Error("ineligible_url");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  return url.toString();
}

export function affiliateResult(input) {
  const url = parsed(input, "invalid_affiliate_result");
  if (url.protocol !== "https:" || url.hostname !== "meli.la" || url.pathname.length < 2) throw Error("invalid_affiliate_result");
  return url.toString();
}

export async function resolveSourceUrl(input, { fetch = globalThis.fetch, maxRedirects = 5 } = {}) {
  let current = parsed(input, "ineligible_url");
  if (marketplaceHost(current.hostname)) return canonicalProductUrl(current);
  if (current.protocol !== "https:" || current.hostname !== "meli.la") throw Error("ineligible_url");
  for (let count = 0; count < maxRedirects; count++) {
    const response = await fetch(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const location = response.headers.get("location");
    if (!location) {
      if (response.url && marketplaceHost(new URL(response.url).hostname)) return canonicalProductUrl(response.url);
      throw Error("ineligible_url");
    }
    current = new URL(location, current);
    if (current.protocol !== "https:" || !(current.hostname === "meli.la" || marketplaceHost(current.hostname))) throw Error("ineligible_url");
    if (marketplaceHost(current.hostname)) return canonicalProductUrl(current);
  }
  throw Error("ineligible_url");
}
