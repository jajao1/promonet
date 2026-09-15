import test from "node:test";
import assert from "node:assert/strict";
import { renderHomePage, renderCategoryPage, renderOfferPage, renderErrorPage } from "../seo-renderer.mjs";

const offer = { status: "active", category: "games", itemId: "MLB1", title: `Controle <script>alert("x")</script>`, price: 379.9, originalPrice: 499.9, imageUrl: "https://http2.mlstatic.com/a.jpg", publishedAt: "2026-09-14T12:00:00Z" };

test("renders an indexable home page without trusting offer data", () => {
  const output = renderHomePage({ offers: [offer], total: 1, categories: [{ id: "games", count: 1 }], whatsAppGroupUrl: "" });
  assert.match(output, /<h1>/);
  assert.match(output, /rel="canonical" href="https:\/\/promomega\.com\.br\/"/);
  assert.match(output, /href="\/categoria\/games"/);
  assert.match(output, /href="\/oferta\/games\/MLB1"/);
  assert.doesNotMatch(output, /<script>alert/);
  assert.match(output, /"@type":"WebSite"/);
  assert.match(output, /fetchpriority="high"/);
});

test("renders unique category metadata and breadcrumb data", () => {
  const output = renderCategoryPage({ category: { slug: "games", name: "Games", description: "Jogos e consoles." }, offers: [offer], total: 1 });
  assert.match(output, /<title>Ofertas de Games/);
  assert.match(output, /https:\/\/promomega\.com\.br\/categoria\/games/);
  assert.match(output, /"@type":"CollectionPage"/);
  assert.match(output, /"@type":"BreadcrumbList"/);
});

test("renders active and expired product pages without invented claims", () => {
  const active = renderOfferPage({ offer, related: [] });
  assert.match(active, /"@type":"Product"/);
  assert.match(active, /"@type":"Offer"/);
  assert.match(active, /\\u003cscript/);
  assert.match(active, /href="\/ir\/games\/MLB1"/);
  assert.doesNotMatch(active, /aggregateRating|shippingDetails|priceValidUntil|itemCondition|availability/);
  const expired = renderOfferPage({ offer: { ...offer, status: "expired" }, related: [] });
  assert.match(expired, /name="robots" content="noindex,follow"/);
  assert.match(expired, /Esta oferta pode ter expirado/);
});

test("rejects unsafe images and renders noindex error pages", () => {
  const output = renderHomePage({ offers: [{ ...offer, imageUrl: "https://evil.example/tracker.jpg" }], total: 1, categories: [], whatsAppGroupUrl: "" });
  assert.doesNotMatch(output, /evil\.example/);
  assert.match(output, /product-placeholder\.svg/);
  assert.match(renderErrorPage({ status: 410, title: "Oferta indisponível", message: "Não está mais ativa." }), /noindex,follow/);
});
