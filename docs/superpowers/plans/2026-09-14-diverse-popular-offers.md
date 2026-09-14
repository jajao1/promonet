# Diverse Popular Offers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish up to ten genuinely discounted best sellers from different non-food verticals every 20 minutes without repeating an item globally for seven days.

**Architecture:** Replace one root category per niche with a vertical containing verified leaf categories and persist a rotation cursor for each vertical. Keep the official Mercado Livre highlights source, rank candidates primarily by best-seller position, and move recent-item deduplication from niche scope to global scope. The collector processes at most one item per vertical and records specific outcomes without exposing secrets.

**Tech Stack:** Node.js 24 ES modules, built-in `node:test`, PostgreSQL 16, Mercado Livre REST API, Evolution API, Docker Compose.

---

## File map

- Modify `bot/niches.mjs`: validate the vertical schema and reject known food roots.
- Modify `config/niches.json`: define ten non-food verticals with leaf-category rotation.
- Create `scripts/verify-highlight-categories.mjs`: verify that configured IDs are leaf categories with an available highlights ranking.
- Modify `bot/offer-policy.mjs`: require a real discount and make ranking the primary ordering rule.
- Modify `bot/collector-store.mjs`: add rotation state, global recent-item lookup, and explicit results.
- Modify `bot/collector.mjs`: select one offer per vertical, rotate leaf categories, isolate failures, and log safe diagnostics.
- Modify `bot/server.mjs`: inject the logger into collection.
- Modify `bot/test/niches.test.mjs`, `bot/test/offer-source.test.mjs`, `bot/test/offer-policy.test.mjs`, `bot/test/collector-store.test.mjs`, and `bot/test/collector.test.mjs`: cover all new behavior.
- Modify `README.md`: document selection, rotation, diagnostics, and the category verification command.

### Task 1: Validate vertical configuration

**Files:**
- Modify: `bot/niches.mjs`
- Modify: `bot/test/niches.test.mjs`

- [ ] **Step 1: Write failing schema tests**

Add tests that use this valid shape and verify frozen nested arrays, rejection of an empty leaf list, duplicate leaf IDs, root categories, food categories, and a limit other than one:

```js
const vertical = {
  id: "tools",
  categoryIds: ["MLB262997", "MLB263831"],
  destinationGroup: "120@g.us",
  tag: "vijo3432338",
  intervalMinutes: 20,
  limit: 1,
  enabled: true
};

test("accepts frozen non-food verticals with leaf categories", () => {
  const [result] = validateNiches({ niches: [vertical] });
  assert.deepEqual(result.categoryIds, ["MLB262997", "MLB263831"]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.categoryIds));
});

test("rejects roots, food, duplicates, empty lists, and multi-item verticals", () => {
  for (const categoryIds of [[], ["MLB1000"], ["MLB1403"], ["MLB262997", "MLB262997"]]) {
    assert.throws(() => validateNiches({ niches: [{ ...vertical, categoryIds }] }), /invalid_niche/);
  }
  assert.throws(() => validateNiches({ niches: [{ ...vertical, limit: 2 }] }), /invalid_niche/);
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test bot/test/niches.test.mjs`

Expected: FAIL because `categoryIds` is not supported and the old `categoryId` field is required.

- [ ] **Step 3: Implement the vertical validator**

Define immutable deny lists for the previous roots and grocery root, require 1–20 unique `MLB` IDs in `categoryIds`, reject category reuse across verticals, require `limit === 1`, and return a frozen copy whose `categoryIds` is also frozen. Preserve the existing destination, tag, interval, ID, and enabled validations.

```js
const forbiddenCategories = new Set([
  "MLB1000", "MLB1144", "MLB1574", "MLB1430", "MLB1246",
  "MLB264586", "MLB1276", "MLB263532", "MLB5672", "MLB1384", "MLB1403"
]);

const categoryIds = n.categoryIds;
if (!Array.isArray(categoryIds) || categoryIds.length < 1 || categoryIds.length > 20 ||
    categoryIds.some(id => !/^MLB\d+$/.test(id) || forbiddenCategories.has(id) || categories.has(id)) ||
    new Set(categoryIds).size !== categoryIds.length || n.limit !== 1) throw Error("invalid_niche");
categoryIds.forEach(id => categories.add(id));
return Object.freeze({ ...n, categoryIds: Object.freeze([...categoryIds]) });
```

- [ ] **Step 4: Run the tests and confirm GREEN**

Run: `node --test bot/test/niches.test.mjs`

