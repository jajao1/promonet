import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { composeOfferCard } from "../bot/offer-card.mjs";

const DEFAULT_LOGO_PATH = "/app/site/logo.jpg";

function offlineFetch(image) {
  return async () => new Response(image, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(image.length),
    },
  });
}

export async function runOfferCardSmoke({ logoPath = DEFAULT_LOGO_PATH, iterations = 3 } = {}) {
  if (!Number.isSafeInteger(iterations) || iterations < 2 || iterations > 10) throw new Error("offer_card_smoke_invalid");
  const product = await sharp({
    create: { width: 360, height: 540, channels: 3, background: "#2468d3" },
  }).png().toBuffer();
  const offer = {
    title: "Produto de teste determinístico",
    price: 799.9,
    originalPrice: 999.9,
    imageUrl: "https://http2.mlstatic.com/offline-smoke.png",
  };

  let expected;
  for (let index = 0; index < iterations; index += 1) {
    const rendered = await composeOfferCard(offer, { fetch: offlineFetch(product), logoPath });
    if (expected && !rendered.equals(expected)) throw new Error("offer_card_smoke_nondeterministic");
    expected = rendered;
  }
  const metadata = await sharp(expected).metadata();
  if (metadata.format !== "jpeg" || metadata.width !== 1080 || metadata.height !== 1080) throw new Error("offer_card_smoke_invalid");
  return {
    iterations,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    bytes: expected.length,
    digest: createHash("sha256").update(expected).digest("hex"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOfferCardSmoke()
    .then((result) => console.log(JSON.stringify({ event: "offer_card_smoke_ok", ...result })))
    .catch(() => {
      console.error(JSON.stringify({ event: "offer_card_smoke_failed" }));
      process.exitCode = 1;
    });
}
