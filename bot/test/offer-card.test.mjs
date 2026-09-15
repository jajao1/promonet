import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { composeOfferCard, downloadProductImage } from "../offer-card.mjs";

const INVALID = { message: "offer_image_invalid" };
const MIB = 1024 * 1024;
const productUrl = "https://http2.mlstatic.com/D_NQ_NP_123.jpg";

function response(chunks, { status = 200, type = "image/png", length } = {}) {
  const values = chunks.map((chunk) => new Uint8Array(chunk));
  return {
    status,
    headers: new Headers({
      "content-type": type,
      ...(length === undefined ? {} : { "content-length": String(length) }),
    }),
    body: new ReadableStream({
      start(controller) {
        for (const value of values) controller.enqueue(value);
        controller.close();
      },
    }),
  };
}

function fetching(buffer, options = {}) {
  return async (_url, init) => {
    options.inspect?.(init);
    return response([buffer], { length: buffer.length, ...options });
  };
}

async function solid(width, height, color) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

async function findColorBounds(buffer, predicate, area = { left: 0, top: 0, width: 1080, height: 1080 }) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  const right = area.left + area.width;
  const bottom = area.top + area.height;
  for (let y = area.top; y < bottom; y += 1) {
    for (let x = area.left; x < right; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (!predicate(data[offset], data[offset + 1], data[offset + 2])) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function pixelAt(buffer, x, y) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

async function longestHorizontalRun(buffer, predicate, area) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  let longest = null;
  for (let y = area.top; y < area.top + area.height; y += 1) {
    let start = null;
    for (let x = area.left; x <= area.left + area.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const matches = x < area.left + area.width && predicate(data[offset], data[offset + 1], data[offset + 2]);
      if (matches && start === null) start = x;
      if (!matches && start !== null) {
        const run = { left: start, right: x - 1, length: x - start, y };
        if (!longest || run.length > longest.length) longest = run;
        start = null;
      }
    }
  }
  return longest;
}

const offer = {
  title: "Console de videogame com dois controles",
  price: 379.9,
  originalPrice: 499.9,
  imageUrl: productUrl,
  affiliateUrl: "https://secret.example/token-do-not-render",
};

let directory;
let logoPath;

test.before(async () => {
  directory = await mkdtemp(join(tmpdir(), "promomega-card-"));
  logoPath = join(directory, "logo.png");
  await writeFile(logoPath, await solid(160, 160, "#6b23d4"));
});

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("downloads a valid streamed image without following redirects", async () => {
  const source = await solid(24, 18, "#e02090");
  let inspected = false;
  const downloaded = await downloadProductImage(productUrl, {
    fetch: fetching(source, {
      inspect(init) {
        inspected = true;
        assert.equal(init.redirect, "error");
        assert.ok(init.signal instanceof AbortSignal);
      },
    }),
  });
  assert.equal(inspected, true);
  assert.deepEqual(downloaded, source);
});

test("accepts only HTTPS images on the mlstatic.com host boundary", async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; };
  for (const url of [
    "http://http2.mlstatic.com/a.jpg",
    "https://mlstatic.com.evil.example/a.jpg",
    "https://evil.example/a.jpg",
    "not a URL",
  ]) await assert.rejects(downloadProductImage(url, { fetch }), INVALID);
  assert.equal(calls, 0);
});

test("fails closed on redirects, non-images, and unsuccessful responses", async () => {
  for (const options of [
    { status: 302, type: "image/png" },
    { status: 404, type: "image/png" },
    { status: 200, type: "text/html" },
  ]) await assert.rejects(downloadProductImage(productUrl, { fetch: async () => response([Buffer.from("x")], options) }), INVALID);
});

test("enforces declared and streamed 8 MiB limits and detects truncation", async () => {
  await assert.rejects(downloadProductImage(productUrl, {
    fetch: async () => response([Buffer.from("x")], { length: 8 * MIB + 1 }),
  }), INVALID);
  await assert.rejects(downloadProductImage(productUrl, {
    fetch: async () => response([Buffer.alloc(5 * MIB), Buffer.alloc(4 * MIB)]),
  }), INVALID);
  await assert.rejects(downloadProductImage(productUrl, {
    fetch: async () => response([Buffer.from("short")], { length: 20 }),
  }), INVALID);
  await assert.rejects(downloadProductImage(productUrl, {
    fetch: async () => response([], { length: 0 }),
  }), INVALID);
});