Expected: all niche tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bot/niches.mjs bot/test/niches.test.mjs
git commit -m "feat: validate rotating offer verticals"
```

### Task 2: Add and verify leaf-category configuration

**Files:**
- Create: `scripts/verify-highlight-categories.mjs`
- Create: `bot/test/verify-highlight-categories.test.mjs`
- Modify: `config/niches.json`
- Modify: `package.json`

- [ ] **Step 1: Write a failing verifier test**

Export `verifyCategories({ niches, fetch, token })` from the new script. Test that it checks category metadata and highlights, accepts a leaf with ranking content, and reports roots or unsupported leaves:

```js
test("verifies leaf categories with best-seller rankings", async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(String(url));
    if (String(url).includes("/categories/")) return response({ children_categories: [] });
    return response({ content: [{ id: "MLB1", type: "ITEM", position: 1 }] });
  };
  const result = await verifyCategories({ niches: [{ id: "tools", categoryIds: ["MLB262997"] }], fetch, token: "token" });
  assert.deepEqual(result, [{ vertical: "tools", categoryId: "MLB262997", ok: true }]);
  assert.equal(urls.length, 2);
});
```

- [ ] **Step 2: Run the verifier test and confirm RED**

Run: `node --test bot/test/verify-highlight-categories.test.mjs`

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Implement the verifier**

For each configured ID, GET `https://api.mercadolibre.com/categories/{id}` and reject when `children_categories` is non-empty. Then GET `https://api.mercadolibre.com/highlights/MLB/category/{id}` with the bearer token and require non-empty `content`. Return one `{ vertical, categoryId, ok, reason? }` record per ID. When executed directly, read `NICHES_CONFIG_PATH`, require `MELI_ACCESS_TOKEN`, print a compact table, and set `process.exitCode = 1` if any result is not valid. Never print the token or response headers.

- [ ] **Step 4: Run the verifier test and confirm GREEN**

Run: `node --test bot/test/verify-highlight-categories.test.mjs`

Expected: PASS.

- [ ] **Step 5: Discover and enter verified category leaves**

Use `GET https://api.mercadolibre.com/sites/MLB/categories/all` or recursively follow `children_categories` from the existing roots. Select 2–4 relevant leaves for each configured vertical, including explicit leaves for sneakers, drills/power tools, smartphones, notebooks/computer accessories, consoles/controllers, household appliances, beauty, sporting goods, automotive accessories, and baby products. Put only IDs that pass the verifier into `config/niches.json` using the schema from Task 1. Keep the shared destination, tag, 20-minute interval, limit 1, and ten enabled verticals.

- [ ] **Step 6: Add the command and verify the live configuration**

Add to `package.json`:

```json
"verify:categories": "node scripts/verify-highlight-categories.mjs"
```

Run: `npm run verify:categories`

Expected: every configured row has `ok=true`; the command exits 0. If an ID is unsupported, replace it with another leaf in the same vertical and rerun until the entire file passes.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-highlight-categories.mjs bot/test/verify-highlight-categories.test.mjs config/niches.json package.json
git commit -m "config: use verified best-seller leaf categories"
```

### Task 3: Rank only genuine discounted offers

**Files:**
- Modify: `bot/offer-policy.mjs`
- Modify: `bot/test/offer-policy.test.mjs`

- [ ] **Step 1: Write failing policy tests**

```js
test("rejects products without a genuine previous price", () => {
  assert.equal(selectOffer([{ ...item, originalPrice: null }], { categoryId: item.categoryId, recentIds: new Set() }), null);
  assert.equal(selectOffer([{ ...item, originalPrice: item.price }], { categoryId: item.categoryId, recentIds: new Set() }), null);
});

