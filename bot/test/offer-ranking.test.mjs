import test from "node:test";
import assert from "node:assert/strict";
import { rankCategoryOffers } from "../offer-ranking.mjs";

const offer = (itemId, rank, soldQuantity, price, originalPrice) => ({
  itemId, rank, soldQuantity, price, originalPrice, categoryId: "MLB23332",
});

test("combines relative demand official rank and discount", () => {
  const candidates = [
    offer("BALANCED", 0, 100, 80, 100),
    offer("WEAK", 2, 10, 95, 100),
    offer("POPULAR", 1, 10_000, 50, 100),
  ];
  const ranked = rankCategoryOffers(candidates);
  assert.deepEqual(ranked.map(candidate => candidate.itemId), ["POPULAR", "BALANCED", "WEAK"]);
  assert.ok(ranked.every(candidate => Number.isFinite(candidate.hybridScore)));
});

test("uses neutral sales contribution when demand is unavailable", () => {
  const candidates = [
    offer("RANK_TWO", 2, null, 80, 100),
    offer("RANK_ONE", 1, null, 80, 100),
  ];
  assert.deepEqual(rankCategoryOffers(candidates).map(candidate => candidate.itemId), ["RANK_ONE", "RANK_TWO"]);
});

test("is deterministic and does not mutate candidates", () => {
  const candidates = [offer("B", 1, 50, 80, 100), offer("A", 1, 50, 80, 100)];
  const snapshot = structuredClone(candidates);
  assert.deepEqual(rankCategoryOffers(candidates), rankCategoryOffers([...candidates]));
  assert.deepEqual(candidates, snapshot);
  assert.deepEqual(rankCategoryOffers(candidates).map(candidate => candidate.itemId), ["A", "B"]);
});