test("uses one fixed error for remote failures and malformed image bytes", async () => {
  await assert.rejects(downloadProductImage(productUrl, {
    fetch: async () => { throw new Error(`network secret at ${productUrl}`); },
  }), INVALID);
  await assert.rejects(downloadProductImage(productUrl, {
    fetch: fetching(Buffer.from("not an image")),
  }), INVALID);
});

test("rejects decoded pixel bombs", async () => {
  const bomb = await solid(7000, 7000, "#ffffff");
  await assert.rejects(downloadProductImage(productUrl, { fetch: fetching(bomb) }), INVALID);
});

test("renders a deterministic 1080-square JPEG with branded regions and no URL-dependent pixels", async () => {
  const source = await solid(400, 400, "#f05a28");
  const fetch = fetching(source);
  const first = await composeOfferCard(offer, { fetch, logoPath });
  const second = await composeOfferCard({ ...offer, affiliateUrl: "https://other.invalid/private" }, { fetch, logoPath });
  assert.deepEqual(first, second);
  const metadata = await sharp(first).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);

  const logo = await findColorBounds(first, (r, g, b) => b > 120 && r > 50 && r > g * 1.5, { left: 30, top: 20, width: 140, height: 140 });
  const badge = await findColorBounds(first, (r, g, b) => g > 160 && g > r * 1.5 && g > b * 1.3, { left: 780, top: 30, width: 260, height: 120 });
  const footer = await findColorBounds(first, (r, g, b) => r < 40 && g < 45 && b < 45, { left: 0, top: 820, width: 1080, height: 260 });
  const priorPrice = await findColorBounds(first, (r, g, b) => r > 120 && r < 220 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25, { left: 50, top: 965, width: 300, height: 45 });
  const currentPrice = await findColorBounds(first, (r, g, b) => r > 225 && g > 225 && b > 225, { left: 50, top: 1005, width: 430, height: 70 });
  assert.ok(logo && logo.width > 70 && logo.height > 70, "rounded logo is visible");
  assert.ok(badge && badge.width > 100 && badge.height > 35, "green discount badge is visible");
  assert.ok(footer && footer.width > 1000 && footer.height > 230, "dark price footer is visible");
  assert.ok(priorPrice && priorPrice.width > 100, "smaller struck-through prior price is visible");
  assert.ok(currentPrice && currentPrice.width > 180, "prominent current price is visible");
  const logoCorner = await pixelAt(first, 45, 29);
  assert.ok(logoCorner.every((channel) => channel > 220), "logo corners are rounded to the canvas");
});

test("contains portrait, landscape, and square products without distortion", async () => {
  const cases = [
    { width: 200, height: 600, color: "#e02090", pixel: (r, g, b) => r > 160 && b > 90 && g < 90 },
    { width: 600, height: 200, color: "#10aee5", pixel: (r, g, b) => b > 150 && g > 110 && r < 80 },
    { width: 400, height: 400, color: "#f39a24", pixel: (r, g, b) => r > 180 && g > 90 && g < 190 && b < 80 },
  ];
  for (const item of cases) {
    const source = await solid(item.width, item.height, item.color);
    const card = await composeOfferCard(offer, { fetch: fetching(source), logoPath });
    const bounds = await findColorBounds(card, item.pixel, { left: 130, top: 180, width: 820, height: 650 });
    assert.ok(bounds, `${item.width}x${item.height} product is visible`);
    const renderedRatio = bounds.width / bounds.height;
    const sourceRatio = item.width / item.height;
    assert.ok(Math.abs(renderedRatio - sourceRatio) < 0.04, `${item.width}x${item.height} aspect ratio is preserved`);
    assert.ok(bounds.left >= 129 && bounds.top >= 179 && bounds.left + bounds.width <= 951 && bounds.top + bounds.height <= 831);
    if (item.width === 200) assert.ok(bounds.height > 630, "portrait uses the full 820x650 product region height");
  }
});

