# Hybrid Offer Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder Mercado Livre category highlights using official rank, relative sales and real discount while recording 20-minute metric snapshots for later trend detection.

**Architecture:** `OfficialOfferSource` enriches its normalized candidate with optional demand metrics. A new pure `offer-ranking.mjs` module computes category-relative scores without global thresholds; `offer-policy.mjs` consumes the score while retaining deterministic fallbacks. `CollectorStore` owns an idempotent snapshot table and the collector records all discovered candidates before filtering.

**Tech Stack:** Node.js 24 ESM, native `node:test`, PostgreSQL 16 through `pg`, Docker Compose.

---

## File map

- Create `bot/offer-ranking.mjs`: validation, normalization and hybrid scoring only.
- Create `bot/test/offer-ranking.test.mjs`: pure ranking behavior.
- Modify `bot/offer-source.mjs`: request and normalize optional official demand/reputation fields.
- Modify `bot/test/offer-source.test.mjs`: source normalization and missing-field compatibility.
- Modify `bot/offer-policy.mjs`: sort eligible candidates by hybrid score with deterministic fallbacks.
- Modify `bot/test/offer-policy.test.mjs`: integration between eligibility/diversity and ranking.
- Modify `bot/collector-store.mjs`: snapshot schema and idempotent persistence API.
- Modify `bot/test/collector-store.test.mjs`: schema/query contract and PostgreSQL behavior.
- Modify `bot/collector.mjs`: score each category pool and persist observations.
- Modify `bot/test/collector.test.mjs`: collector wiring and graceful snapshot failure behavior.

### Task 1: Normalize official popularity metrics

**Files:**
- Modify: `bot/offer-source.mjs:15-42`
- Test: `bot/test/offer-source.test.mjs`

- [ ] **Step 1: Write failing source tests**

Extend the bulk-item test body with `sold_quantity: 850`, `reviews.rating_average: 4.8`, and `reviews.total: 240`. Assert that the returned candidate contains:

```js
assert.equal(result[0].soldQuantity, 850);
assert.equal(result[0].ratingAverage, 4.8);
assert.equal(result[0].reviewCount, 240);
```

Add a second assertion using missing and malformed metric fields:

```js
assert.equal(result[0].soldQuantity, null);
assert.equal(result[0].ratingAverage, null);
assert.equal(result[0].reviewCount, null);
```

- [ ] **Step 2: Verify RED**

Run: `node --test bot/test/offer-source.test.mjs`

Expected: FAIL because the normalized metric properties are absent.

- [ ] **Step 3: Implement minimal normalization**

Add `body.sold_quantity,body.reviews` to the bulk `attributes` list. Normalize non-negative finite sales/review counts and ratings from 0 through 5; emit `null` otherwise. Apply the same normalization to the selected result from `/products/{id}/items` without adding API requests.

- [ ] **Step 4: Verify GREEN**

Run: `node --test bot/test/offer-source.test.mjs`

Expected: all source tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bot/offer-source.mjs bot/test/offer-source.test.mjs
git commit -m "feat: collect official offer popularity metrics"
```

### Task 2: Compute a category-relative hybrid score

**Files:**
- Create: `bot/offer-ranking.mjs`
- Create: `bot/test/offer-ranking.test.mjs`

- [ ] **Step 1: Write failing pure ranking tests**

Import the wished-for API:

```js
import { rankCategoryOffers } from "../offer-ranking.mjs";
```

Cover these behaviors with small candidate fixtures:

```js
assert.deepEqual(rankCategoryOffers(candidates).map(x => x.itemId), ["POPULAR", "BALANCED", "WEAK"]);
assert.ok(rankCategoryOffers(candidates).every(x => Number.isFinite(x.hybridScore)));
assert.deepEqual(rankCategoryOffers(withoutSales).map(x => x.itemId), ["RANK_ONE", "RANK_TWO"]);
assert.deepEqual(rankCategoryOffers(candidates), rankCategoryOffers([...candidates]));
```

The fixtures must prove category-relative sales normalization, the 40/35/25 weighting, a neutral missing-sales contribution, and deterministic ties.

- [ ] **Step 2: Verify RED**

Run: `node --test bot/test/offer-ranking.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure module**

Export `rankCategoryOffers(candidates)`. For each category pool:

- normalize rank inversely to `[0,1]` using its min/max;
- normalize `log1p(soldQuantity)` to `[0,1]` using its min/max;
- use `0.5` for missing sales and when all valid sales values are equal;
- clamp discount percentage to `[0,1]`;
- set `hybridScore = 0.40 * rankScore + 0.35 * salesScore + 0.25 * discountScore`;
- return cloned candidates sorted by descending score, then ascending rank, descending discount, and ascending item ID.

Reject no candidates in this module; eligibility remains in `offer-policy.mjs`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test bot/test/offer-ranking.test.mjs`

Expected: all ranking tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bot/offer-ranking.mjs bot/test/offer-ranking.test.mjs
git commit -m "feat: rank offers by relative demand"
```

### Task 3: Integrate hybrid ordering with offer policy

**Files:**
- Modify: `bot/offer-policy.mjs:174-205`
- Modify: `bot/test/offer-policy.test.mjs`

- [ ] **Step 1: Write a failing policy test**

Create three eligible offers in one category where rank-only ordering differs from hybrid ordering. Call `selectOffers` and assert the hybrid order. Retain the existing rank-first test as a fallback case where popularity metrics are absent.

