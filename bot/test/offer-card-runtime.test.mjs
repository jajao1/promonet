import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("pins patched Sharp and installs the deterministic DejaVu runtime font", async () => {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
  const dockerfile = await readFile(join(process.cwd(), "Dockerfile"), "utf8");
  const renderer = await readFile(join(process.cwd(), "bot", "offer-card.mjs"), "utf8");
  assert.equal(packageJson.dependencies.sharp, "0.35.4");
  assert.match(dockerfile, /RUN apk add --no-cache[^\n]*fontconfig[^\n]*ttf-dejavu/);
  assert.match(dockerfile, /RUN node scripts\/offer-card-smoke\.mjs/);
  assert.ok(dockerfile.indexOf("apk add --no-cache") < dockerfile.indexOf("USER node"));
  assert.match(renderer, /font-family=["']DejaVu Sans/);
  assert.doesNotMatch(renderer, /font-family[^;\n]*Arial/);
});

test("offline smoke probe renders the production logo repeatedly and deterministically", async () => {
  const { runOfferCardSmoke } = await import("../../scripts/offer-card-smoke.mjs");
  const result = await runOfferCardSmoke({ logoPath: join(process.cwd(), "site", "logo.jpg"), iterations: 3 });
  assert.equal(result.iterations, 3);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1080);
  assert.equal(result.format, "jpeg");
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});
