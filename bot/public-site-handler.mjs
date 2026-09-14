import { randomUUID as defaultRandomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const staticAssets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8", "no-cache"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8", "no-cache"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8", "public, max-age=3600"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8", "public, max-age=3600"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml", "public, max-age=86400"]],
  ["/logo.jpg", ["logo.jpg", "image/jpeg", "public, max-age=86400"]],
  ["/product-placeholder.svg", ["product-placeholder.svg", "image/svg+xml", "public, max-age=86400"]],
]);

function send(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30",
    ...headers,
  });
  res.end(body);
}

function parseOffers(url) {
  const query = (url.searchParams.get("q") ?? "").trim();
  const category = url.searchParams.get("category") ?? "";
  const sort = url.searchParams.get("sort") ?? "recent";
  const pageText = url.searchParams.get("page") ?? "1";
  const limitText = url.searchParams.get("limit") ?? "24";
  const page = Number(pageText);
  const requestedLimit = Number(limitText);
  if (query.length > 100 || (category && !/^[a-z0-9_-]{1,50}$/i.test(category)) ||
      !["recent", "discount"].includes(sort) || !/^\d+$/.test(pageText) ||
      !/^\d+$/.test(limitText) || page < 1 || page > 100000 || requestedLimit < 1) throw Error("invalid_query");
  return { query, category, sort, page, limit: Math.min(48, requestedLimit) };
}

function safeDestination(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "meli.la" || host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br"));
  } catch { return false; }
}

function referrerHost(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname.length <= 253 ? url.hostname.toLowerCase() : null;
  } catch { return null; }
}

function safeWhatsAppGroupUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chat.whatsapp.com" && /^\/[A-Za-z0-9_-]{10,}$/.test(url.pathname)
      ? url.href
      : "";
  } catch { return ""; }
}

export function publicSiteHandler({ store, randomUUID = defaultRandomUUID, siteConfig = {} }) {
  return async (req, res) => {
    if (req.method !== "GET") return false;
    const url = new URL(req.url, "http://promonet.local");
    if (url.pathname === "/api/offers") {
      let options;
      try { options = parseOffers(url); } catch { send(res, 400, { error: "invalid_request" }, { "cache-control": "no-store" }); return true; }
      try { send(res, 200, await store.list(options)); } catch { send(res, 503, { error: "temporarily_unavailable" }, { "cache-control": "no-store" }); }
      return true;
    }
    if (url.pathname === "/api/categories") {
      try { send(res, 200, { categories: await store.categories() }); } catch { send(res, 503, { error: "temporarily_unavailable" }, { "cache-control": "no-store" }); }
      return true;
    }
    if (url.pathname === "/api/site-config") {
      send(res, 200, { whatsAppGroupUrl: safeWhatsAppGroupUrl(siteConfig.whatsAppGroupUrl) });
      return true;
    }
    const match = url.pathname.match(/^\/oferta\/([a-z0-9_-]{1,50})\/([a-z0-9_-]{1,80})$/i);
    if (!match) {
      const asset = staticAssets.get(url.pathname);
      if (asset) {
        try {
          const body = await readFile(new URL(`../site/${asset[0]}`, import.meta.url));
          const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 20)}"`;
          if (req.headers?.["if-none-match"] === etag) { res.writeHead(304, { etag, "cache-control": asset[2] }); res.end(); return true; }
          res.writeHead(200, {
            "content-type": asset[1], "content-length": String(body.length), "cache-control": asset[2], etag,
            "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin",
            "content-security-policy": "default-src 'self'; img-src 'self' https://*.mlstatic.com; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
          });
          res.end(body);
        } catch { send(res, 503, { error: "temporarily_unavailable" }, { "cache-control": "no-store" }); }
        return true;
      }
      if (url.pathname === "/health") return false;
      send(res, 404, { error: "not_found" }, { "cache-control": "no-store" });
      return true;
    }
    try {
      const destination = await store.findDestination(match[1], match[2]);
      if (!destination) { send(res, 404, { error: "offer_not_found" }, { "cache-control": "no-store" }); return true; }
      if (!safeDestination(destination)) { send(res, 410, { error: "offer_unavailable" }, { "cache-control": "no-store" }); return true; }
      await store.recordClick(match[1], match[2], randomUUID(), referrerHost(req.headers?.referer));
      res.writeHead(302, { location: destination, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end();
    } catch { send(res, 503, { error: "temporarily_unavailable" }, { "cache-control": "no-store" }); }
    return true;
  };
}
