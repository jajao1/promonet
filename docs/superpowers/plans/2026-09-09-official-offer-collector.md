# Official Offer Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect ranked Mercado Livre products by niche from official APIs, create durable previews, and publish selected offers through the existing affiliate bridge and Evolution API.

**Architecture:** A focused collector module fetches highlights and bulk item data using the existing OAuth token lifecycle. A PostgreSQL-backed scheduler claims one due niche at a time, persists candidate/previews, and hands approved jobs to the existing affiliate and WhatsApp clients. Collection and publication are independently switchable so `DRY_RUN` produces inspectable previews without external sends.

**Tech Stack:** Node.js 24, PostgreSQL 16, Mercado Livre REST API, existing PowerShell affiliate bridge, Evolution API, Docker Compose, `node:test`.

---

## File map

- Create `config/niches.json`: category, destination, tag and cadence configuration.
- Create `bot/offer-source.mjs`: official API calls, bounded responses and normalized candidates.
- Create `bot/offer-policy.mjs`: validation, ranking and message formatting without I/O.
- Create `bot/collector-store.mjs`: schema, locking, cadence, previews and seven-day deduplication.
- Create `bot/collector.mjs`: one collection/publication orchestration cycle.
- Create tests beside the existing bot tests for every module.
- Modify `bot/server.mjs`: initialize and schedule collection.
- Modify `compose.yaml`, `.env.example`, `Dockerfile`, and `README.md`: configuration and operations.

### Task 1: Niche configuration

**Files:**
- Create: `config/niches.json`
- Create: `bot/niches.mjs`
- Test: `bot/test/niches.test.mjs`

- [ ] Write a failing test importing `validateNiches` and asserting that it accepts exactly these initial categories: technology=`MLB1000`, home=`MLB1574`, fashion=`MLB1430`, games=`MLB1144`; rejects duplicate destinations/categories, invalid `MLB` IDs, non-group destinations, invalid tags, intervals below 30 minutes, and limits other than one.
- [ ] Run `node --test bot/test/niches.test.mjs`; expect failure because `bot/niches.mjs` does not exist.
- [ ] Implement `validateNiches({ niches })` as a pure function returning frozen normalized records with `{id, categoryId, destinationGroup, tag, intervalMinutes, limit, enabled}` and fixed validation errors `invalid_niches` or `invalid_niche`.
- [ ] Create `config/niches.json` with the four records above, `intervalMinutes: 120`, `limit: 1`, tag `vijo3432338`; enable only `games` and point it to `120363411422374407@g.us` until additional destination groups are configured.
- [ ] Run the focused test; expect all niche tests to pass.

### Task 2: Official API source

**Files:**
- Create: `bot/offer-source.mjs`
- Test: `bot/test/offer-source.test.mjs`

- [ ] Write failing tests for `OfficialOfferSource.list(categoryId, token)`: request `GET https://api.mercadolibre.com/highlights/MLB/category/{categoryId}` with bearer authentication; accept `ITEM`, `PRODUCT`, and `USER_PRODUCT`; resolve item details through `GET /items/bulk?ids=...&attributes=body.id,body.title,body.status,body.permalink,body.thumbnail,body.price,body.original_price,body.category_id`; bound each response to 1 MiB; never retry 401, 403 or 429.
- [ ] Run `node --test bot/test/offer-source.test.mjs`; expect missing-module failure.
- [ ] Implement a private bounded JSON GET helper using `AbortSignal.timeout(15000)`, `redirect: "manual"`, bearer headers and fixed errors `source_auth_failed`, `source_rate_limited`, `source_unavailable`, `source_response_invalid`.
- [ ] Normalize every result to `{sourceType, sourceId, itemId, rank, title, status, permalink, imageUrl, price, originalPrice, categoryId}`. For `PRODUCT` and `USER_PRODUCT`, use the ID returned by the detail response; omit entries that cannot be resolved to an item rather than fabricating a URL.
- [ ] Run the focused tests; expect all source tests to pass.

### Task 3: Selection and truthful formatting

**Files:**
- Create: `bot/offer-policy.mjs`
- Test: `bot/test/offer-policy.test.mjs`

- [ ] Write failing tests proving `selectOffer` accepts only active records with matching category, HTTPS Mercado Livre product permalink containing `MLB`, HTTPS Mercado Livre image, positive finite price, and an item not present in the recent-ID set.
- [ ] Add test cases proving discount exists only when `originalPrice > price`; ranking prefers confirmed discount percentage, then highlight rank, then complete image data; ties are stable by `itemId`.
- [ ] Write failing tests for `formatOffer`: discounted output includes title, old price, current price, calculated integer percentage, `Publicidade` and the affiliate URL; nondiscounted output omits old price and percentage. Assert Brazilian currency via `Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"})`.
- [ ] Run `node --test bot/test/offer-policy.test.mjs`; expect missing-module failure.
- [ ] Implement only the pure `selectOffer(candidates, {categoryId, recentIds})` and `formatOffer(candidate, affiliateUrl)` functions described by the tests.
- [ ] Run the focused tests; expect all policy tests to pass.

