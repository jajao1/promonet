import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

async function json(fetch, url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch {
    return { ok: false, status: 0, body: null };
  }
  if (!response.ok) return { ok: false, status: response.status, body: null };
  try {
    return { ok: true, status: response.status, body: await response.json() };
  } catch {
    return { ok: false, status: response.status, body: null };
  }
}

export async function verifyCategories({ niches, fetch = globalThis.fetch, token }) {
  if (!Array.isArray(niches) || !token) throw Error("verification_configuration_required");
  const results = [];
  for (const niche of niches) {
    for (const categoryId of niche.categoryIds) {
      const metadata = await json(fetch, `https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}`);
      if (!metadata.ok) {
        results.push({ vertical: niche.id, categoryId, ok: false, reason: "category_unavailable" });
        continue;
      }
      if (metadata.body?.children_categories?.length) {
        results.push({ vertical: niche.id, categoryId, ok: false, reason: "not_leaf" });
        continue;
      }
      const ranking = await json(fetch, `https://api.mercadolibre.com/highlights/MLB/category/${encodeURIComponent(categoryId)}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!ranking.ok || !Array.isArray(ranking.body?.content) || !ranking.body.content.length) {
        results.push({ vertical: niche.id, categoryId, ok: false, reason: "ranking_unavailable" });
        continue;
      }
      results.push({ vertical: niche.id, categoryId, ok: true });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.MELI_ACCESS_TOKEN;
  if (!token) throw Error("MELI_ACCESS_TOKEN_required");
  const path = process.env.NICHES_CONFIG_PATH ?? new URL("../config/niches.json", import.meta.url);
  const config = JSON.parse(await readFile(path, "utf8"));
  const results = await verifyCategories({ niches: config.niches, token });
  console.table(results);
  if (results.some(result => !result.ok)) process.exitCode = 1;
}
