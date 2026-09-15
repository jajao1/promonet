import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { categoryByNicheId, categoryBySlug, storefrontCategories } from "../storefront-catalog.mjs";

test("exposes all stable public storefront categories", () => {
  assert.deepEqual(storefrontCategories.map(({ slug }) => slug), [
    "tenis", "roupas", "acessorios-de-moda", "ferramentas", "celulares", "informatica", "games",
    "eletrodomesticos", "casa", "beleza", "esportes", "automotivo", "bebe",
  ]);
  assert.deepEqual(categoryBySlug("roupas"), {
    slug: "roupas", nicheId: "clothing", name: "Roupas",
    description: "Ofertas de roupas masculinas, femininas e infantis.",
  });
  assert.equal(categoryBySlug("acessorios-de-moda").nicheId, "fashion-accessories");
  assert.equal(categoryBySlug("acessorios-de-moda").name, "Acessórios de Moda");
  assert.equal(categoryBySlug("ferramentas").name, "Ferramentas");
  assert.equal(categoryBySlug("ferramentas").nicheId, "tools");
  assert.equal(categoryBySlug("casa").nicheId, "home");
  assert.equal(categoryBySlug("comida"), null);
});

test("maps every enabled production niche to a public storefront category",async()=>{
  const config=JSON.parse(await readFile(new URL("../../config/niches.json",import.meta.url),"utf8"));
  for(const niche of config.niches.filter(({enabled})=>enabled))
    assert.ok(categoryByNicheId(niche.id),niche.id);
});