### Task 4: Durable cadence, previews and deduplication

**Files:**
- Create: `bot/collector-store.mjs`
- Test: `bot/test/collector-store.test.mjs`

- [ ] Write failing tests against a fake query adapter for schema creation containing `promonet.collector_runs`, `promonet.offer_previews`, and `promonet.offer_publications`; require unique `(niche_id,item_id)` preview identity and unique `(niche_id,item_id,published_day)` publication identity.
- [ ] Test `claimDueNiche` uses a PostgreSQL advisory transaction lock and returns no niche before `last_started_at + interval`; `recentItemIds` uses a seven-day window; `savePreview` stores title, prices, image, product URL, state and timestamps; `markPublished` changes only the selected preview.
- [ ] Run `node --test bot/test/collector-store.test.mjs`; expect missing-module failure.
- [ ] Implement `CollectorStore` with parameterized SQL only. Persist `selected`, `simulated`, `published`, and `review` states; never persist access tokens, cookies or bridge keys.
- [ ] Run the focused tests; expect all store tests to pass.

### Task 5: One orchestration cycle

**Files:**
- Create: `bot/collector.mjs`
- Test: `bot/test/collector.test.mjs`

- [ ] Write a failing dry-run test for `collectOnce`: claim a due niche, acquire an OAuth token through injected `authorizedToken`, fetch candidates, select one, and persist a `simulated` preview without calling the bridge or Evolution.
- [ ] Write a failing live test: generate the affiliate link once, format the disclosure, download no remote image in the bot, call `EvolutionClient.send` as an image using the official HTTPS image URL, and mark the preview published only after an acknowledgement.
- [ ] Write failure tests: no candidate records a completed empty run; auth/rate-limit pauses the run; ambiguous send moves the preview to review and is never retried automatically.
- [ ] Run `node --test bot/test/collector.test.mjs`; expect missing-module failure.
- [ ] Implement `collectOnce({store,niches,source,authorizedToken,meli,evolution,dryRun,now})` with one candidate and one send maximum per call.
- [ ] Run the focused tests; expect all collector tests to pass.

### Task 6: Runtime scheduling

**Files:**
- Modify: `bot/server.mjs`
- Modify: `bot/test/runtime.test.mjs`
- Modify: `Dockerfile`

- [ ] Add a failing runtime test proving collection is disabled unless `COLLECTOR_ENABLED=true` and that a thrown collector error logs only `collector_unavailable`, then waits at least 30 seconds before another cycle.
- [ ] Run `node --test bot/test/runtime.test.mjs`; expect the new assertions to fail.
- [ ] Load `NICHES_CONFIG_PATH`, initialize `CollectorStore` and `OfficialOfferSource`, reuse `TokenStore`/`MeliOAuthClient.authorizedToken`, and call `collectOnce` from a dedicated loop. Keep the existing webhook worker loop independent.
- [ ] Copy `config` as already mounted; ensure no new dependency or writable filesystem path is required in `Dockerfile`.
- [ ] Run the runtime test; expect it to pass.

### Task 7: Compose, operations and controlled rollout

**Files:**
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `README.md`
- Test: `tests/smoke.test.mjs`

- [ ] Add failing smoke assertions for `COLLECTOR_ENABLED`, `NICHES_CONFIG_PATH`, OAuth token mount, affiliate bridge configuration and the enabled games niche.
- [ ] Run `node --test tests/smoke.test.mjs`; expect the new assertions to fail.
- [ ] Add `COLLECTOR_ENABLED=false` and `NICHES_CONFIG_PATH=/app/config/niches.json` to Compose and `.env.example`. Document OAuth authorization, bridge startup, preview inspection query and public-group requirement.
- [ ] Run `npm test` and `docker compose config --quiet`; expect zero failures.
- [ ] Rebuild with `docker compose up -d --build bot`, keep `COLLECTOR_ENABLED=false`, and verify `docker compose ps bot` reports healthy.
- [ ] Set `DRY_RUN=true` and `COLLECTOR_ENABLED=true`, recreate the bot, wait for one games preview, and inspect it without sending.
- [ ] After explicit user approval of that preview, set `DRY_RUN=false`, recreate the bot, allow one games publication, verify state `published`, then return `COLLECTOR_ENABLED=false` until the remaining destination groups are supplied.

## Verification checklist

- [ ] `npm test` reports no failures.
- [ ] `docker compose config --quiet` exits 0.
- [ ] No secret value appears in logs or preview rows.
- [ ] The same item cannot publish twice in seven days.
- [ ] A failed or ambiguous send is not retried automatically.
- [ ] Only individual product URLs reach the affiliate bridge.
- [ ] Every outbound message contains `Publicidade`.
