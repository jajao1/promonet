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

test("removes decimal comma and decimal point capacity variants completely", () => {
  const reference = productFingerprint("Notebook Gamer 2TB");
  assert.equal(productFingerprint("Notebook Gamer 1,5TB"), reference);
  assert.equal(productFingerprint("Notebook Gamer 1.5 TB"), reference);
});

test("keeps meaningful bundle quantities distinct", () => {
  assert.notEqual(
    productFingerprint("Kit 2 Controles Sony DualSense PS5"),
    productFingerprint("Controle Sony DualSense PS5"),
  );
});

test("keeps direction-sensitive products distinct", () => {
  assert.notEqual(
    productFingerprint("Adaptador HDMI para USB C"),
    productFingerprint("Adaptador USB C para HDMI"),
  );
});

test("normalizes an attached plus symbol without collapsing it into the base model", () => {
  assert.equal(
    productFingerprint("Samsung Galaxy S24+ 256GB"),
    productFingerprint("Samsung Galaxy S24 Plus 128GB"),
  );
  assert.notEqual(
    productFingerprint("Samsung Galaxy S24+ 256GB"),
    productFingerprint("Samsung Galaxy S24 256GB"),
  );
});

test("normalizes spaced and full-width plus variants", () => {
  const spelled = productFingerprint("Samsung Galaxy S24 Plus 128GB");
  assert.equal(productFingerprint("Samsung Galaxy S24 + 256GB"), spelled);
  assert.equal(productFingerprint("Samsung Galaxy S24＋ 512GB"), spelled);
  assert.notEqual(
    productFingerprint("Samsung Galaxy S24 + 256GB"),
    productFingerprint("Samsung Galaxy S24 256GB"),
  );
});

test("normalizes plus markers before punctuation and adjacent model tokens", () => {
  for (const [symbolic, spelled, base] of [
    ["Samsung Galaxy S24+, 256GB", "Samsung Galaxy S24 Plus 128GB", "Samsung Galaxy S24 128GB"],
    ["Samsung Galaxy S24+; 256GB", "Samsung Galaxy S24 Plus 128GB", "Samsung Galaxy S24 128GB"],
    ["Samsung Galaxy S24+/5G 256GB", "Samsung Galaxy S24 Plus 5G 128GB", "Samsung Galaxy S24 5G 128GB"],
    ["Samsung Galaxy S24+Pro 256GB", "Samsung Galaxy S24 Plus Pro 128GB", "Samsung Galaxy S24 Pro 128GB"],
    ["Samsung Galaxy S24＋Pro 256GB", "Samsung Galaxy S24 Plus Pro 128GB", "Samsung Galaxy S24 Pro 128GB"],
  ]) {
    assert.equal(productFingerprint(symbolic), productFingerprint(spelled));
    assert.notEqual(productFingerprint(symbolic), productFingerprint(base));
  }
});

test("removes marker values only for bounded colors and apparel sizes", () => {
  assert.notEqual(
    productFingerprint("Monitor tamanho 27"),
    productFingerprint("Monitor tamanho 32"),
  );
  assert.notEqual(productFingerprint("TV 55"), productFingerprint("TV 65"));
  assert.notEqual(
    productFingerprint("Notebook cor i7"),
    productFingerprint("Notebook cor i5"),
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

test("normalizes accepted item and catalog trailing-slash variants", () => {
  assert.equal(
    canonicalProductUrl("https://produto.mercadolivre.com.br/MLB-123-item/"),
    canonicalProductUrl("https://produto.mercadolivre.com.br/MLB-123-item"),
  );
  assert.equal(
    canonicalProductUrl("https://www.mercadolivre.com.br/controle/p/MLB18010993/"),
    canonicalProductUrl("https://www.mercadolivre.com.br/controle/p/MLB18010993"),
  );
});

test("canonicalizes catalog URLs while preserving product-defining query values", () => {
  assert.equal(
    canonicalProductUrl(
      "https://www.mercadolivre.com.br/controle-sony/p/MLB18010993?variation=3&variation=2&mkt_tool=123#reviews",
    ),
    "https://www.mercadolivre.com.br/controle-sony/p/MLB18010993?variation=3&variation=2",
  );
});

test("preserves query key spelling and repeated-value order while sorting distinct keys", () => {
  const expected =
    "https://produto.mercadolivre.com.br/MLB-123-item?Filter=b&Filter=a&variation=2&Zeta=9";
  assert.equal(
    canonicalProductUrl(
      "https://produto.mercadolivre.com.br/MLB-123-item?Zeta=9&Filter=b&variation=2&Filter=a",
    ),
    expected,
  );
  assert.equal(
    canonicalProductUrl(
      "https://produto.mercadolivre.com.br/MLB-123-item?variation=2&Filter=b&Filter=a&Zeta=9",
    ),
    expected,
  );
  const caseStable =
    "https://produto.mercadolivre.com.br/MLB-123-item?Filter=upper&filter=lower";
  assert.equal(
    canonicalProductUrl(
      "https://produto.mercadolivre.com.br/MLB-123-item?filter=lower&Filter=upper",
    ),
    caseStable,
  );
  assert.equal(
    canonicalProductUrl(
      "https://produto.mercadolivre.com.br/MLB-123-item?Filter=upper&filter=lower",
    ),
    caseStable,
  );
});

test("removes tracking-shaped query parameters", () => {
  assert.equal(
    canonicalProductUrl(
      "https://produto.mercadolivre.com.br/MLB-123-item?tracking_source=feed&variation=7&tracking_id=abc",
    ),
    "https://produto.mercadolivre.com.br/MLB-123-item?variation=7",
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

test("rejects product-looking paths on search arbitrary and host-mismatched routes", () => {
  for (const value of [
    "https://lista.mercadolivre.com.br/MLB-123-item",
    "https://ofertas.mercadolivre.com.br/MLB-123-item",
    "https://produto.mercadolivre.com.br/tenis/p/MLB18010993",
  ]) {
    assert.throws(() => canonicalProductUrl(value), /ineligible_url/);
  }
});

test("rejects item identifiers nested under unrelated allowed-host routes", () => {
  for (const value of [
    "https://produto.mercadolivre.com.br/minha-conta/MLB-123-item",
    "https://www.mercadolivre.com.br/minha-conta/MLB-123-item",
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

test("rejects missing malformed and URL-mismatched item IDs", () => {
  const offer = {
    title: "Furadeira Bosch GSB 13 RE",
    permalink: "https://produto.mercadolivre.com.br/MLB-123-x",
  };
  for (const itemId of [null, undefined, "", "   ", "123", "MLB-123", "MLBPROD"]) {
    assert.throws(() => offerIdentities({ ...offer, itemId }), /invalid_item_id/);
  }
  assert.throws(
    () => offerIdentities({ ...offer, itemId: "MLB124" }),
    /item_id_mismatch/,
  );
});

test("accepts a matching numeric catalog product ID without a hyphen", () => {
  const identities = offerIdentities({
    itemId: "mlb18010993",
    title: "Controle Sony DualSense PS5",
    permalink: "https://www.mercadolivre.com.br/controle-sony/p/MLB18010993",
  });
  assert.equal(identities[0], "item:MLB18010993");
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
