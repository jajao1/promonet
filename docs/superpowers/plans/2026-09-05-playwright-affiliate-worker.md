# Playwright Affiliate Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a supervised Windows worker that generates Mercado Livre affiliate links through the official web interface using a dedicated persistent Chromium profile.

**Architecture:** A local Node.js process connects to PostgreSQL over a loopback-only port, claims one conversion at a time, and drives a visible Playwright persistent context. URL policy, database queue, page automation, and terminal confirmation are separate modules. This prototype never sends a WhatsApp message and keeps `DRY_RUN=true`.

**Tech Stack:** Node.js 24 ESM, Node test runner, Playwright Chromium, PostgreSQL 16, `pg`, Docker Compose, PowerShell.

---

## File structure

- Create `worker/url-policy.mjs`: resolve short links, canonicalize eligible product URLs, and validate generated links.
- Create `worker/store.mjs`: queue, cache, state transitions, recovery, and circuit-breaker persistence.
- Create `worker/affiliate-page.mjs`: the only module containing Playwright locators and portal behavior.
- Create `worker/worker.mjs`: serial orchestration, authentication pause, and confirmation workflow.
- Create `worker/cli.mjs`: `run`, `enqueue`, `confirm`, `reject`, and `status` commands.
- Create `worker/test/url-policy.test.mjs`, `store.test.mjs`, `affiliate-page.test.mjs`, and `worker.test.mjs`.
- Create `scripts/install-playwright.ps1`: install the pinned Chromium runtime.
- Create `scripts/start-affiliate-worker.ps1`: safe visible worker launcher.
- Modify `package.json` and `package-lock.json`: add Playwright and worker commands.
- Modify `compose.yaml`: expose PostgreSQL only on `127.0.0.1:${POSTGRES_PORT:-5433}`.
- Modify `.env.example` and `.gitignore`: worker configuration and profile exclusion.
- Modify `README.md`: supervised operating procedure.

### Task 1: Product and affiliate URL policy

**Files:**
- Create: `worker/url-policy.mjs`
- Create: `worker/test/url-policy.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the worker test command**

Change scripts to:

```json
"test": "node --test bot/test/*.test.mjs worker/test/*.test.mjs",
"worker": "node worker/cli.mjs run"
```

- [ ] **Step 2: Write failing URL-policy tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalProductUrl, resolveSourceUrl, affiliateResult } from "../url-policy.mjs";

test("accepts and canonicalizes a Mercado Livre product URL", () => {
  assert.equal(canonicalProductUrl("https://produto.mercadolivre.com.br/MLB-1234567890-item#x"), "https://produto.mercadolivre.com.br/MLB-1234567890-item");
});

test("rejects search, category, account and non-Mercado-Livre URLs", () => {
  for (const url of ["https://lista.mercadolivre.com.br/fone", "https://www.mercadolivre.com.br/categoria", "https://www.mercadolivre.com.br/minha-conta", "https://example.com/MLB-123"]) assert.throws(() => canonicalProductUrl(url), /ineligible_url/);
});

test("accepts only a generated meli.la HTTPS URL", () => {
  assert.equal(affiliateResult("https://meli.la/AbC123"), "https://meli.la/AbC123");
  assert.throws(() => affiliateResult("http://meli.la/AbC123"), /invalid_affiliate_result/);
});

test("resolves meli.la through bounded official redirects", async () => {
  const fetch = async () => new Response(null, { status: 302, headers: { location: "https://produto.mercadolivre.com.br/MLB-1234567890-item" } });
  assert.equal(await resolveSourceUrl("https://meli.la/Source1", { fetch }), "https://produto.mercadolivre.com.br/MLB-1234567890-item");
});
```

- [ ] **Step 3: Run the test and observe the missing module**

Run: `node --test worker/test/url-policy.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement the strict policy**

```js
export function canonicalProductUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || !/(^|\.)mercadolivre\.com\.br$/i.test(url.hostname) || !/MLB-\d+/i.test(url.pathname)) throw Error("ineligible_url");
  url.hash = "";
  ["utm_source", "utm_medium", "utm_campaign"].forEach((key) => url.searchParams.delete(key));
  return url.toString();
}

export function affiliateResult(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== "meli.la" || url.pathname.length < 2) throw Error("invalid_affiliate_result");
  return url.toString();
}

export async function resolveSourceUrl(input, { fetch = globalThis.fetch, maxRedirects = 5 } = {}) {
  // Follow redirects manually; allow only meli.la and Mercado Livre hosts at every hop.
  // Return canonicalProductUrl after reaching the final product page.
}
```

- [ ] **Step 5: Run focused and complete tests**

Run: `node --test worker/test/url-policy.test.mjs && npm test`

Expected: all tests PASS.

### Task 2: Durable conversion queue and cache

**Files:**
- Create: `worker/store.mjs`
- Create: `worker/test/store.test.mjs`
- Modify: `compose.yaml`
- Modify: `.env.example`

- [ ] **Step 1: Write failing store contract tests**

Use a recording database double and verify SQL parameters for these calls:

```js
await store.enqueue({ sourceId: "manual-1", url: "https://produto.mercadolivre.com.br/MLB-1234567890-item", tag: "vijo3432338" });
await store.claim();
await store.generated(1, "https://meli.la/AbC123");
await store.confirm(1);
await store.reject(2);
await store.block(3, "blocked_auth");
```

Assert `enqueue` is idempotent by `source_id`, `claim` uses `FOR UPDATE SKIP LOCKED`, confirmed cache is unique by `(canonical_url, tag)`, and recovery moves `processing` to `review` rather than `queued`.

- [ ] **Step 2: Verify the store module is missing**

Run: `node --test worker/test/store.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `ConversionStore`**

