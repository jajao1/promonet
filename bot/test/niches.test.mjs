import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateNiches } from "../niches.mjs";

const vertical = {
  id: "tools",
  categoryIds: ["MLB262997", "MLB263831"],
  destinationGroup: "120@g.us",
  tag: "vijo3432338",
  intervalMinutes: 20,
  limit: 1,
  enabled: true,
};

test("accepts frozen non-food verticals with leaf categories", () => {
  const [result] = validateNiches({ niches: [vertical] });
  assert.deepEqual(result.categoryIds, ["MLB262997", "MLB263831"]);
  assert.equal(result.maxPerRound, 2);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.categoryIds));
});

test("accepts an explicit one or two offer quota per vertical", () => {
  for (const maxPerRound of [1, 2]) {
    const [result] = validateNiches({ niches: [{ ...vertical, maxPerRound }] });
    assert.equal(result.maxPerRound, maxPerRound);
  }
});

test("rejects an invalid per-round vertical quota", () => {
  for (const maxPerRound of [0, 3, 1.5, "2", null]) {
    assert.throws(
      () => validateNiches({ niches: [{ ...vertical, maxPerRound }] }),
      /invalid_niche/,
    );
  }
});

test("production config enables clothing and fashion accessories with distinct leaf IDs", async () => {
  const config = JSON.parse(await readFile(new URL("../../config/niches.json", import.meta.url), "utf8"));
  const niches = validateNiches(config);
  const clothing = niches.find(niche => niche.id === "clothing");
  const accessories = niches.find(niche => niche.id === "fashion-accessories");

  for (const niche of [clothing, accessories]) {
    assert.ok(niche);
    assert.equal(niche.enabled, true);
    assert.equal(niche.destinationGroup, "120363411422374407@g.us");
    assert.equal(niche.tag, "vijo3432338");
    assert.equal(niche.intervalMinutes, 20);
    assert.equal(niche.limit, 1);
    assert.equal(niche.maxPerRound, 2);
  }
  assert.deepEqual(clothing.categoryIds, ["MLB31447", "MLB107292", "MLB188065"]);
  assert.deepEqual(accessories.categoryIds, ["MLB430275", "MLB190393", "MLB190430"]);
  assert.ok(!niches.flatMap(niche => niche.categoryIds).includes("MLB1430"));
  assert.equal(new Set(niches.flatMap(niche => niche.categoryIds)).size, niches.flatMap(niche => niche.categoryIds).length);
});

test("accepts shared destinations and a five-minute minimum interval", () => {
  const result = validateNiches({ niches: [
    { ...vertical, intervalMinutes: 5 },
    { ...vertical, id: "sneakers", categoryIds: ["MLB23332"] },
  ] });
  assert.equal(result.length, 2);
});

test("rejects roots, food, duplicates, empty lists, and multi-item verticals", () => {
  for (const categoryIds of [[], ["MLB1000"], ["MLB1430"], ["MLB1403"], ["MLB262997", "MLB262997"]]) {
    assert.throws(() => validateNiches({ niches: [{ ...vertical, categoryIds }] }), /invalid_niche/);
  }
  assert.throws(() => validateNiches({ niches: [{ ...vertical, limit: 2 }] }), /invalid_niche/);
});

test("rejects malformed and cross-vertical category conflicts", () => {
  for (const config of [
    { niches: [] },
    { niches: [{ ...vertical, categoryIds: ["bad"] }] },
    { niches: [{ ...vertical, intervalMinutes: 4 }] },
    { niches: [vertical, { ...vertical, id: "other", categoryIds: ["MLB263831"] }] },
  ]) assert.throws(() => validateNiches(config), /invalid_/);
});
