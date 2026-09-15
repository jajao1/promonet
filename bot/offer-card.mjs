import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import sharp from "sharp";

const ERROR_MESSAGE = "offer_image_invalid";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_INPUT_DIMENSION = 10_000;
const MAX_COMMERCIAL_PRICE = 99_999_999.99;
const TEXT_PROBE_WIDTH = 4096;
const TEXT_MAX_WIDTH = 944;
const CANVAS = "#f7f8f7";
const SAFE_IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);
const SAFE_LOGO_FORMATS = new Set(["jpeg", "png", "webp"]);
const SAFE_LOGO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function invalid() {
  return new Error(ERROR_MESSAGE);
}

function escapeSvg(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function trustedProductUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "mlstatic.com" && !host.endsWith(".mlstatic.com"))) throw invalid();
  return url.href;
}

function headerValue(headers, name) {
  if (!headers || typeof headers.get !== "function") throw invalid();
  return headers.get(name);
}

function declaredLength(headers) {
  const value = headerValue(headers, "content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw invalid();
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_IMAGE_BYTES) throw invalid();
  return length;
}

function dimensionsAreSafe(metadata) {
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  const pages = metadata.pages ?? 1;
  return Number.isInteger(width) && Number.isInteger(height) && Number.isInteger(pages) &&
    width > 0 && height > 0 && pages > 0 &&
    width <= MAX_INPUT_DIMENSION && height <= MAX_INPUT_DIMENSION &&
    width * height * pages <= MAX_INPUT_PIXELS;
}

async function validateRaster(buffer, allowedFormats) {
  const image = sharp(buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true });
  const metadata = await image.metadata();
  if (!allowedFormats.has(metadata.format) || !dimensionsAreSafe(metadata)) throw invalid();
  await image.clone().rotate().resize(1, 1, { fit: "fill" }).raw().toBuffer();
  return metadata;
}

export async function downloadProductImage(url, { fetch = globalThis.fetch } = {}) {
  try {
    const safeUrl = trustedProductUrl(url);
    if (typeof fetch !== "function") throw invalid();
    const response = await fetch(safeUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 299) throw invalid();
    const contentType = headerValue(response.headers, "content-type");
    if (typeof contentType !== "string" || !/^image\//i.test(contentType.trim())) throw invalid();
    const expectedLength = declaredLength(response.headers);
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") throw invalid();

    const sink = Buffer.allocUnsafe(MAX_IMAGE_BYTES);
    let total = 0;
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) throw invalid();
      if (chunk.byteLength > MAX_IMAGE_BYTES - total) throw invalid();
      sink.set(chunk, total);
      total += chunk.byteLength;
    }
    if (total === 0 || (expectedLength !== null && total !== expectedLength)) throw invalid();
    const buffer = Buffer.from(sink.subarray(0, total));
    await validateRaster(buffer, SAFE_IMAGE_FORMATS);
    return buffer;
  } catch {
    throw invalid();
  }
}

function validateOffer(offer) {
  if (!offer || typeof offer !== "object" || typeof offer.title !== "string" || !offer.title.trim() ||
      offer.title.length > 500 || !Number.isFinite(offer.price) || offer.price <= 0 || offer.price > MAX_COMMERCIAL_PRICE ||
      typeof offer.imageUrl !== "string") throw invalid();
  if (offer.originalPrice !== null && offer.originalPrice !== undefined &&
      (!Number.isFinite(offer.originalPrice) || offer.originalPrice <= 0 || offer.originalPrice > MAX_COMMERCIAL_PRICE)) throw invalid();
}

async function loadLogo(logoPath) {
  if (typeof logoPath !== "string" || !isAbsolute(logoPath) || !SAFE_LOGO_EXTENSIONS.has(extname(logoPath).toLowerCase())) throw invalid();
  const information = await stat(logoPath);
  if (!information.isFile() || information.size <= 0 || information.size > MAX_LOGO_BYTES) throw invalid();
  const buffer = await readFile(logoPath);
  if (buffer.length !== information.size || buffer.length > MAX_LOGO_BYTES) throw invalid();
  await validateRaster(buffer, SAFE_LOGO_FORMATS);
  return buffer;
}

async function measureText(text, { fontSize, fontWeight }) {
  const height = Math.ceil(fontSize * 2);
  const baseline = Math.ceil(fontSize * 1.45);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_PROBE_WIDTH}" height="${height}"><text x="2" y="${baseline}" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="white">${escapeSvg(text)}</text></svg>`);
  const { info } = await sharp(svg).trim().png().toBuffer({ resolveWithObject: true });
  return info.width;
}

