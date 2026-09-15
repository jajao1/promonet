import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("storefront assets expose the complete accessible offer journey", async () => {
  const html = await readFile(new URL("../../site/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../../site/styles.css", import.meta.url), "utf8");
  const js = await readFile(new URL("../../site/app.js", import.meta.url), "utf8");
  const favicon = await readFile(new URL("../../site/favicon.svg", import.meta.url), "utf8");
  const logo = await readFile(new URL("../../site/logo.jpg", import.meta.url));
  const placeholder = await readFile(new URL("../../site/product-placeholder.svg", import.meta.url), "utf8");
  for (const landmark of ["<header", "<nav", "<main", "<footer"]) assert.match(html, new RegExp(landmark));
  assert.match(html, /id="offer-search"/);
  assert.match(html, /id="category-list"/);
  assert.match(html, /id="offer-template"/);
  assert.match(html, /Publicidade.*comissão/is);
  assert.match(html, /<link rel="icon" type="image\/jpeg" href="\/logo\.jpg">/);
  assert.match(html, /<img[^>]+src="\/logo\.jpg"[^>]+alt="PromoMega"/);
  assert.doesNotMatch(html, /PromoNet/i);
  assert.match(html, /class="whatsapp-link"/);
  assert.match(html, /<header[^>]*>[\s\S]*class="whatsapp-link"[^>]+href="https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+"/);
  for (const referenceClass of ["topbar", "main-nav", "hero-card", "community-banner", "offers-toolbar", "floating-community", "site-footer"]) {
    assert.match(html, new RegExp(`class="[^"]*${referenceClass}`));
  }
  assert.doesNotMatch(html, /1\.420|curadoria humana|menor preço histórico|CNPJ 00\.000/i);
  assert.match(html, /styles\.css/);
  assert.match(html, /app\.js/);
  assert.match(css, /@media.*max-width/is);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--brand-black:#0b0e14/i);
  assert.match(css, /--brand-green:#10e548/i);
  assert.match(css, /--canvas:#f8fafc(?:;|})/i);
  assert.match(css, /--surface:#fff(?:;|})/i);
  assert.match(css, /\.brand-logo\{[^}]*border-radius:50%/i);
  assert.match(js, /\/api\/offers/);
  assert.match(js, /\/api\/categories/);
  assert.match(js, /\/api\/site-config/);
  assert.match(js, /chat\.whatsapp\.com/);
  assert.match(js, /textContent/);
  assert.match(js, /product-placeholder\.svg/);
  assert.match(js, /data\.items\.map\(renderOffer\)/);
  assert.match(js, /querySelectorAll\("\.whatsapp-link"\)/);
  assert.match(js, /const hasServerRenderedOffers = elements\.grid\.querySelector\("\.offer-card"\) !== null/);
  assert.match(js, /if \(!hasServerRenderedOffers \|\| hasInteractiveFilters\) await loadOffers\(\)/);
  assert.doesNotMatch(js, /selectCategory\(initialCategory\);\s*$/);
  assert.match(js, /href = `\/categoria\/\$\{category\.id\}`/);
  assert.match(html, /id="offer-grid"/);
  assert.match(html, /<noscript>/);
  assert.match(favicon, /<svg/);
  assert.equal(logo.subarray(0, 3).toString("hex"), "ffd8ff");
  assert.match(placeholder, /<svg/);
});

test("redirects www to the single canonical storefront host", async () => {
  const caddy = await readFile(new URL("../../Caddyfile", import.meta.url), "utf8");
  assert.match(caddy, /www\.promomega\.com\.br\s*\{[\s\S]*?redir https:\/\/promomega\.com\.br\{uri\} permanent/);
  assert.match(caddy, /promomega\.com\.br\s*\{[\s\S]*?import promomega_app/);
});