Expose exactly:

```js
export class ConversionStore {
  constructor(db) { this.db = db; }
  async init() {}
  async enqueue({ sourceId, url, tag }) {}
  async cached(url, tag) {}
  async claim() {}
  async generated(id, affiliateUrl) {}
  async confirm(id) {}
  async reject(id) {}
  async block(id, category) {}
  async recover() {}
  async status() {}
}
```

Create `promonet.affiliate_conversions` with states constrained to `queued`, `processing`, `awaiting_confirmation`, `confirmed`, `review`, and `blocked_auth`. Store only fixed diagnostic categories. Do not store page HTML, cookies, QR content, or credentials.

- [ ] **Step 4: Expose PostgreSQL to Windows loopback only**

Add to the `postgres` service:

```yaml
ports:
  - '127.0.0.1:${POSTGRES_PORT:-5433}:5432'
```

Add to `.env.example`:

```dotenv
POSTGRES_PORT=5433
WORKER_DATABASE_URL=postgresql://promonet:CHANGE_ME@127.0.0.1:5433/promonet
AFFILIATE_TAG=vijo3432338
```

- [ ] **Step 5: Run store tests and validate Compose**

Run: `node --test worker/test/store.test.mjs && docker compose config --quiet && npm test`

Expected: all tests PASS and Compose exits 0.

### Task 3: Playwright page adapter

**Files:**
- Create: `worker/affiliate-page.mjs`
- Create: `worker/test/affiliate-page.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the pinned Playwright library without downloading browsers**

Run: `$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'; npm install --save-exact playwright@1.63.0`

Expected: `package.json` and lockfile contain exactly `1.63.0`.

- [ ] **Step 2: Write failing adapter tests against a fake semantic page**

Test these outcomes:

```js
assert.equal(await adapter.sessionState(), "authenticated");
assert.equal(await adapter.generate({ url: productUrl, tag: "vijo3432338" }), "https://meli.la/AbC123");
await assert.rejects(() => captchaAdapter.generate(input), /captcha_required/);
await assert.rejects(() => loggedOutAdapter.generate(input), /authentication_required/);
await assert.rejects(() => changedUiAdapter.generate(input), /ui_changed/);
```

The fake page records calls to `getByRole`, `getByLabel`, `fill`, `click`, and `textContent`; tests must assert that raw CSS selectors and internal HTTP endpoints are never used.

- [ ] **Step 3: Verify the missing adapter failure**

Run: `node --test worker/test/affiliate-page.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement `AffiliatePage`**

```js
export class AffiliatePage {
  constructor(page, { generatorUrl }) { this.page = page; this.generatorUrl = generatorUrl; }
  async sessionState() {}
  async generate({ url, tag }) {}
}
```

Navigate only to the configured official generator URL. Detect login/QR and CAPTCHA before form interaction. Use role/label locators with Portuguese accessible names. Fill the product URL, select an existing tag, click `Gerar`, and read the link displayed by the page. Set a 30-second action timeout. Map missing controls to `ui_changed` without including Playwright error text.

- [ ] **Step 5: Run adapter and complete tests**

Run: `node --test worker/test/affiliate-page.test.mjs && npm test`

Expected: all tests PASS.

### Task 4: Serial worker and circuit breaker

**Files:**
- Create: `worker/worker.mjs`
- Create: `worker/test/worker.test.mjs`

- [ ] **Step 1: Write failing orchestration tests**

Test one claimed item per call, confirmed cache reuse without page navigation, generated results entering `awaiting_confirmation`, and these fixed mappings:

```js
const categories = new Map([
  ["authentication_required", "blocked_auth"],
  ["captcha_required", "blocked_auth"],
  ["ui_changed", "review"],
  ["ineligible_url", "review"],
  ["invalid_affiliate_result", "review"],
]);
```

After three consecutive failures, assert the worker returns `circuit_open` and does not claim another item. A success resets the failure counter.

- [ ] **Step 2: Verify the worker module is missing**

Run: `node --test worker/test/worker.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement one-step orchestration**

```js
export class AffiliateWorker {
  constructor({ store, page, maxFailures = 3 }) {}
  async once() {}
}
```

`once()` claims no more than one item, consults confirmed cache first, validates output, and changes state exactly once. It never retries authentication, CAPTCHA, unknown UI, or an uncertain generation result.

- [ ] **Step 4: Run worker and complete tests**

Run: `node --test worker/test/worker.test.mjs && npm test`