async function truncateToWidth(text, maximumWidth, style) {
  const characters = Array.from(text);
  const suffix = "…";
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join("").trimEnd()}${suffix}`;
    if (await measureText(candidate, style) <= maximumWidth) low = middle;
    else high = middle - 1;
  }
  if (low === 0 && await measureText(suffix, style) > maximumWidth) throw invalid();
  return `${characters.slice(0, low).join("").trimEnd()}${suffix}`;
}

async function titleLines(title) {
  const style = { fontSize: 38, fontWeight: 700 };
  const normalized = title.trim().replace(/\s+/g, " ");
  if (await measureText(normalized, style) <= TEXT_MAX_WIDTH) return [normalized];

  const words = normalized.split(" ");
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (await measureText(words.slice(0, middle).join(" "), style) <= TEXT_MAX_WIDTH) low = middle;
    else high = middle - 1;
  }

  const firstLine = low > 0
    ? words.slice(0, low).join(" ")
    : await truncateToWidth(words[0], TEXT_MAX_WIDTH, style);
  const remaining = words.slice(Math.max(low, 1)).join(" ");
  if (!remaining) return [firstLine];
  const secondLine = await measureText(remaining, style) <= TEXT_MAX_WIDTH
    ? remaining
    : await truncateToWidth(remaining, TEXT_MAX_WIDTH, style);
  return [firstLine, secondLine];
}

async function fittingFontSize(text, preferred, minimum, fontWeight) {
  let fontSize = preferred;
  const measured = await measureText(text, { fontSize, fontWeight });
  if (measured > TEXT_MAX_WIDTH) fontSize = Math.max(minimum, Math.floor(fontSize * TEXT_MAX_WIDTH / measured));
  while (fontSize >= minimum && await measureText(text, { fontSize, fontWeight }) > TEXT_MAX_WIDTH) fontSize -= 1;
  if (fontSize < minimum) throw invalid();
  return fontSize;
}

async function overlaySvg(offer) {
  const hasPriorPrice = Number.isFinite(offer.originalPrice) && offer.originalPrice > offer.price;
  const discount = hasPriorPrice ? (offer.originalPrice - offer.price) / offer.originalPrice * 100 : 0;
  const roundedDiscount = Math.round(discount);
  const lines = (await titleLines(offer.title)).map(escapeSvg);
  const currentPrice = escapeSvg(money.format(offer.price));
  const priorText = hasPriorPrice ? `De ${money.format(offer.originalPrice)}` : "";
  const currentFontSize = await fittingFontSize(money.format(offer.price), 65, 44, 900);
  const priorWidth = hasPriorPrice ? await measureText(priorText, { fontSize: 27, fontWeight: 500 }) : 0;
  if (priorWidth > TEXT_MAX_WIDTH) throw invalid();
  const badgeText = escapeSvg(roundedDiscount < 1 ? "<1% OFF" : `${roundedDiscount}% OFF`);
  const badge = hasPriorPrice ? `<g><rect x="814" y="48" width="218" height="70" rx="35" fill="#36f35b"/><text x="923" y="94" text-anchor="middle" class="badge">${badgeText}</text></g>` : "";
  const secondLine = lines[1] ? `<text x="64" y="958" class="title">${lines[1]}</text>` : "";
  const prior = hasPriorPrice ? `<text x="66" y="997" class="prior">${escapeSvg(priorText)}</text><line x1="65" y1="988" x2="${Math.ceil(66 + priorWidth)}" y2="988" stroke="#aeb7b1" stroke-width="4"/>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <style>
      text { font-family: "DejaVu Sans", sans-serif; }
      .brand { font-size: 43px; font-weight: 800; fill: #101512; letter-spacing: -1px; }
      .brand-accent { fill: #17a93e; }
      .badge { font-size: 29px; font-weight: 900; fill: #101512; }
      .label { font-size: 21px; font-weight: 800; fill: #36f35b; letter-spacing: 2px; }
      .title { font-size: 38px; font-weight: 700; fill: #f7f8f7; }
      .prior { font-size: 27px; font-weight: 500; fill: #aeb7b1; }
      .price { font-weight: 900; fill: #ffffff; letter-spacing: -2px; }
    </style>
    <text x="172" y="84" class="brand">Promo<tspan class="brand-accent">Mega</tspan></text>
    <text x="173" y="112" font-size="17" font-weight="700" fill="#59635d" letter-spacing="1.6">OFERTAS DE VERDADE</text>
    ${badge}
    <rect x="0" y="830" width="1080" height="250" fill="#101512"/>
    <rect x="0" y="830" width="1080" height="9" fill="#36f35b"/>
    <text x="64" y="875" class="label">OFERTA EM DESTAQUE</text>
    <text x="64" y="920" class="title">${lines[0]}</text>
    ${secondLine}
    ${prior}
    <text x="64" y="1060" class="price" font-size="${currentFontSize}">${currentPrice}</text>
  </svg>`);
}

async function renderProduct(buffer) {
  return sharp(buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
    .rotate()
    .resize(820, 650, { fit: "contain", background: CANVAS, withoutEnlargement: false })
    .png()
    .toBuffer();
}

async function renderLogo(buffer) {
  const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104"><rect width="104" height="104" rx="24" fill="white"/></svg>');
  return sharp(buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(104, 104, { fit: "cover" })
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export async function composeOfferCard(offer, { fetch = globalThis.fetch, logoPath } = {}) {
  try {
    validateOffer(offer);
    const [source, logo] = await Promise.all([
      downloadProductImage(offer.imageUrl, { fetch }),
      loadLogo(logoPath),
    ]);
    const [productLayer, logoLayer, overlayLayer] = await Promise.all([renderProduct(source), renderLogo(logo), overlaySvg(offer)]);
    return await sharp({ create: { width: 1080, height: 1080, channels: 3, background: CANVAS } })
      .composite([
        { input: productLayer, left: 130, top: 180 },
        { input: logoLayer, left: 44, top: 28 },
        { input: overlayLayer, left: 0, top: 0 },
      ])
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toBuffer();
  } catch {
    throw invalid();
  }
}
