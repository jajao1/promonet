import test from "node:test";
import assert from "node:assert/strict";
import { canonicalProductUrl, resolveSourceUrl, affiliateResult } from "../url-policy.mjs";

test("accepts and canonicalizes a product URL", () => {
  assert.equal(canonicalProductUrl("https://produto.mercadolivre.com.br/MLB-1234567890-item?utm_source=x#y"), "https://produto.mercadolivre.com.br/MLB-1234567890-item");
});

test("accepts a catalog product URL whose MLB identifier has no hyphen", () => {
  assert.equal(canonicalProductUrl("https://www.mercadolivre.com.br/controle-sony/p/MLB18010993#recommendation"), "https://www.mercadolivre.com.br/controle-sony/p/MLB18010993");
});

test("rejects search, account and external URLs", () => {
  for (const url of ["https://lista.mercadolivre.com.br/fone", "https://www.mercadolivre.com.br/minha-conta", "https://example.com/MLB-1234567890"]) assert.throws(() => canonicalProductUrl(url), /ineligible_url/);
});

test("accepts only HTTPS meli.la output", () => {
  assert.equal(affiliateResult("https://meli.la/AbC123"), "https://meli.la/AbC123");
  assert.throws(() => affiliateResult("http://meli.la/AbC123"), /invalid_affiliate_result/);
});

test("resolves meli.la through an official redirect", async () => {
  const fetch = async () => new Response(null, { status: 302, headers: { location: "https://produto.mercadolivre.com.br/MLB-1234567890-item" } });
  assert.equal(await resolveSourceUrl("https://meli.la/Source1", { fetch }), "https://produto.mercadolivre.com.br/MLB-1234567890-item");
});

test("blocks redirects leaving official hosts", async () => {
  const fetch = async () => new Response(null, { status: 302, headers: { location: "https://evil.example/MLB-1234567890" } });
  await assert.rejects(() => resolveSourceUrl("https://meli.la/Source1", { fetch }), /ineligible_url/);
});
