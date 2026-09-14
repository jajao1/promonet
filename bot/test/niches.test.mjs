import test from "node:test";
import assert from "node:assert/strict";
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
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.categoryIds));
});

test("accepts shared destinations and a five-minute minimum interval", () => {
  const result = validateNiches({ niches: [
    { ...vertical, intervalMinutes: 5 },
    { ...vertical, id: "sneakers", categoryIds: ["MLB23332"] },
  ] });
  assert.equal(result.length, 2);
});

test("rejects roots, food, duplicates, empty lists, and multi-item verticals", () => {
  for (const categoryIds of [[], ["MLB1000"], ["MLB1403"], ["MLB262997", "MLB262997"]]) {
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
