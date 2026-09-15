import { categoryBySlug, storefrontCategories } from "./storefront-catalog.mjs";

const ORIGIN = "https://promomega.com.br";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const html = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const jsonLd = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
const absolute = (path) => new URL(path, ORIGIN).href;
const pathForOffer = (offer) => `/oferta/${encodeURIComponent(offer.category)}/${encodeURIComponent(offer.itemId)}`;

function imageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "mlstatic.com" || host.endsWith(".mlstatic.com")) ? url.href : "/product-placeholder.svg";
  } catch { return "/product-placeholder.svg"; }
}

function categoryName(slug) { return categoryBySlug(slug)?.name ?? slug; }
function discount(offer) { return Number.isFinite(offer.originalPrice) && offer.originalPrice > offer.price ? Math.round((offer.originalPrice - offer.price) / offer.originalPrice * 100) : 0; }
function date(value) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value)); }

function layout({ title, description, canonicalPath, robots = "index,follow", image = "/logo.jpg", type = "website", body, schemas = [], interactive = false }) {
  const canonical = absolute(canonicalPath);
  const socialImage = absolute(imageUrl(image) === "/product-placeholder.svg" && image !== "/product-placeholder.svg" ? "/logo.jpg" : imageUrl(image));
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#ffffff">
<title>${html(title)}</title><meta name="description" content="${html(description)}"><meta name="robots" content="${html(robots)}">
<link rel="canonical" href="${html(canonical)}"><link rel="icon" type="image/jpeg" href="/logo.jpg"><link rel="stylesheet" href="/styles.css">
<meta property="og:type" content="${html(type)}"><meta property="og:site_name" content="PromoMega"><meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(description)}"><meta property="og:url" content="${html(canonical)}"><meta property="og:image" content="${html(socialImage)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${html(title)}"><meta name="twitter:description" content="${html(description)}"><meta name="twitter:image" content="${html(socialImage)}">
${schemas.map((schema) => `<script type="application/ld+json">${jsonLd(schema)}</script>`).join("\n")}${interactive ? '<script src="/app.js" type="module"></script>' : ""}
</head><body><a class="skip-link" href="#conteudo">Ir para o conteúdo</a>${header()}<main id="conteudo"><div class="page-shell">${body}</div></main>${footer()}</body></html>`;
}

function header() {
  return `<header class="topbar"><div class="header-inner"><div class="header-row">
<a class="brand" href="/" aria-label="PromoMega, página inicial"><img class="brand-logo" src="/logo.jpg" alt="PromoMega" width="48" height="48"><strong>Promo<span>Mega</span></strong></a>
<form class="header-search" role="search" id="search-form" action="/" method="get"><label class="sr-only" for="offer-search">Buscar ofertas</label><input id="offer-search" name="q" type="search" maxlength="100" placeholder="Busque produtos ou promoções..."><button type="submit">Buscar</button></form>
</div></div></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="footer-grid"><div class="footer-about"><div class="footer-brand"><img class="brand-logo" src="/logo.jpg" alt="PromoMega" width="54" height="54"><strong>Promo<span>Mega</span></strong></div><p>Ofertas encontradas e publicadas automaticamente.</p></div><div><h2>Transparência</h2><p>Podemos receber comissão, sem custo adicional para você.</p></div></div><div class="footer-bottom"><p>© ${new Date().getFullYear()} PromoMega</p><p>Preços e disponibilidade podem mudar na loja.</p></div></footer>`;
}

function categoryLinks(categories, active = "") {
  const counts = new Map(categories.map((category) => [category.id, category.count]));
  return `<nav class="main-nav" aria-label="Categorias de ofertas"><div id="category-list" class="category-list"><a href="/" class="category-chip${active ? "" : " active"}" data-category="">Em alta</a>${storefrontCategories.filter(({ slug }) => counts.has(slug)).map(({ slug, name }) => `<a href="/categoria/${slug}" class="category-chip${slug === active ? " active" : ""}" data-category="${slug}">${html(name)} (${counts.get(slug)})</a>`).join("")}</div></nav>`;
}

function card(offer, index = 1) {
  const percent = discount(offer);
  const image = imageUrl(offer.imageUrl);
  return `<article class="offer-card"><div class="offer-top">${percent ? `<span class="discount-badge">${percent}% OFF</span>` : ""}<span class="recent-badge">Recente</span></div><div class="image-wrap"><a href="${pathForOffer(offer)}"><img class="product-image" src="${html(image)}" alt="${html(offer.title)}" width="300" height="300" ${index === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} referrerpolicy="no-referrer"></a></div><div class="offer-content"><p class="marketplace">Mercado Livre</p><h3 class="offer-title"><a href="${pathForOffer(offer)}">${html(offer.title)}</a></h3><div class="price-block">${percent ? `<del class="original-price">${money.format(offer.originalPrice)}</del>` : ""}<strong class="current-price">${money.format(offer.price)}</strong></div><p class="updated-at">Publicada em ${html(date(offer.publishedAt))}</p><a class="offer-link" href="${pathForOffer(offer)}">Ver promoção <span aria-hidden="true">→</span></a></div></article>`;
}

function grid(offers) { return `<div id="offer-grid" class="offer-grid" aria-busy="false">${offers.map(card).join("")}</div>`; }
function disclosure() { return `<p class="affiliate-disclosure"><strong>Publicidade:</strong> podemos receber uma comissão pelas compras realizadas, sem custo adicional para você. Preços e disponibilidade podem mudar na loja.</p>`; }

export function renderHomePage({ offers, total, categories, whatsAppGroupUrl = "" }) {
  const schemas = [
    { "@context": "https://schema.org", "@type": "WebSite", name: "PromoMega", url: `${ORIGIN}/`, description: "Ofertas recentes verificadas em diversas categorias." },
    { "@context": "https://schema.org", "@type": "Organization", name: "PromoMega", url: `${ORIGIN}/`, logo: `${ORIGIN}/logo.jpg` },
  ];
  const community = whatsAppGroupUrl ? `<a class="whatsapp-link header-community" href="${html(whatsAppGroupUrl)}" target="_blank" rel="noopener noreferrer">Entrar no WhatsApp</a>` : "";
  const body = `${categoryLinks(categories)}<section class="hero-card"><div class="hero-copy"><p class="live-label">Ofertas atualizadas automaticamente</p><h1>As melhores promoções da internet <span>em um só lugar.</span></h1><p>Compare ofertas recentes e acesse diretamente a loja.</p>${community}</div></section><section class="offers-section" id="ofertas" aria-labelledby="offers-title"><div class="section-heading"><div><h2 id="offers-title">Ofertas em destaque</h2><p id="results-summary">${total} ofertas encontradas</p></div><label class="sort-control">Ordenar <select id="offer-sort"><option value="recent">Mais recentes</option><option value="discount">Maior desconto</option></select></label></div><div id="status" class="status" role="status" aria-live="polite"></div>${grid(offers)}<div class="load-more-wrap"><button id="load-more" class="secondary-button" type="button" hidden>Carregar mais ofertas</button></div><div id="empty-state" class="message-card" hidden><h3>Nenhuma oferta encontrada</h3><button id="clear-filters">Limpar filtros</button></div><div id="error-state" class="message-card" hidden><h3>Não foi possível carregar as ofertas</h3><button id="retry-load">Tentar novamente</button></div></section>${disclosure()}${offerTemplate()}<noscript><p>As ofertas e categorias desta página podem ser acessadas sem JavaScript.</p></noscript>`;
  return layout({ title: "PromoMega — Ofertas e promoções recentes", description: "Ofertas recentes verificadas em tecnologia, ferramentas, tênis, casa, beleza e mais.", canonicalPath: "/", body, schemas, interactive: true });
}

export function renderCategoryPage({ category, offers, total, categories = [] }) {
  const path = `/categoria/${category.slug}`;
  const schemas = [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: `Ofertas de ${category.name}`, description: category.description, url: absolute(path) },
    breadcrumbSchema([{ name: "Início", path: "/" }, { name: category.name, path }]),
  ];
  const body = `${categoryLinks(categories, category.slug)}<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Início</a><span aria-hidden="true">›</span><span>${html(category.name)}</span></nav><header class="category-intro"><h1>Ofertas de ${html(category.name)}</h1><p>${html(category.description)}</p></header><section class="offers-section" aria-labelledby="offers-title"><div class="section-heading"><h2 id="offers-title">Promoções recentes</h2><p id="results-summary">${total} ofertas encontradas</p><label class="sort-control">Ordenar <select id="offer-sort"><option value="recent">Mais recentes</option><option value="discount">Maior desconto</option></select></label></div><div id="status" class="status"></div>${grid(offers)}<button id="load-more" hidden>Carregar mais ofertas</button><div id="empty-state" hidden><button id="clear-filters">Limpar filtros</button></div><div id="error-state" hidden><button id="retry-load">Tentar novamente</button></div></section>${disclosure()}${offerTemplate()}`;
  return layout({ title: `Ofertas de ${category.name} — PromoMega`, description: category.description, canonicalPath: path, body, schemas, interactive: true });
}

function breadcrumbSchema(items) { return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: absolute(item.path) })) }; }

export function renderOfferPage({ offer, related = [] }) {
  const category = categoryBySlug(offer.category) ?? { slug: offer.category, name: categoryName(offer.category) };
  const path = pathForOffer(offer);
  const description = `${offer.title} por ${money.format(offer.price)} no Mercado Livre. Consulte preço e disponibilidade na loja.`;
  const product = { "@context": "https://schema.org", "@type": "Product", name: offer.title, url: absolute(path), offers: { "@type": "Offer", priceCurrency: "BRL", price: Number(offer.price).toFixed(2), url: absolute(path), seller: { "@type": "Organization", name: "Mercado Livre" } } };
  if (imageUrl(offer.imageUrl) !== "/product-placeholder.svg") product.image = imageUrl(offer.imageUrl);
  const schemas = [product, breadcrumbSchema([{ name: "Início", path: "/" }, { name: category.name, path: `/categoria/${category.slug}` }, { name: offer.title, path }])];
  const percent = discount(offer);
  const expired = offer.status === "expired" ? `<aside class="expired-notice"><strong>Esta oferta pode ter expirado.</strong> Confirme o preço e a disponibilidade na loja.</aside>` : "";
  const relatedHtml = related.length ? `<section class="related-offers"><h2>Ofertas relacionadas</h2>${grid(related)}</section>` : "";
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Início</a><span>›</span><a href="/categoria/${html(category.slug)}">${html(category.name)}</a><span>›</span><span>Oferta</span></nav>${expired}<article class="offer-detail"><div class="offer-detail-image"><img src="${html(imageUrl(offer.imageUrl))}" alt="${html(offer.title)}" width="600" height="600" fetchpriority="high" referrerpolicy="no-referrer"></div><div class="offer-detail-copy"><p class="marketplace">Oferta no Mercado Livre</p><h1>${html(offer.title)}</h1>${percent ? `<span class="discount-badge">${percent}% OFF</span><del>${money.format(offer.originalPrice)}</del>` : ""}<strong class="offer-detail-price">${money.format(offer.price)}</strong><p>Publicada em ${html(date(offer.publishedAt))}.</p><a class="offer-link offer-primary-action" href="/ir/${encodeURIComponent(offer.category)}/${encodeURIComponent(offer.itemId)}" rel="sponsored nofollow">Ir para a oferta no Mercado Livre</a><p class="offer-warning">O preço e a disponibilidade podem mudar no Mercado Livre.</p></div></article>${relatedHtml}${disclosure()}`;
  return layout({ title: `${offer.title} em oferta — PromoMega`, description, canonicalPath: path, robots: offer.status === "expired" ? "noindex,follow" : "index,follow", image: offer.imageUrl, type: "product", body, schemas });
}

export function renderErrorPage({ status, title, message }) {
  const body = `<section class="message-card error-page"><p>Erro ${Number(status)}</p><h1>${html(title)}</h1><p>${html(message)}</p><a class="secondary-button" href="/">Ver ofertas recentes</a></section>`;
  return layout({ title: `${title} — PromoMega`, description: message, canonicalPath: "/", robots: "noindex,follow", body });
}

function offerTemplate() {
  return `<template id="offer-template"><article class="offer-card"><div class="offer-top"><span class="discount-badge" hidden></span><span class="recent-badge">Recente</span></div><div class="image-wrap"><img class="product-image" src="/product-placeholder.svg" alt="" loading="lazy" width="300" height="300" referrerpolicy="no-referrer"></div><div class="offer-content"><p class="marketplace">Mercado Livre</p><h3 class="offer-title"></h3><div class="price-block"><del class="original-price" hidden></del><strong class="current-price"></strong></div><p class="updated-at"></p><a class="offer-link">Ver promoção</a></div></article></template>`;
}
