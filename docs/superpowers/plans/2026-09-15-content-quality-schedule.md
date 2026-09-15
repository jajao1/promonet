# PromoMega Content Quality, Schedule, and Branded Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a diverse, non-food WhatsApp feed from 07:00 to 23:00 Brasília time, suppress equivalent products for seven days, and render every delivered offer as a consistent 1080×1080 PromoMega card.

**Architecture:** Add three focused pure modules for scheduling, product identity, and image composition; keep orchestration in the collector. Extend PostgreSQL storage with durable deduplication keys and expiring reservations so concurrent or retried rounds cannot send the same product, then persist session-alert incidents and round metrics. Compose cards locally with Sharp and send their base64 bytes through the existing Evolution client.

**Tech Stack:** Node.js 24 ESM, PostgreSQL 16, Sharp, Evolution API v2, Node test runner, Docker Compose.

---

## File Structure

- Create `bot/collector-schedule.mjs`: Brasília-time window calculation and next-loop delay.
- Create `bot/product-fingerprint.mjs`: canonical URL and conservative brand/product fingerprint generation.
- Create `bot/offer-card.mjs`: bounded image download and deterministic 1080×1080 Sharp composition.
- Create `bot/test/collector-schedule.test.mjs`: schedule boundary and no-backlog tests.
- Create `bot/test/product-fingerprint.test.mjs`: equivalent-listing matches and distinct-model non-matches.
- Create `bot/test/offer-card.test.mjs`: output dimensions, contain fitting, and invalid-image tests.
- Modify `bot/collector-runtime.mjs`: enforce the daily window and configurable 20-minute cadence.
- Modify `bot/collector-store.mjs`: durable identity keys, reservations, incident state, and round metrics.
- Modify `bot/offer-policy.mjs`: food exclusion, candidate scoring inputs, and quota-aware diversified selection.
- Modify `bot/collector.mjs`: collect candidate pools, reserve identities, compose images, validate affiliate links, deliver, and record metrics.
- Modify `bot/session-alert.mjs`: persist one notification per active authentication incident.
- Modify `bot/server.mjs`: validate configuration and inject schedule, card composer, and persistent alert dependencies.
- Modify `bot/niches.mjs`: accept the approved per-round quota while retaining strict config validation.
- Modify `config/niches.json`: add clothing/accessories and category metadata while retaining non-food categories.
- Modify `bot/test/collector-runtime.test.mjs`, `bot/test/collector-store.test.mjs`, `bot/test/offer-policy.test.mjs`, `bot/test/collector.test.mjs`, `bot/test/session-alert.test.mjs`, and `bot/test/niches.test.mjs`: integration behavior.
- Modify `package.json` and `package-lock.json`: add Sharp.
- Modify `.env.example`, `compose.yaml`, `Dockerfile`, and `README.md`: production defaults, logo asset, and operations.

### Task 1: Add the Brasília Operating Window

**Files:**
- Create: `bot/collector-schedule.mjs`
- Create: `bot/test/collector-schedule.test.mjs`
- Modify: `bot/collector-runtime.mjs`
- Modify: `bot/test/collector-runtime.test.mjs`

- [ ] **Step 1: Write failing schedule tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {collectorWindow} from "../collector-schedule.mjs";

const at=(iso)=>new Date(iso);
test("permits 07:00 through 22:59 in Sao Paulo",()=>{
  assert.equal(collectorWindow(at("2026-09-15T10:00:00Z"),{timeZone:"America/Sao_Paulo",startHour:7,endHour:23}).open,true);
  assert.equal(collectorWindow(at("2026-09-16T01:59:59Z"),{timeZone:"America/Sao_Paulo",startHour:7,endHour:23}).open,true);
});
test("closes at 23:00 and resumes once at 07:00",()=>{
  const config={timeZone:"America/Sao_Paulo",startHour:7,endHour:23};
  assert.equal(collectorWindow(at("2026-09-16T02:00:00Z"),config).open,false);
  assert.equal(collectorWindow(at("2026-09-16T09:59:59Z"),config).open,false);
  assert.equal(collectorWindow(at("2026-09-16T10:00:00Z"),config).open,true);
});
```

Add a runtime test that injects `now`, asserts no collection while closed, and asserts the returned delay targets the next 07:00 rather than replaying missed iterations.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test bot/test/collector-schedule.test.mjs bot/test/collector-runtime.test.mjs`
Expected: FAIL because `collector-schedule.mjs` and window-aware runtime behavior do not exist.