test("best-seller rank precedes discount", () => {
  const selected = selectOffer([
    { ...item, itemId: "MLB1", rank: 1, price: 80, originalPrice: 100 },
    { ...item, itemId: "MLB2", rank: 8, price: 30, originalPrice: 100 }
  ], { categoryId: item.categoryId, recentIds: new Set() });
  assert.equal(selected.itemId, "MLB1");
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test bot/test/offer-policy.test.mjs`

Expected: FAIL because no-discount products are accepted and discount currently precedes rank.

- [ ] **Step 3: Implement the minimal policy change**

Require `originalPrice` to be finite and greater than `price` inside `valid`. Change ordering to:

```js
.sort((a, b) => a.rank - b.rank || discount(b) - discount(a) || a.itemId.localeCompare(b.itemId))
```

- [ ] **Step 4: Run policy and full tests**

Run: `node --test bot/test/offer-policy.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bot/offer-policy.mjs bot/test/offer-policy.test.mjs
git commit -m "feat: prioritize genuinely discounted best sellers"
```

### Task 4: Persist rotation and global deduplication

**Files:**
- Modify: `bot/collector-store.mjs`
- Modify: `bot/test/collector-store.test.mjs`

- [ ] **Step 1: Write failing store tests**

Add tests for `claimDueNiches` returning verticals in a persisted rotated order, `nextCategory(niche)` advancing and wrapping the leaf cursor, and `recentItemIds()` issuing a seven-day query without a niche predicate:

```js
test("recent item ids are global for seven days", async () => {
  const calls = [];
  const db = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: [{ item_id: "MLB1" }] }; } };
  assert.deepEqual(await new CollectorStore(db).recentItemIds(), new Set(["MLB1"]));
  assert.doesNotMatch(calls[0].sql, /niche_id\s*=|niche_id\s*\$/);
  assert.deepEqual(calls[0].args ?? [], []);
});

