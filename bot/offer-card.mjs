import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import sharp from "sharp";

const ERROR_MESSAGE = "offer_image_invalid";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_INPUT_DIMENSION = 10_000;
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

    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) throw invalid();
      total += chunk.byteLength;
      if (total > MAX_IMAGE_BYTES) throw invalid();
      chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    if (total === 0 || (expectedLength !== null && total !== expectedLength)) throw invalid();
    const buffer = Buffer.concat(chunks, total);
    await validateRaster(buffer, SAFE_IMAGE_FORMATS);
    return buffer;
  } catch {
    throw invalid();
  }
}

function validateOffer(offer) {
  if (!offer || typeof offer !== "object" || typeof offer.title !== "string" || !offer.title.trim() ||
      offer.title.length > 500 || !Number.isFinite(offer.price) || offer.price <= 0 ||
      typeof offer.imageUrl !== "string") throw invalid();
  if (offer.originalPrice !== null && offer.originalPrice !== undefined &&
      (!Number.isFinite(offer.originalPrice) || offer.originalPrice <= 0)) throw invalid();
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

function titleLines(title) {
  const words = title.trim().replace(/\s+/g, " ").split(" ").map((word) =>
    word.length > 24 ? `${word.slice(0, 23)}…` : word);
  const lines = [""];
  for (const word of words) {
    const line = lines.at(-1);
    if (!line || `${line} ${word}`.length <= 43) lines[lines.length - 1] = line ? `${line} ${word}` : word;
    else if (lines.length === 1) lines.push(word);
    else {
      lines[1] = `${lines[1]} ${word}`;
    }
  }
  if (lines[1]?.length > 47) lines[1] = `${lines[1].slice(0, 46).trimEnd()}…`;
  return lines.slice(0, 2);
}

function overlaySvg(offer) {
  const discount = Number.isFinite(offer.originalPrice) && offer.originalPrice > offer.price
    ? Math.round((offer.originalPrice - offer.price) / offer.originalPrice * 100)
    : 0;
  const lines = titleLines(offer.title).map(escapeSvg);
  const currentPrice = escapeSvg(money.format(offer.price));
  const priorPrice = discount ? escapeSvg(money.format(offer.originalPrice)) : "";
  const badge = discount ? `<g><rect x="814" y="48" width="218" height="70" rx="35" fill="#36f35b"/><text x="923" y="94" text-anchor="middle" class="badge">${escapeSvg(`${discount}% OFF`)}</text></g>` : "";
  const secondLine = lines[1] ? `<text x="64" y="958" class="title">${lines[1]}</text>` : "";
  const prior = discount ? `<text x="66" y="997" class="prior">De ${priorPrice}</text><line x1="65" y1="988" x2="285" y2="988" stroke="#aeb7b1" stroke-width="4"/>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <style>
      text { font-family: Arial, "DejaVu Sans", sans-serif; }
      .brand { font-size: 43px; font-weight: 800; fill: #101512; letter-spacing: -1px; }
      .brand-accent { fill: #17a93e; }
      .badge { font-size: 29px; font-weight: 900; fill: #101512; }
      .label { font-size: 21px; font-weight: 800; fill: #36f35b; letter-spacing: 2px; }
      .title { font-size: 38px; font-weight: 750; fill: #f7f8f7; }
      .prior { font-size: 27px; font-weight: 500; fill: #aeb7b1; }
      .price { font-size: 65px; font-weight: 900; fill: #ffffff; letter-spacing: -2px; }
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
    <text x="64" y="1060" class="price">${currentPrice}</text>
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
    const [productLayer, logoLayer] = await Promise.all([renderProduct(source), renderLogo(logo)]);
    return await sharp({ create: { width: 1080, height: 1080, channels: 3, background: CANVAS } })
      .composite([
        { input: productLayer, left: 130, top: 180 },
        { input: logoLayer, left: 44, top: 28 },
        { input: overlaySvg(offer), left: 0, top: 0 },
      ])
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toBuffer();
  } catch {
    throw invalid();
  }
}