- [ ] **Step 3: Implement the schedule module and runtime cadence**

```js
export function collectorWindow(now=new Date(),{timeZone="America/Sao_Paulo",startHour=7,endHour=23}={}){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const values=Object.fromEntries(parts.formatToParts(now).map(x=>[x.type,x.value]));
  const hour=Number(values.hour);
  return {open:hour>=startHour&&hour<endHour,localHour:hour};
}
export function nextCollectorDelay(now=new Date(),intervalMs=20*60*1000,window={}){
  if(collectorWindow(now,window).open)return intervalMs;
  for(let ms=60_000;ms<=8*60*60*1000;ms+=60_000){
    if(collectorWindow(new Date(now.getTime()+ms),window).open)return ms;
  }
  throw Error("collector_schedule_invalid");
}
```

Change `runCollectorLoop` to accept `now=()=>new Date()`, `intervalMs=1200000`, and `window={timeZone:"America/Sao_Paulo",startHour:7,endHour:23}`; call `collect()` only when `collectorWindow(now(),window).open`, then delay using `nextCollectorDelay(now(),intervalMs,window)`. Retain the fixed 30-second error backoff.

- [ ] **Step 4: Run focused tests**

Run: `node --test bot/test/collector-schedule.test.mjs bot/test/collector-runtime.test.mjs`
Expected: PASS, including UTC timestamps that map to the Brasília boundaries.

- [ ] **Step 5: Commit**

```powershell
git add bot/collector-schedule.mjs bot/collector-runtime.mjs bot/test/collector-schedule.test.mjs bot/test/collector-runtime.test.mjs
git commit -m "feat: enforce collector operating hours"
```

### Task 2: Define Conservative Product Identities

**Files:**
- Create: `bot/product-fingerprint.mjs`
- Create: `bot/test/product-fingerprint.test.mjs`

- [ ] **Step 1: Write failing identity tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {offerIdentities,productFingerprint} from "../product-fingerprint.mjs";

