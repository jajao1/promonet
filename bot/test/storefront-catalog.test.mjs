import test from "node:test";
import assert from "node:assert/strict";
import { categoryBySlug, storefrontCategories } from "../storefront-catalog.mjs";

test("exposes all stable public storefront categories", () => {
  assert.deepEqual(storefrontCategories.map(({ slug }) => slug), [
    "tenis", "roupas", "acessorios-de-moda", "ferramentas", "celulares", "informatica", "games",
    "eletrodomesticos", "beleza", "esportes", "automotivo", "bebe",
  ]);
  assert.deepEqual(categoryBySlug("roupas"), {
    slug: "roupas", nicheId: "clothing", name: "Roupas",
    description: "Ofertas de roupas masculinas, femininas e infantis.",
  });
  assert.equal(categoryBySlug("acessorios-de-moda").nicheId, "fashion-accessories");
  assert.equal(categoryBySlug("acessorios-de-moda").name, "Acessórios de Moda");
  assert.equal(categoryBySlug("ferramentas").name, "Ferramentas");
  assert.equal(categoryBySlug("ferramentas").nicheId, "tools");
  assert.equal(categoryBySlug("comida"), null);
});