test("leaf rotation advances and wraps", async () => {
  const db = rotationDb([0, 1, 2]);
  const store = new CollectorStore(db);
  const niche = { id: "tools", categoryIds: ["MLB10", "MLB20"] };
  assert.equal(await store.nextCategory(niche), "MLB10");
  assert.equal(await store.nextCategory(niche), "MLB20");
  assert.equal(await store.nextCategory(niche), "MLB10");
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test bot/test/collector-store.test.mjs`

Expected: FAIL because deduplication requires a niche and no rotation API exists.

- [ ] **Step 3: Add rotation persistence and global lookup**

Extend `collector_runs` with `category_cursor INTEGER NOT NULL DEFAULT 0` using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Implement `nextCategory(niche)` as one atomic `UPDATE ... SET category_cursor=(category_cursor+1) % $2 RETURNING category_cursor`, using the pre-update cursor to select the current category. Add a singleton `collector_rotation` table with primary key `id=1` and `vertical_cursor`; use it in `claimDueNiches` to rotate the returned array after due rows are claimed. Change `recentItemIds()` to:

```sql
SELECT DISTINCT item_id
FROM promonet.offer_publications
WHERE published_at >= now() - interval '7 days'
```

- [ ] **Step 4: Run store and full tests**

Run: `node --test bot/test/collector-store.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bot/collector-store.mjs bot/test/collector-store.test.mjs
git commit -m "feat: rotate verticals and deduplicate globally"
```

### Task 5: Collect one offer per vertical with explicit outcomes

**Files:**
- Modify: `bot/collector.mjs`
- Modify: `bot/server.mjs`
- Modify: `bot/test/collector.test.mjs`

- [ ] **Step 1: Write failing collector tests**

Cover a two-vertical run where each uses `nextCategory`, both share the same recent set, only one candidate per vertical is sent, and source/affiliate/delivery failures produce their exact result while later verticals still run. Capture logger events and assert they contain `vertical`, `categoryId`, and `result`, but do not contain token values.

```js
test("publishes at most one offer from each rotated vertical", async () => {
  const niches = [tools, sneakers];
  const s = batchStore(niches, { categories: ["MLB10", "MLB20"], recent: new Set(["MLB-OLD"]) });
  const sends = [];
  const summary = await collectDue({
    store: s,
    niches,
    source: { list: async categoryId => [candidate(categoryId, "A", 1), candidate(categoryId, "B", 2)] },
    authorizedToken: async () => "secret-token",
    meli: { convert: async url => `${url}?affiliate=ours` },
    evolution: { send: async job => sends.push(job) },
    logger: { info() {}, error() {} },
    dryRun: false,
    delay: async () => {}
  });
  assert.equal(summary.published, 2);
  assert.equal(sends.length, 2);
  assert.equal(new Set(sends.map(x => x.text.match(/MLB\d+-A/)[0])).size, 2);
});
```

- [ ] **Step 2: Run the collector tests and confirm RED**

Run: `node --test bot/test/collector.test.mjs`

Expected: FAIL because the collector reads `categoryId`, asks for per-niche recent IDs, and records only generic `review`.

- [ ] **Step 3: Implement the collector flow**

Load the global recent set once after authorization. For every due vertical, call `store.nextCategory(niche)`, request that leaf, and call `selectOffer` rather than `selectOffers`. After a successful publication, immediately add the item ID to the in-memory recent set so another vertical in the same cycle cannot reuse it. Map failures as follows:

```js
function outcome(error) {
  if (error?.message === "source_unsupported_category") return "unsupported_category";
  if (String(error?.message).startsWith("source_")) return "source_error";
  if (["session_expired", "meli_session_missing", "affiliate_failed"].includes(error?.message)) return "affiliate_error";
  return "delivery_error";
}
```

Log only `{ event: "collector_vertical", vertical: niche.id, categoryId, result }`. Preserve the session-expiry WhatsApp alert and the 15-second delay only after successful delivery. Set the maximum total to `Math.min(10, due.length)`.

- [ ] **Step 4: Expose unsupported category errors at the source boundary**

In `bot/offer-source.mjs`, translate a highlights response with HTTP 404 into `source_unsupported_category`. Do not translate product or item lookup 404s; those remain source errors or skipped candidates according to existing behavior. Add the matching failing-then-passing assertion to `bot/test/offer-source.test.mjs`.

- [ ] **Step 5: Inject a safe logger**

Pass the existing server logger or this minimal JSON logger from `bot/server.mjs`:

```js
const collectorLogger = {
  info: data => console.log(JSON.stringify(data)),
  error: data => console.error(JSON.stringify(data))
};
```

No error object, headers, cookies, access tokens, or request payloads may be logged.

- [ ] **Step 6: Run collector, source, and full tests**

Run: `node --test bot/test/collector.test.mjs bot/test/offer-source.test.mjs && npm test`

Expected: all tests PASS and no test output contains `secret-token`.

- [ ] **Step 7: Commit**

```bash
git add bot/collector.mjs bot/server.mjs bot/offer-source.mjs bot/test/collector.test.mjs bot/test/offer-source.test.mjs
git commit -m "feat: publish diverse vertical best sellers"
```

### Task 6: Document and verify locally

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update operational documentation**

Document that a cycle runs every 20 minutes, publishes zero to ten offers, selects at most one per vertical, excludes food, blocks an item globally for seven days, and uses a 15-second delivery interval. Add:

```powershell
$secureToken = Read-Host "Token OAuth temporário" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $env:MELI_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  npm run verify:categories
} finally {
  Remove-Item Env:MELI_ACCESS_TOKEN -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}
```

Explain the five collector results and that authentication/session alerts continue to be sent through WhatsApp.

- [ ] **Step 2: Run static and automated verification**

Run:

```powershell
rg -n 'MLB1000|MLB1144|MLB1574|MLB1430|MLB1246|MLB264586|MLB1276|MLB263532|MLB5672|MLB1384|MLB1403' config/niches.json
npm test
git diff --check
```

Expected: `rg` returns no matches; all tests PASS; `git diff --check` emits no output.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: explain diverse offer rotation"
```

### Task 7: Controlled production round and deployment

**Files:**
- No source changes expected.

- [ ] **Step 1: Read the verification-before-completion skill**

Read `superpowers:verification-before-completion` and follow its evidence requirements before declaring success.

- [ ] **Step 2: Push the feature branch**

Run: `git push -u origin codex/diverse-popular-offers`

Expected: remote branch is created successfully.

- [ ] **Step 3: Deploy the feature build without forcing a live send**

On the VPS, fetch and switch to `codex/diverse-popular-offers`, then run:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d --build bot caddy
docker compose -f compose.yaml -f compose.prod.yaml ps
```

Expected: bot, PostgreSQL, Redis, Evolution, and Caddy are running; services with health checks are healthy.

- [ ] **Step 4: Run one controlled collection cycle**

Record the current publication count and seven-day item IDs. Set only the ten configured vertical run timestamps to `NULL`, restart the bot once, and wait until all ten run records leave `running`. Do not modify or delete publication history.

- [ ] **Step 5: Verify the controlled cycle**

Query the newly inserted publications and assert:

- between 1 and 10 messages were published;
- every new row has a different `niche_id`;
- no `item_id` existed in the seven-day snapshot;
- no vertical or product is food/grocery;
- each stored affiliate URL uses the expected Mercado Livre short-link host;
- logs contain a specific result for all ten verticals and contain no secrets.

Open `https://promomega.com.br/api/offers?limit=48` and confirm that the new items appear on the site.

- [ ] **Step 6: Merge and redeploy main**

After the controlled round passes, merge with `--no-ff`, push `main`, switch the VPS back to `main`, pull with `--ff-only`, and rebuild the bot. Run `npm test` locally one final time.

- [ ] **Step 7: Final operational check**

Confirm `https://promomega.com.br/health` returns `{"status":"ok"}`, the bot logs `ready` with collection enabled, Evolution remains healthy, and the next scheduled execution is 20 minutes after the controlled run.