- [ ] **Step 2: Verify RED**

Run: `node --test bot/test/offer-policy.test.mjs`

Expected: the new hybrid-order test FAILS under `compareOffers` rank-first behavior.

- [ ] **Step 3: Implement minimal integration**

Import `rankCategoryOffers`. In `selectOffers`, filter/deduplicate first and then rank the pool. In `diversifyOfferPool`, call the same ranking function for each niche group. Keep `compareOffers` as a deterministic compatibility comparator for candidates that have already been assigned equal scores.

- [ ] **Step 4: Verify GREEN**

Run: `node --test bot/test/offer-policy.test.mjs bot/test/offer-ranking.test.mjs`

Expected: both suites PASS, including existing food, quota and duplicate tests.

- [ ] **Step 5: Commit**

```bash
git add bot/offer-policy.mjs bot/test/offer-policy.test.mjs
git commit -m "feat: apply hybrid ranking to offer selection"
```

### Task 4: Store idempotent 20-minute snapshots

**Files:**
- Modify: `bot/collector-store.mjs:86-200`
- Modify: `bot/test/collector-store.test.mjs`

- [ ] **Step 1: Write failing store contract tests**

Assert that `init()` creates `promonet.offer_metric_snapshots` with these columns:

```sql
item_id text NOT NULL,
category_id text NOT NULL,
observed_at timestamptz NOT NULL,
rank integer,
sold_quantity integer,
price numeric,
original_price numeric,
rating_average numeric,
review_count integer,
PRIMARY KEY(item_id,category_id,observed_at)
```

Call the wished-for API:

```js
await store.recordOfferSnapshots("MLB23332", candidates, new Date("2026-09-15T12:07:00Z"));
```

Assert the query floors the observation to `12:00:00Z`, inserts via array/JSON expansion in one query, validates candidate metrics, and uses `ON CONFLICT ... DO UPDATE` so retries are idempotent.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="snapshot" bot/test/collector-store.test.mjs`

Expected: FAIL because the table and method do not exist.

- [ ] **Step 3: Implement schema and persistence**

Create the table and an index on `(category_id, observed_at DESC)` in `init()`. Add `recordOfferSnapshots(categoryId, candidates, observedAt = new Date())`, validate the category/date, floor UTC epoch milliseconds to a 20-minute boundary, discard candidates without a valid item ID, and perform one parameterized bulk upsert. Store null for invalid optional metrics.

- [ ] **Step 4: Verify GREEN and PostgreSQL integration**

Run:

```bash
node --test --test-name-pattern="snapshot" bot/test/collector-store.test.mjs
docker compose up -d postgres
npm test -- --test-name-pattern="snapshot"
```

Expected: unit tests PASS; database-gated test either PASS with PostgreSQL configured or reports the repository's explicit environment skip.

- [ ] **Step 5: Commit**

```bash
git add bot/collector-store.mjs bot/test/collector-store.test.mjs
git commit -m "feat: persist offer metric snapshots"
```

### Task 5: Wire snapshots into the collector

**Files:**
- Modify: `bot/collector.mjs:463-488`
- Modify: `bot/test/collector.test.mjs`

- [ ] **Step 1: Write failing collector tests**

Extend the collector-store fake with `recordOfferSnapshots`. Assert it receives the requested category and every candidate returned by `source.list` before eligibility removes candidates. Add a failure test asserting a snapshot write failure logs/records collection failure and sends no offer, avoiding publication based on unobserved ranking data.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="snapshot" bot/test/collector.test.mjs`

Expected: FAIL because the collector does not invoke the method.

- [ ] **Step 3: Implement collector wiring**

Immediately after `source.list(state.categoryId, token)` returns, call:

```js
await store.recordOfferSnapshots(state.categoryId, found);
```

Leave scoring inside offer policy and preserve existing incident/error handling. Do not change interval, operating hours, round limit, food filtering or affiliate-link generation.

- [ ] **Step 4: Verify GREEN**

Run: `node --test bot/test/collector.test.mjs bot/test/offer-policy.test.mjs bot/test/offer-ranking.test.mjs bot/test/offer-source.test.mjs bot/test/collector-store.test.mjs`

Expected: all selected suites PASS except documented environment-only skips.

- [ ] **Step 5: Commit**

```bash
git add bot/collector.mjs bot/test/collector.test.mjs
git commit -m "feat: observe demand metrics during collection"
```

### Task 6: Full verification and deployment

**Files:**
- Verify only; modify files only if a failing regression requires a TDD fix.

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm test
git diff --check
git status --short --branch
```

Expected: zero failed tests, no whitespace errors, and only intended commits ahead of `origin/main`.

- [ ] **Step 2: Push and deploy**

Run:

```bash
git push origin main
ssh root@173.224.122.166 'cd /opt/promonet && git pull --ff-only origin main && docker compose -f compose.yaml -f compose.prod.yaml up -d --build bot'
```

Expected: fast-forward pull, successful image build and healthy bot container.

- [ ] **Step 3: Verify production**

Run remotely:

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://promomega.com.br/
docker compose -f compose.yaml -f compose.prod.yaml logs --since=10m bot
```

Expected: `{"status":"ok"}`, HTTP `200`, `ready` event and no startup/database errors. Query `promonet.offer_metric_snapshots` after one collection round to confirm rows have been written; do not manually trigger WhatsApp delivery merely to populate snapshots.

