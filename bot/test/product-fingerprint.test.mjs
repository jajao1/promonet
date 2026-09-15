import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalProductUrl,
  offerIdentities,
  productFingerprint,
} from "../product-fingerprint.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("matches equivalent listings while ignoring color size and sales noise", () => {
  assert.equal(
    productFingerprint("Tênis Nike Revolution 7 Masculino Preto Tam 41"),
    productFingerprint("Nike Tênis Revolution 7 Promoção cor azul tamanho 42"),
  );
});

test("normalizes diacritics punctuation whitespace and listing noise", () => {
  assert.equal(
    productFingerprint("  OFERTA! Câmera de Ação X200 -- frete grátis  "),
    productFingerprint("Camera acao X200"),
  );
});

test("ignores capacity variants but preserves model generations and distinguishing terms", () => {
  assert.equal(
    productFingerprint("Smartphone Samsung Galaxy S23 128GB novo"),
    productFingerprint("Samsung Smartphone Galaxy S23 256 gb promoção"),
  );
  assert.notEqual(
    productFingerprint("Controle Sony DualSense PS5"),
    productFingerprint("Controle Sony DualShock 4 PS4"),
  );
  assert.notEqual(
    productFingerprint("iPhone 15 128GB"),
    productFingerprint("iPhone 15 Pro 128GB"),
  );
  assert.notEqual(
    productFingerprint("Galaxy S24 Ultra 256GB"),
    productFingerprint("Galaxy S24 Plus 256GB"),
  );
});

test("keeps meaningful bundle quantities distinct", () => {
  assert.notEqual(
    productFingerprint("Kit 2 Controles Sony DualSense PS5"),
    productFingerprint("Controle Sony DualSense PS5"),
  );
});

test("canonicalizes query ordering and removes fragments and tracking parameters", () => {
  const first = canonicalProductUrl(
    "https://produto.mercadolivre.com.br/MLB-1234567890-item?utm_source=email&variation=2&attributes=COLOR%3Ablue&tracking=abc#recommendation",
  );
  const second = canonicalProductUrl(
    "https://produto.mercadolivre.com.br/MLB-1234567890-item?tracking=other&attributes=COLOR%3Ablue&variation=2&utm_campaign=sale",
  );

  assert.equal(first, second);
  assert.equal(
    first,
    "https://produto.mercadolivre.com.br/MLB-1234567890-item?attributes=COLOR%3Ablue&variation=2",
  );
});

test("canonicalizes catalog URLs while preserving product-defining query values", () => {
  assert.equal(
    canonicalProductUrl(
      "https://www.mercadolivre.com.br/controle-sony/p/MLB18010993?variation=3&variation=2&mkt_tool=123#reviews",
    ),
    "https://www.mercadolivre.com.br/controle-sony/p/MLB18010993?variation=2&variation=3",
  );
});

test("rejects invalid external and non-product URLs", () => {
  for (const value of [
    "not a url",
    "http://produto.mercadolivre.com.br/MLB-123-item",
    "https://produto.mercadolivre.com.br:444/MLB-123-item",
    "https://example.com/MLB-123-item",
    "https://mercadolivre.com.br.evil.example/MLB-123-item",
    "https://lista.mercadolivre.com.br/tenis",
    "https://www.mercadolivre.com.br/minha-conta",
  ]) {
    assert.throws(() => canonicalProductUrl(value), /ineligible_url/);
  }
});

test("emits uppercase item and SHA-256 canonical URL and product identities", () => {
  const offer = {
    itemId: "mlb123",
    title: "Furadeira Bosch GSB 13 RE",
    permalink:
      "https://produto.mercadolivre.com.br/MLB-123-x?tracking=1#foo",
  };
  const canonical = "https://produto.mercadolivre.com.br/MLB-123-x";
  const fingerprint = productFingerprint(offer.title);

  assert.deepEqual(offerIdentities(offer), [
    "item:MLB123",
    `url:${digest(canonical)}`,
    `product:${digest(fingerprint)}`,
  ]);
});

test("omits product identities for fingerprints with fewer than two meaningful tokens", () => {
  const base = {
    itemId: "MLB9",
    permalink: "https://produto.mercadolivre.com.br/MLB-9-x",
  };

  assert.equal(productFingerprint("Promoção azul 128GB"), "");
  assert.equal(productFingerprint("iPhone 128GB"), "");
  assert.deepEqual(offerIdentities({ ...base, title: "iPhone 128GB" }), [
    "item:MLB9",
    `url:${digest(base.permalink)}`,
  ]);
});