Expected: all tests PASS.

### Task 5: Local CLI and human confirmation

**Files:**
- Create: `worker/cli.mjs`
- Create: `worker/test/cli.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing command-parser tests**

Assert these exact commands and argument requirements:

```text
run
enqueue <source-id> <product-url>
confirm <numeric-id>
reject <numeric-id>
status
```

Assert unknown commands and nonnumeric IDs fail with `invalid_command`, without echoing database credentials.

- [ ] **Step 2: Verify the CLI module is missing**

Run: `node --test worker/test/cli.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement CLI dependency composition**

Export `parseCommand(argv)` for tests. When executed directly, require `WORKER_DATABASE_URL`, `AFFILIATE_TAG`, `AFFILIATE_GENERATOR_URL`, and `PLAYWRIGHT_PROFILE_PATH`. Use `pg.Pool`, `chromium.launchPersistentContext(profile, { headless: false })`, `ConversionStore`, `AffiliatePage`, and `AffiliateWorker`.

For `run`, print only fixed events plus conversion ID and URLs. When a result awaits confirmation, prompt `Confirmar este link? [s/N]`; call `confirm(id)` only for an exact case-insensitive `s`. Any other input calls `reject(id)`. Never print page HTML, browser storage, cookies, headers, QR data, or environment variables.

- [ ] **Step 4: Exclude the complete browser profile**

Add:

```gitignore
secrets/playwright-profile/
playwright-report/
test-results/
```

- [ ] **Step 5: Run CLI and complete tests**

Run: `node --test worker/test/cli.test.mjs && npm test`

Expected: all tests PASS.

### Task 6: Installation and launcher scripts

**Files:**
- Create: `scripts/install-playwright.ps1`
- Create: `scripts/start-affiliate-worker.ps1`
- Modify: `.env.example`

- [ ] **Step 1: Create the installation script**

Use strict mode and run:

```powershell
npm ci
npx playwright install chromium
```

Fail if Node is below version 24 or if Chromium installation exits nonzero. Do not install browser extensions.

- [ ] **Step 2: Create the safe launcher**

The script loads only named worker keys from `.env` without printing their values, creates `secrets/playwright-profile` if absent, verifies PostgreSQL health with `docker compose ps postgres`, and runs `node worker/cli.mjs run` in the current visible terminal. It must not launch hidden and must not accept a headless option.

- [ ] **Step 3: Add worker settings**

Append to `.env.example`:

```dotenv
AFFILIATE_GENERATOR_URL=https://www.mercadolivre.com.br/afiliados/linkbuilder
PLAYWRIGHT_PROFILE_PATH=./secrets/playwright-profile
AFFILIATE_SUPERVISED_LIMIT=20
```

- [ ] **Step 4: Parse both PowerShell files**

Run:

```powershell
$errors = @()
foreach ($file in 'scripts/install-playwright.ps1','scripts/start-affiliate-worker.ps1') {
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file), [ref]$null, [ref]$errors) | Out-Null
}
if ($errors.Count) { $errors | Format-List; exit 1 }
```

Expected: exit 0 with no parser errors.

### Task 7: Supervised smoke test

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the operating sequence**

Document: install Chromium; start containers; enqueue one known eligible product; start worker; scan QR manually; wait for generated link; confirm it; query status. State that `DRY_RUN` remains true and WhatsApp receives nothing.

- [ ] **Step 2: Install Chromium and start infrastructure**

Run: `.\scripts\install-playwright.ps1` then `docker compose up -d postgres`

Expected: installation exits 0 and PostgreSQL is healthy with only port 5433 exposed on loopback.

- [ ] **Step 3: Enqueue one supervised conversion**

Run:

```powershell
node worker/cli.mjs enqueue manual-smoke-1 https://produto.mercadolivre.com.br/MLB-1234567890-item
```

Replace the example only at execution time with a current eligible product URL supplied by the operator. Expected: one queued ID; no browser session data printed.

- [ ] **Step 4: Start the visible worker and complete QR login manually**

Run: `.\scripts\start-affiliate-worker.ps1`

Expected: visible Chromium opens. The worker pauses for manual QR/login without attempting to bypass it, then continues after the official authenticated generator appears.

- [ ] **Step 5: Confirm the generated link**

Expected: terminal shows the canonical product URL and validated `https://meli.la/...` link. Enter `s`; status becomes `confirmed`. No WhatsApp send occurs.

- [ ] **Step 6: Verify safety and regression**

Run:

```powershell
npm test
docker compose config --quiet
$matches = docker compose logs --no-color bot | Select-String -Pattern 'access_token|refresh_token|client_secret|cookie=' -CaseSensitive:$false
if ($matches) { $matches; exit 1 }
```

Expected: all tests PASS, Compose exits 0, and the secret scan returns no matches in tracked project files.

## Execution prerequisite

This directory is not a Git repository, so worktree isolation and commit steps are unavailable. Execute in the current workspace only after explicit user selection, preserve all existing files, and never add `.env`, OAuth tokens, browser profiles, cookies, QR data, or authorization codes to version control.
