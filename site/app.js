const state = { query: "", category: "", sort: "recent", page: 1, limit: 24, total: 0, loading: false };
const elements = {
  form: document.querySelector("#search-form"), search: document.querySelector("#offer-search"),
  categories: document.querySelector("#category-list"), sort: document.querySelector("#offer-sort"),
  grid: document.querySelector("#offer-grid"), template: document.querySelector("#offer-template"),
  summary: document.querySelector("#results-summary"), status: document.querySelector("#status"),
  empty: document.querySelector("#empty-state"), error: document.querySelector("#error-state"),
  more: document.querySelector("#load-more"), clear: document.querySelector("#clear-filters"), retry: document.querySelector("#retry-load"),
  whatsApps: document.querySelectorAll(".whatsapp-link"), heroTotal: document.querySelector("#hero-total"),
};
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const categoryNames = { tenis: "Tênis", ferramentas: "Ferramentas", celulares: "Celulares", informatica: "Informática", games: "Games", eletrodomesticos: "Eletrodomésticos", beleza: "Beleza", esportes: "Esportes", automotivo: "Automotivo", bebe: "Bebê" };

function discount(item) {
  return Number.isFinite(item.originalPrice) && item.originalPrice > item.price
    ? Math.round((item.originalPrice - item.price) / item.originalPrice * 100) : 0;
}
function relativeDate(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 2) return "Atualizada agora";
  if (minutes < 60) return `Atualizada há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Atualizada há ${hours} h`;
  return `Atualizada em ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(value))}`;
}
function setText(root, selector, value) { root.querySelector(selector).textContent = value; }
function renderOffer(item) {
  const node = elements.template.content.firstElementChild.cloneNode(true);
  const image = node.querySelector(".product-image");
  image.src = /^https:\/\//.test(item.imageUrl) ? item.imageUrl : "/product-placeholder.svg";
  image.alt = item.title;
  image.addEventListener("error", () => { image.src = "/product-placeholder.svg"; }, { once: true });
  setText(node, ".offer-title", item.title);
  setText(node, ".current-price", money.format(item.price));
  setText(node, ".updated-at", relativeDate(item.publishedAt));
  const original = node.querySelector(".original-price");
  const percent = discount(item);
  if (percent) {
    original.hidden = false; original.textContent = money.format(item.originalPrice);
    const badge = node.querySelector(".discount-badge"); badge.hidden = false; badge.textContent = `${percent}% OFF`;
  }
  const link = node.querySelector(".offer-link");
  if (/^\/oferta\/[a-z0-9_-]{1,50}\/[a-z0-9_-]{1,80}$/i.test(item.redirectUrl)) link.href = item.redirectUrl;
  else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); }
  return node;
}
function showSkeletons() {
  elements.grid.replaceChildren(...Array.from({ length: 8 }, () => Object.assign(document.createElement("div"), { className: "skeleton" })));
}
function updateUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.sort !== "recent") params.set("sort", state.sort);
  const path = state.category ? `/categoria/${state.category}` : "/";
  history.replaceState(null, "", `${path}${params.size ? `?${params}` : ""}`);
}
async function loadOffers({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true; elements.error.hidden = true; elements.empty.hidden = true; elements.more.hidden = true;
  elements.grid.setAttribute("aria-busy", "true");
  if (!append) showSkeletons();
  const params = new URLSearchParams({ sort: state.sort, page: String(state.page), limit: String(state.limit) });
  if (state.query) params.set("q", state.query);
  if (state.category) params.set("category", state.category);
  try {
    const response = await fetch(`/api/offers?${params}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw Error("offers_unavailable");
    const data = await response.json(); state.total = data.total;
    if (elements.heroTotal) elements.heroTotal.textContent = data.total === 1 ? "1 oferta publicada" : `${data.total} ofertas publicadas`;
    const cards = data.items.map(renderOffer);
    if (append) elements.grid.append(...cards); else elements.grid.replaceChildren(...cards);
    const shown = elements.grid.childElementCount;
    elements.summary.textContent = data.total === 1 ? "1 oferta encontrada" : `${data.total} ofertas encontradas`;
    elements.status.textContent = `${cards.length} ofertas carregadas`;
    elements.empty.hidden = data.total !== 0; elements.more.hidden = shown >= data.total;
  } catch {
    if (!append) elements.grid.replaceChildren();
    elements.error.hidden = false; elements.summary.textContent = "Ofertas temporariamente indisponíveis";
  } finally { state.loading = false; elements.grid.setAttribute("aria-busy", "false"); }
}
async function loadCategories() {
  try {
    const response = await fetch("/api/categories", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const { categories } = await response.json();
    const home = document.createElement("a"); home.href = "/"; home.className = "category-chip"; home.dataset.category = ""; home.textContent = "Em alta";
    const links = categories.map((category) => {
      const link = document.createElement("a"); link.href = `/categoria/${category.id}`; link.className = "category-chip";
      link.dataset.category = category.id; link.textContent = `${categoryNames[category.id] ?? category.id} (${category.count})`;
      return link;
    });
    elements.categories.replaceChildren(home, ...links);
  } catch { /* Offers remain usable without category shortcuts. */ }
}
async function loadSiteConfig() {
  try {
    const response = await fetch("/api/site-config", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const { whatsAppGroupUrl } = await response.json();
    const url = new URL(whatsAppGroupUrl);
    if (url.protocol !== "https:" || url.hostname !== "chat.whatsapp.com") return;
    for (const link of elements.whatsApps) {
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.hidden = false;
    }
  } catch { /* The storefront remains usable without the community link. */ }
}
function selectCategory(link, { load = true } = {}) {
  state.category = link?.dataset.category ?? ""; state.page = 1;
  for (const chip of elements.categories.querySelectorAll("a[data-category]")) { const active = chip === link; chip.classList.toggle("active", active); if (active) chip.setAttribute("aria-current", "page"); else chip.removeAttribute("aria-current"); }
  updateUrl(); if (load) loadOffers();
}
let searchTimer;
elements.form.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(searchTimer); state.query = elements.search.value.trim(); state.page = 1; updateUrl(); loadOffers(); });
elements.search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = elements.search.value.trim(); state.page = 1; updateUrl(); loadOffers(); }, 350); });
elements.categories.addEventListener("click", (event) => { const link = event.target.closest("a[data-category]"); if (link && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); selectCategory(link); } });
elements.sort.addEventListener("change", () => { state.sort = elements.sort.value; state.page = 1; updateUrl(); loadOffers(); });
elements.more.addEventListener("click", () => { state.page += 1; loadOffers({ append: true }); });
elements.retry.addEventListener("click", () => loadOffers());
elements.clear.addEventListener("click", () => { state.query = ""; state.category = ""; state.page = 1; elements.search.value = ""; selectCategory(elements.categories.querySelector('[data-category=""]')); });

const initial = new URLSearchParams(location.search);
const categoryPath = location.pathname.match(/^\/categoria\/([a-z0-9_-]{1,50})$/i);
state.query = (initial.get("q") ?? "").slice(0, 100); state.category = categoryPath?.[1] ?? initial.get("category") ?? "";
state.sort = initial.get("sort") === "discount" ? "discount" : "recent";
elements.search.value = state.query; elements.sort.value = state.sort;
const year = document.querySelector("#current-year"); if (year) year.textContent = String(new Date().getFullYear());
const hasServerRenderedOffers = elements.grid.querySelector(".offer-card") !== null;
const hasInteractiveFilters = initial.has("q") || initial.has("sort") || initial.has("page") || initial.has("category");
await loadSiteConfig();
await loadCategories();
const initialCategory = elements.categories.querySelector(`[data-category="${CSS.escape(state.category)}"]`) ?? elements.categories.querySelector('[data-category=""]');
selectCategory(initialCategory, { load: false });
if (!hasServerRenderedOffers || hasInteractiveFilters) await loadOffers();
else elements.grid.setAttribute("aria-busy", "false");
