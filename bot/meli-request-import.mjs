const endpoint = "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink";
const invalid = () => { throw Error("request_import_invalid"); };

function header(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`"${escaped}"\\s*=\\s*"((?:\\u0060.|[^"\\u0060])*)"`, "i"));
  return match?.[1]?.replace(/\u0060"/g, '"').replace(/\u0060\u0060/g, "\u0060");
}

export function parseMeliRequest(text, { now = () => new Date() } = {}) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 512 * 1024) invalid();
  if ((text.match(/\bInvoke-WebRequest\b/gi) ?? []).length !== 1) invalid();
  if (/\$\(|\b(?:Invoke-Expression|Start-Process|cmd(?:\.exe)?)\b/i.test(text)) invalid();
  const uri = text.match(/-Uri\s+"([^"]+)"/i)?.[1];
  const method = text.match(/-Method\s+"?([A-Za-z]+)"?/i)?.[1];
  if (uri !== endpoint || method?.toUpperCase() !== "POST") invalid();
  const origin = header(text, "Origin");
  const referer = header(text, "Referer");
  const csrfToken = header(text, "x-csrf-token");
  try {
    if (origin !== "https://www.mercadolivre.com.br") invalid();
    const refererUrl = new URL(referer);
    if (refererUrl.protocol !== "https:" || refererUrl.hostname !== "www.mercadolivre.com.br" || !refererUrl.pathname.startsWith("/afiliados/")) invalid();
  } catch { invalid(); }
  const cookies = [];
  for (const match of text.matchAll(/Cookie\("([^"\u0060;=]+)",\s*"([^"\u0060;]*)"/g)) cookies.push(`${match[1]}=${match[2]}`);
  if (!cookies.length || !csrfToken) invalid();
  const browserHeaders = {};
  for (const name of [
    "accept", "accept-language", "cache-control", "pragma", "priority",
    "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-model", "sec-ch-ua-platform",
    "sec-ch-ua-platform-version", "sec-fetch-dest", "sec-fetch-mode",
    "sec-fetch-site", "sec-gpc", "user-agent",
  ]) {
    const value = header(text, name);
    if (value) browserHeaders[name] = value;
  }
  const bodyStart = text.search(/-Body\s+"/i);
  if (bodyStart < 0) invalid();
  const bodyPrefix = text.slice(bodyStart).match(/^-Body\s+"/i)?.[0];
  const encoded = text.slice(bodyStart + bodyPrefix.length).trimEnd();
  if (!encoded.endsWith('"')) invalid();
  let body;
  try { body = JSON.parse(encoded.slice(0, -1).replace(/`"/g, '"').replace(/``/g, "`")); } catch { invalid(); }
  if (!Array.isArray(body?.urls) || body.urls.length !== 1 || typeof body.urls[0] !== "string" || typeof body.tag !== "string" || !body.tag) invalid();
  return { version: 1, cookie: cookies.join("; "), csrfToken, origin, referer, browserHeaders, importedAt: now().toISOString() };
}
