import test from "node:test";
import assert from "node:assert/strict";
import { categoryBySlug, storefrontCategories } from "../storefront-catalog.mjs";

test("exposes the ten stable public storefront categories", () => {
  assert.deepEqual(storefrontCategories.map(({ slug }) => slug), [
    "tenis", "ferramentas", "celulares", "informatica", "games",
    "eletrodomesticos", "beleza", "esportes", "automotivo", "bebe",
  ]);
  assert.equal(categoryBySlug("ferramentas").name, "Ferramentas");
  assert.equal(categoryBySlug("ferramentas").nicheId, "tools");
  assert.equal(categoryBySlug("comida"), null);
});