test("matches equivalent listings while ignoring color size and sales noise",()=>{
  assert.equal(productFingerprint("Tênis Nike Revolution 7 Masculino Preto Tam 41"),productFingerprint("Nike Tênis Revolution 7 Promoção cor azul tamanho 42"));
});
test("preserves meaningful model and generation differences",()=>{
  assert.notEqual(productFingerprint("Controle Sony DualSense PS5"),productFingerprint("Controle Sony DualShock 4 PS4"));
  assert.notEqual(productFingerprint("iPhone 15 128GB"),productFingerprint("iPhone 15 Pro 128GB"));
});
test("canonicalizes Mercado Livre URLs and emits three namespaced keys",()=>{
  const keys=offerIdentities({itemId:"MLB123",title:"Furadeira Bosch GSB 13 RE",permalink:"https://produto.mercadolivre.com.br/MLB-123-x?tracking=1#foo"});
  assert.equal(keys.length,3);
  assert.ok(keys.some(x=>x.startsWith("item:")));
  assert.ok(keys.some(x=>x.startsWith("url:")));
  assert.ok(keys.some(x=>x.startsWith("product:")));
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test bot/test/product-fingerprint.test.mjs`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic normalization**

Create exported `canonicalProductUrl`, `productFingerprint`, and `offerIdentities`. Use Unicode NFD accent removal, alphanumeric tokenization, a bounded set of Portuguese sales-noise/color/size tokens, and SHA-256 hashes for stored URL/product keys. Preserve model tokens containing digits and distinguishing tokens such as `pro`, `max`, `ultra`, `plus`, `dualshock`, and `dualsense`.

```js
import {createHash} from "node:crypto";
const digest=value=>createHash("sha256").update(value).digest("hex");
export function canonicalProductUrl(value){const url=new URL(value);url.hash="";for(const key of [...url.searchParams.keys()])if(!["variation"].includes(key))url.searchParams.delete(key);return url.toString();}
export function offerIdentities(offer){return [`item:${offer.itemId.toUpperCase()}`,`url:${digest(canonicalProductUrl(offer.permalink))}`,`product:${digest(productFingerprint(offer.title))}`];}
```

Keep fingerprint output non-empty only when at least two meaningful tokens remain; otherwise omit the `product:` key to avoid aggressive false positives.

- [ ] **Step 4: Run focused tests**

Run: `node --test bot/test/product-fingerprint.test.mjs`
Expected: PASS for equivalent listings and explicit distinct-model cases.

- [ ] **Step 5: Commit**

```powershell
git add bot/product-fingerprint.mjs bot/test/product-fingerprint.test.mjs
git commit -m "feat: fingerprint equivalent products"
```

### Task 3: Persist Deduplication Reservations and Metrics

**Files:**
- Modify: `bot/collector-store.mjs`
- Modify: `bot/test/collector-store.test.mjs`

- [ ] **Step 1: Write failing storage tests**

Add tests that assert `init()` creates `offer_identity_keys`, `collector_rounds`, and `collector_incidents`; `recentIdentityKeys()` returns seven-day published keys; `reserveOffer()` returns false when any requested key is already published/reserved; `confirmOffer()` publishes all reserved identities only after acknowledgement; `releaseOffer()` removes an unconfirmed reservation; and `recordRound()` uses numeric counters without secrets.

```js
assert.match(schema,/offer_identity_keys/);
assert.match(schema,/UNIQUE\s*\(identity_key\)/i);
assert.match(schema,/reserved_until/);
assert.match(schema,/collector_rounds/);
assert.match(schema,/collector_incidents/);
```

- [ ] **Step 2: Run the storage tests and verify failure**

Run: `node --test bot/test/collector-store.test.mjs`
Expected: FAIL because identity reservation and metric methods are absent.

- [ ] **Step 3: Add schema and transactional methods**

Add:

```sql
CREATE TABLE IF NOT EXISTS promonet.offer_identity_keys(
  identity_key TEXT PRIMARY KEY,
  reservation_id UUID,
  reserved_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  niche_id TEXT,
  item_id TEXT
);
CREATE TABLE IF NOT EXISTS promonet.collector_rounds(
  round_id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metrics JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS promonet.collector_incidents(
  incident_key TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT false,
  notified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Implement `reserveOffer(keys,{nicheId,itemId,reservationId})` in a database transaction: delete expired unconfirmed rows, reject if any key has `published_at >= now()-interval '7 days'` or a live reservation, then insert/update every key with the same reservation and a 10-minute expiry. Implement `confirmOffer` to set `published_at=now()` and clear reservation fields, `releaseOffer` to delete only unconfirmed rows for that reservation, and `recentIdentityKeys` to return a `Set`. Use `crypto.randomUUID()` at the caller, not database-generated extensions.

- [ ] **Step 4: Run focused tests**

Run: `node --test bot/test/collector-store.test.mjs`
Expected: PASS, including a simulated overlapping reservation rejection.

- [ ] **Step 5: Commit**

```powershell
git add bot/collector-store.mjs bot/test/collector-store.test.mjs
git commit -m "feat: persist offer identities and reservations"
```

### Task 4: Add Clothing Coverage, Food Exclusion, and Diversity Quotas

**Files:**
- Modify: `config/niches.json`
- Modify: `bot/niches.mjs`
- Modify: `bot/offer-policy.mjs`
- Modify: `bot/test/niches.test.mjs`
- Modify: `bot/test/offer-policy.test.mjs`

- [ ] **Step 1: Write failing policy and config tests**

Add fixtures for clothing, accessories, tools, sneakers, and food. Assert food-title signals such as macarrão, açúcar, refrigerante, café, arroz, bebida, and alimento are rejected; clothing remains valid; and `diversifyOffers` selects at most two offers per niche while filling up to ten from other niches.

```js
assert.deepEqual(diversifyOffers(candidates,{limit:10,perNiche:2}).reduce((m,x)=>m.set(x.nicheId,(m.get(x.nicheId)||0)+1),new Map()).get("tools"),2);
assert.equal(isFoodOrBeverage({title:"Açúcar refinado 1kg",categoryId:"MLB..."}),true);
assert.equal(isFoodOrBeverage({title:"Tênis Nike Revolution",categoryId:"MLB23332"}),false);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test bot/test/niches.test.mjs bot/test/offer-policy.test.mjs`
Expected: FAIL because the new categories and quota-aware policy do not exist.

- [ ] **Step 3: Extend validated configuration and selection**

Add `clothing` and `accessories` niche entries using verified non-food leaf category IDs. Add `maxPerRound` with default 2 to validated niche metadata. Export `isFoodOrBeverage` and `diversifyOffers`; run title/category exclusion before scoring, group valid ranked offers by niche, and repeatedly take the next best candidate from each group until the global limit or per-niche cap is reached.

Do not change the existing requirement that each category appears in only one configured niche. Keep all food root/category IDs forbidden.

- [ ] **Step 4: Verify configured categories against tests and the official checker**

Run: `node --test bot/test/niches.test.mjs bot/test/offer-policy.test.mjs`
Expected: PASS.
Run with a valid temporary OAuth token: `npm run verify:categories`
Expected: every configured category reports supported; if a new ID is unsupported, replace it with a verified leaf ID before committing.

- [ ] **Step 5: Commit**

```powershell
git add config/niches.json bot/niches.mjs bot/offer-policy.mjs bot/test/niches.test.mjs bot/test/offer-policy.test.mjs
git commit -m "feat: diversify non-food offer selection"
```

### Task 5: Generate the 1080×1080 PromoMega Card

**Files:**
- Create: `bot/offer-card.mjs`
- Create: `bot/test/offer-card.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `Dockerfile`

- [ ] **Step 1: Add Sharp with its lockfile entry**

Run: `npm install sharp@0.34.4 --save-exact`
Expected: `package.json` and `package-lock.json` contain Sharp 0.34.4 and its platform packages.

- [ ] **Step 2: Write failing card tests**

Generate in-memory portrait, landscape, and square fixture images with Sharp. Mock fetch and assert `composeOfferCard()` returns JPEG, width 1080, height 1080, includes non-background pixels inside the fixed product region, and rejects HTTP errors, payloads above 8 MiB, non-image content types, and invalid bytes.

```js
const result=await composeOfferCard(offer,{fetch,logoPath});
const metadata=await sharp(result).metadata();
assert.deepEqual({width:metadata.width,height:metadata.height,format:metadata.format},{width:1080,height:1080,format:"jpeg"});
```

- [ ] **Step 3: Run the test and verify failure**

Run: `node --test bot/test/offer-card.test.mjs`
Expected: FAIL because the composer does not exist.

- [ ] **Step 4: Implement bounded download and SVG-overlay composition**

Implement `downloadProductImage` with HTTPS-only URLs, an `mlstatic.com` hostname check, redirect disabled, 15-second timeout, `image/*` content type, and an 8 MiB streaming limit. Implement `composeOfferCard(offer,{fetch,logoPath})` using a 1080×1080 `#f7f8f7` canvas, product contained within 820×650 at `(130,180)`, rounded logo at the top, green discount badge, struck-through previous price, large current price, and a `#101512` footer with PromoMega green `#36f35b` accents. Escape all dynamic text before inserting it into the SVG overlay.

Return a JPEG buffer at quality 88. Throw `offer_image_invalid` for any fetch, decode, dimension, or composition failure.

- [ ] **Step 5: Run focused tests and ensure the container includes the logo**

Run: `node --test bot/test/offer-card.test.mjs`
Expected: PASS.
Ensure `Dockerfile` retains `COPY --chown=node:node site ./site`, because `/app/site/logo.jpg` is the production logo path.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json Dockerfile bot/offer-card.mjs bot/test/offer-card.test.mjs
git commit -m "feat: render branded square offer cards"
```

### Task 6: Make Authentication Alerts Durable

**Files:**
- Modify: `bot/session-alert.mjs`
- Modify: `bot/test/session-alert.test.mjs`
- Modify: `bot/collector-store.mjs`
- Modify: `bot/test/collector-store.test.mjs`

- [ ] **Step 1: Write failing incident tests**

Change SessionAlert tests to inject an incident store with `beginIncident("meli_session")` and `resolveIncident("meli_session")`. Assert two SessionAlert instances backed by the same store produce only one notification, and that a successful restoration permits a later independent notification.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test bot/test/session-alert.test.mjs bot/test/collector-store.test.mjs`
Expected: FAIL because alerts are only process-local.

- [ ] **Step 3: Implement persisted incident transitions**

Add `beginIncident(key)` using `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE active=false RETURNING incident_key`, and `resolveIncident(key)` setting `active=false`. Change SessionAlert to:

```js
async required(){if(!await this.incidents.beginIncident("meli_session"))return false;try{await this.evolution.send({destination:this.destination,kind:"text",text:MESSAGE});return true;}catch(error){await this.incidents.resolveIncident("meli_session");throw error;}}
async restored(){await this.incidents.resolveIncident("meli_session");}
```

Require the incident store in the constructor and update collector call sites to await `restored()`.

- [ ] **Step 4: Run focused tests**

Run: `node --test bot/test/session-alert.test.mjs bot/test/collector-store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add bot/session-alert.mjs bot/collector-store.mjs bot/test/session-alert.test.mjs bot/test/collector-store.test.mjs
git commit -m "feat: persist affiliate session incidents"
```

### Task 7: Integrate Selection, Reservations, Cards, and Delivery

**Files:**
- Modify: `bot/collector.mjs`
- Modify: `bot/test/collector.test.mjs`
- Modify: `bot/clients.mjs`
- Modify: `bot/test/clients.test.mjs`

- [ ] **Step 1: Write failing orchestration tests**

Cover a 10-offer round across at least five niches; food removal; equivalent-title rejection; reservation loss; image-composition failure; affiliate failure without ordinary-link fallback; base64 card delivery; release after known pre-send failure; confirmation only after Evolution acknowledgement; and metrics for discovered, rejected, skipped, delivered, and failed candidates.

```js
assert.equal(sends[0].media,cardBuffer.toString("base64"));
assert.ok(events.indexOf("affiliate")<events.indexOf("send"));
assert.ok(events.indexOf("send")<events.indexOf("confirm"));
assert.equal(result.published,10);
assert.ok(result.rejectedFingerprint>0);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test bot/test/collector.test.mjs bot/test/clients.test.mjs`
Expected: FAIL because the collector sends original image URLs and lacks reservations/metrics.

- [ ] **Step 3: Refactor one round around candidate pools**

Give `collectDue` dependencies `composeCard`, `randomUUID`, and `roundLimit=10`. Fetch due niche/category candidate lists, annotate every candidate with `nicheId`, `destinationGroup`, `tag`, and `categoryId`, filter against recent identity keys, then pass the pool to `diversifyOffers`.

For each selected candidate:

1. call `reserveOffer(offerIdentities(offer), ...)`;
2. save its preview;
3. create the affiliate URL;
4. await session restoration;
5. compose the JPEG buffer;
6. send `buffer.toString("base64")` using `mimetype:"image/jpeg"`;
7. confirm the reserved identity keys and mark the preview/publication only after Evolution acknowledgement;
8. release the reservation after a known pre-send failure;
9. retain review state after an ambiguous send failure without retrying blindly.

Accumulate counters in a round summary and call `recordRound(roundId, summary)` in `finally`. Logger payloads contain only the round ID, niche/category IDs, item ID, outcome, and counters.

- [ ] **Step 4: Tighten Evolution media validation**

In `EvolutionClient.send`, require image media to be valid base64 and cap it at the existing 7 MiB encoded envelope before POST. Keep acknowledgement validation unchanged.

- [ ] **Step 5: Run focused tests**

Run: `node --test bot/test/collector.test.mjs bot/test/clients.test.mjs`
Expected: PASS; no test observes an original product URL being supplied as Evolution media.

- [ ] **Step 6: Commit**

```powershell
git add bot/collector.mjs bot/clients.mjs bot/test/collector.test.mjs bot/test/clients.test.mjs
git commit -m "feat: publish reserved branded offer batches"
```

### Task 8: Wire and Document Production Configuration

**Files:**
- Modify: `bot/server.mjs`
- Modify: `bot/test/pipeline.test.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `README.md`

- [ ] **Step 1: Write failing configuration tests**

Add or extend server/pipeline tests for defaults and invalid values: interval 20 minutes, `America/Sao_Paulo`, 07:00, 23:00 exclusive, round limit 10, niche limit 2, retention 7 days, and administrator number validation. Assert the card composer receives `/app/site/logo.jpg` in production configuration.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test bot/test/pipeline.test.mjs`
Expected: FAIL because the new collector settings are not wired.

- [ ] **Step 3: Parse and inject explicit settings**

Add these defaults to `.env.example` and `compose.yaml`:

```dotenv
COLLECTOR_INTERVAL_MINUTES=20
COLLECTOR_TIME_ZONE=America/Sao_Paulo
COLLECTOR_START_HOUR=7
COLLECTOR_END_HOUR=23
COLLECTOR_ROUND_LIMIT=10
COLLECTOR_MAX_PER_NICHE=2
COLLECTOR_DEDUP_DAYS=7
OFFER_CARD_LOGO_PATH=/app/site/logo.jpg
ADMIN_WHATSAPP=5543991724961
```

Validate integer ranges and require the approved time zone/window for this release. Instantiate `CollectorStore` before SessionAlert, inject it as the incident store, instantiate the card composer with the configured logo path, and pass cadence/window/limits into the runtime and collector.

- [ ] **Step 4: Update operations documentation**

Document the quiet period, no-backlog behavior, category quotas, clothing coverage, seven-day conservative identity rule, 1080×1080 local Sharp rendering, one-alert-per-session-incident behavior, and safe database queries for recent round counters. State that affiliate failure never falls back to a normal link.

- [ ] **Step 5: Run focused tests**

Run: `node --test bot/test/pipeline.test.mjs bot/test/session-alert.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add bot/server.mjs bot/test/pipeline.test.mjs .env.example compose.yaml README.md
git commit -m "docs: configure scheduled branded collector"
```

### Task 9: Full Verification and Controlled Dry Run

**Files:**
- Modify only if verification reveals a defect in files owned by Tasks 1–8.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`
Expected: all bot and worker tests PASS with zero failures.

- [ ] **Step 2: Run static and configuration checks**

```powershell
node --check bot/collector.mjs
node --check bot/collector-store.mjs
node --check bot/offer-card.mjs
node --check bot/product-fingerprint.mjs
docker compose config --quiet
```

Expected: every command exits 0 and prints no secret values.

- [ ] **Step 3: Build and smoke-test the container**

```powershell
docker compose build bot
$env:BOT_PORT='13000'
$env:EVOLUTION_PORT='18080'
docker compose --env-file .env.example -p promomega-quality-check -f compose.yaml -f tests/compose.smoke.yaml up -d --build
Invoke-RestMethod http://localhost:13000/health
node --test tests/smoke.test.mjs
docker compose --env-file .env.example -p promomega-quality-check -f compose.yaml -f tests/compose.smoke.yaml down
Remove-Item Env:BOT_PORT
Remove-Item Env:EVOLUTION_PORT
```

Expected: the bot image builds, health returns `{status:"ok"}`, smoke tests PASS, and the isolated stack stops without deleting volumes.

- [ ] **Step 4: Run a no-send collector preview**

Start the real configuration with `DRY_RUN=true` and `COLLECTOR_ENABLED=true`, allow one open-window round, then inspect only sanitized counters and preview metadata:

```powershell
docker compose up -d --build --force-recreate bot
docker compose logs --tail 100 bot
docker compose exec -T postgres psql -U promonet -d promonet -c "SELECT metrics,started_at,finished_at FROM promonet.collector_rounds ORDER BY started_at DESC LIMIT 1"
```

Expected: no Evolution send occurs; the round contains non-food candidates, more than one niche when inventory permits, and no secret material in logs.

- [ ] **Step 5: Inspect one generated card fixture**

Write a generated test card to a temporary path using the tested composer, inspect that it is 1080×1080 and matches approved option A, then remove only that explicit temporary file.

- [ ] **Step 6: Review repository state and commit verification fixes if any**

Run: `git status --short` and `git diff --check`
Expected: no unexpected files, whitespace errors, cookies, tokens, QR codes, or generated card artifacts. If a verification-only correction was required, commit it as `fix: complete collector quality verification`.