test("auto-orients product images before containing them", async () => {
  const source = await sharp({ create: { width: 200, height: 600, channels: 3, background: "#e02090" } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const card = await composeOfferCard(offer, { fetch: fetching(source, { type: "image/jpeg" }), logoPath });
  const bounds = await findColorBounds(card, (r, g, b) => r > 160 && b > 90 && g < 90, { left: 130, top: 180, width: 820, height: 650 });
  assert.ok(bounds.width / bounds.height > 2.8, "EXIF orientation is applied before fitting");
});

test("escapes SVG metacharacters in every dynamic text value", async () => {
  const source = await solid(200, 200, "#10aee5");
  const hostile = {
    ...offer,
    title: `<>&\"' </text><script>throw new Error('owned')</script>`,
    price: 1234.56,
    originalPrice: 2000,
  };
  const card = await composeOfferCard(hostile, { fetch: fetching(source), logoPath });
  assert.deepEqual(await sharp(card).metadata().then(({ format, width, height }) => ({ format, width, height })), { format: "jpeg", width: 1080, height: 1080 });
});

test("keeps long unbroken title tokens inside the footer margin", async () => {
  const source = await solid(200, 200, "#10aee5");
  const card = await composeOfferCard({ ...offer, title: "W".repeat(500) }, { fetch: fetching(source), logoPath });
  const title = await findColorBounds(card, (r, g, b) => r > 225 && g > 225 && b > 225, { left: 50, top: 885, width: 1030, height: 85 });
  assert.ok(title && title.left >= 63);
  assert.ok(title.left + title.width <= 1017, "title remains inside the 64px horizontal margin");
});

test("keeps multiple wide title tokens inside the footer margin", async () => {
  const source = await solid(200, 200, "#10aee5");
  const wideToken = "W".repeat(23);
  const card = await composeOfferCard({ ...offer, title: `${wideToken} ${wideToken} ${wideToken}` }, { fetch: fetching(source), logoPath });
  const title = await findColorBounds(card, (r, g, b) => r > 225 && g > 225 && b > 225, { left: 50, top: 885, width: 1030, height: 85 });
  assert.ok(title && title.left >= 63);
  assert.ok(title.left + title.width <= 1017, "proportional wide glyphs remain inside the 64px horizontal margin");
});

test("renders a struck prior price when a valid discount rounds below one percent", async () => {
  const source = await solid(200, 200, "#10aee5");
  const card = await composeOfferCard({ ...offer, price: 100, originalPrice: 100.4 }, { fetch: fetching(source), logoPath });
  const prior = await findColorBounds(card, (r, g, b) => r > 120 && r < 220 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25, { left: 50, top: 965, width: 500, height: 45 });
  const strike = await longestHorizontalRun(card, (r, g, b) => r > 120 && r < 220 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25, { left: 50, top: 982, width: 500, height: 14 });
  assert.ok(prior && prior.width > 100, "valid prior price remains visible");
  assert.ok(strike && strike.length > 120, "prior price has a continuous strike-through");
});

test("bounds commercial prices and keeps the largest supported price inside the footer", async () => {
  const source = await solid(200, 200, "#10aee5");
  const fetch = fetching(source);
  const maximum = 99_999_999.99;
  const card = await composeOfferCard({ ...offer, price: maximum, originalPrice: null }, { fetch, logoPath });
  const currentPrice = await findColorBounds(card, (r, g, b) => r > 225 && g > 225 && b > 225, { left: 50, top: 1005, width: 1030, height: 70 });
  assert.ok(currentPrice && currentPrice.left >= 63);
  assert.ok(currentPrice.left + currentPrice.width <= 1017, "maximum supported current price remains inside the 64px horizontal margin");

  for (const invalidOffer of [
    { ...offer, price: Number.MAX_VALUE },
    { ...offer, originalPrice: Number.MAX_VALUE },
  ]) await assert.rejects(composeOfferCard(invalidOffer, { fetch, logoPath }), INVALID);
});

test("renders valid no-discount offers without a prior-price badge", async () => {
  const source = await solid(200, 200, "#10aee5");
  const card = await composeOfferCard({ ...offer, originalPrice: null }, { fetch: fetching(source), logoPath });
  assert.equal((await sharp(card).metadata()).format, "jpeg");
});

test("rejects invalid offer fields and unsafe or invalid logos with one fixed error", async () => {
  const source = await solid(200, 200, "#10aee5");
  const fetch = fetching(source);
  for (const invalidOffer of [
    null,
    { ...offer, title: "" },
    { ...offer, price: 0 },
    { ...offer, price: Number.NaN },
    { ...offer, imageUrl: "https://evil.example/a.jpg" },
  ]) await assert.rejects(composeOfferCard(invalidOffer, { fetch, logoPath }), INVALID);

  await assert.rejects(composeOfferCard(offer, { fetch, logoPath: "https://example.com/logo.png" }), INVALID);
  const invalidLogo = join(directory, "invalid.jpg");
  await writeFile(invalidLogo, "not an image");
  await assert.rejects(composeOfferCard(offer, { fetch, logoPath: invalidLogo }), INVALID);
  const largeLogo = join(directory, "large.png");
  await writeFile(largeLogo, Buffer.alloc(2 * MIB + 1));
  await assert.rejects(composeOfferCard(offer, { fetch, logoPath: largeLogo }), INVALID);
});
