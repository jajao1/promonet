import test from "node:test";
import assert from "node:assert/strict";
import { verifyCategories } from "../../scripts/verify-highlight-categories.mjs";

const response = (body, status = 200) => Response.json(body, { status });

test("verifies leaf categories with best-seller rankings", async () => {
  const urls = [];
  const fetch = async (url, options) => {
    urls.push({ url: String(url), options });
    if (String(url).includes("/categories/")) return response({ children_categories: [] });
    return response({ content: [{ id: "MLB1", type: "ITEM", position: 1 }] });
  };
  const result = await verifyCategories({ niches: [{ id: "tools", categoryIds: ["MLB262997"] }], fetch, token: "token" });
  assert.deepEqual(result, [{ vertical: "tools", categoryId: "MLB262997", ok: true }]);
  assert.equal(urls.length, 2);
  assert.equal(urls[1].options.headers.authorization, "Bearer token");
});

test("reports roots and unsupported highlight categories", async () => {
  const fetch = async url => String(url).includes("MLBROOT")
    ? response({ children_categories: [{ id: "MLB1" }] })
    : String(url).includes("/categories/")
      ? response({ children_categories: [] })
      : response({}, 404);
  const result = await verifyCategories({
    niches: [{ id: "tools", categoryIds: ["MLBROOT", "MLB404"] }],
    fetch,
    token: "token",
  });
  assert.deepEqual(result, [
    { vertical: "tools", categoryId: "MLBROOT", ok: false, reason: "not_leaf" },
    { vertical: "tools", categoryId: "MLB404", ok: false, reason: "ranking_unavailable" },
  ]);
});
