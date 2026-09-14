# Mercado Livre OAuth with Cloudflare Quick Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Mercado Livre OAuth flow, rotating token storage, and a temporary HTTPS callback through Cloudflare Quick Tunnel while keeping real offer publication disabled.

**Architecture:** The existing Node HTTP server will route Evolution webhooks and Mercado Livre OAuth requests through separate handlers. OAuth state and token persistence live in focused modules, while a Mercado Livre OAuth client owns authorization, token exchange, refresh, and authenticated probes. A host-side PowerShell script starts `cloudflared`; Docker exposes only the callback's local port.

**Tech Stack:** Node.js 24 ESM, built-in `node:http`, `node:crypto`, `node:fs/promises`, Node test runner, Docker Compose, PowerShell, Cloudflare `cloudflared`, Mercado Livre OAuth REST endpoints.

---

## File structure

- Create `bot/oauth-state.mjs`: one-time, expiring OAuth state generation and validation.
- Create `bot/token-store.mjs`: validated, atomic OAuth-token persistence.
- Create `bot/meli-oauth.mjs`: official authorization, token exchange, refresh, and identity probe.
- Create `bot/oauth-handler.mjs`: HTTP routes for starting and completing authorization.
- Create `bot/test/oauth-state.test.mjs`: state lifecycle tests.
- Create `bot/test/token-store.test.mjs`: storage and rotation-failure tests.
- Create `bot/test/meli-oauth.test.mjs`: request contracts and response validation tests.
- Create `bot/test/oauth-handler.test.mjs`: local HTTP flow and secret-redaction tests.
- Create `scripts/start-meli-oauth-tunnel.ps1`: install/check `cloudflared`, run tunnel, and print the redirect URI.
- Create `scripts/check-meli-oauth.mjs`: perform a sanitized authenticated identity check from inside the bot container.
- Modify `bot/server.mjs`: compose OAuth dependencies and route HTTP requests.
- Modify `compose.yaml`: pass OAuth configuration and mount the writable token file location.
- Modify `.env.example`: document non-secret OAuth configuration and empty secret fields.
- Modify `.gitignore`: explicitly preserve the token-file exclusion.
- Modify `README.md`: document the safe authorization workflow and limitations.

### Task 1: One-time OAuth state manager

**Files:**
- Create: `bot/oauth-state.mjs`
- Test: `bot/test/oauth-state.test.mjs`

- [ ] **Step 1: Write the failing state lifecycle tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { OAuthStateStore } from "../oauth-state.mjs";

test("consumes a valid state exactly once", () => {
  const states = new OAuthStateStore({ now: () => 1_000, ttlMs: 60_000 });
  const state = states.issue();
  assert.equal(states.consume(state), true);
  assert.equal(states.consume(state), false);
});

test("rejects expired and unknown states", () => {
  let now = 1_000;
  const states = new OAuthStateStore({ now: () => now, ttlMs: 100 });
  const state = states.issue();
  now = 1_101;
  assert.equal(states.consume(state), false);
  assert.equal(states.consume("unknown"), false);
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test bot/test/oauth-state.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `bot/oauth-state.mjs`.

- [ ] **Step 3: Implement the minimal state manager**

```js
import { randomBytes } from "node:crypto";

export class OAuthStateStore {
  constructor({ now = Date.now, ttlMs = 10 * 60_000 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.states = new Map();
  }
  issue() {
    const state = randomBytes(32).toString("base64url");
    this.states.set(state, this.now() + this.ttlMs);
    return state;
  }
  consume(state) {
    const expiresAt = typeof state === "string" ? this.states.get(state) : null;
    if (!expiresAt) return false;
    this.states.delete(state);
    return expiresAt >= this.now();
  }
}
```

- [ ] **Step 4: Run the focused and complete test suites**

Run: `node --test bot/test/oauth-state.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit the state manager**

```powershell
git add bot/oauth-state.mjs bot/test/oauth-state.test.mjs
git commit -m "feat: add one-time OAuth state validation"
```

### Task 2: Atomic OAuth token store

**Files:**
- Create: `bot/token-store.mjs`
- Test: `bot/test/token-store.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write tests for validated load and atomic replacement**

Use a temporary directory and assert that a valid record round-trips, that a missing file returns `null`, and that invalid records are rejected:

```js
const valid = {
  accessToken: "access-value",
  refreshToken: "refresh-value",
  expiresAt: 20_000,
  userId: 174576489,
};
await store.save(valid);
assert.deepEqual(await store.load(), valid);
await assert.rejects(() => store.save({ accessToken: "x" }), /oauth_tokens_invalid/);
```

Stub the injected filesystem `rename` operation to fail and assert that the previously saved record remains readable.

- [ ] **Step 2: Verify the tests fail before implementation**

Run: `node --test bot/test/token-store.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `TokenStore` with an injected filesystem**

The public contract is:

```js
export class TokenStore {
  constructor(path, { fs = defaultFs } = {}) { /* retain path and fs */ }
  async load() { /* return null on ENOENT; parse and validate otherwise */ }
  async save(tokens) { /* validate; write mode 0o600 to `${path}.tmp`; rename */ }
}
```

Accept only an object containing non-empty `accessToken` and `refreshToken`, a finite positive `expiresAt`, and a string or numeric `userId`. Never include token values in thrown errors.

- [ ] **Step 4: Make the exclusion explicit**

Append this exact entry to `.gitignore` if it is not already covered:

```gitignore
secrets/meli-oauth.json
secrets/meli-oauth.json.tmp
```

- [ ] **Step 5: Run tests and inspect Git tracking**

Run: `node --test bot/test/token-store.test.mjs && npm test && git check-ignore secrets/meli-oauth.json`

Expected: tests PASS and `git check-ignore` prints `secrets/meli-oauth.json`.

- [ ] **Step 6: Commit the token store**

```powershell
git add bot/token-store.mjs bot/test/token-store.test.mjs .gitignore
git commit -m "feat: persist OAuth tokens atomically"
```

### Task 3: Mercado Livre OAuth client

**Files:**
- Create: `bot/meli-oauth.mjs`
- Test: `bot/test/meli-oauth.test.mjs`

- [ ] **Step 1: Write authorization URL tests**

Assert that `authorizationUrl(state)` targets `https://auth.mercadolivre.com.br/authorization` and contains exact `response_type=code`, `client_id`, `redirect_uri`, and `state` values.

- [ ] **Step 2: Write token exchange and refresh tests**

Inject a fake `fetch`, capture its call, and assert:

```js
assert.equal(request.method, "POST");
assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded");
assert.match(request.body, /grant_type=authorization_code/);
assert.doesNotMatch(request.body, /undefined|null/);
```

For refresh, require `grant_type=refresh_token`. Return fixtures with `access_token`, `refresh_token`, `expires_in`, and `user_id`; assert the normalized result has camel-case fields and an absolute `expiresAt`.

- [ ] **Step 3: Write failure and redaction tests**

Test non-2xx, oversized, invalid JSON, missing rotating refresh token, and timeout paths. Assert every rejection uses fixed codes such as `oauth_remote_failed` or `oauth_response_invalid`, never the response body or a credential.

- [ ] **Step 4: Implement the client**

```js
export class MeliOAuthClient {
  constructor({ clientId, clientSecret, redirectUri, fetch = globalThis.fetch, now = Date.now }) {}
  authorizationUrl(state) {}
  async exchange(code) {}
  async refresh(refreshToken) {}
  async identity(accessToken) {}
}
```

POST form data to `https://api.mercadolibre.com/oauth/token`; call `GET https://api.mercadolibre.com/users/me` with `Authorization: Bearer <token>` for the identity probe. Limit response bodies to 1 MiB, use a 20-second timeout, require manual redirects, and normalize `expiresAt` as `now() + expires_in * 1000`.

- [ ] **Step 5: Run focused and complete tests**

Run: `node --test bot/test/meli-oauth.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit the OAuth client**

```powershell
git add bot/meli-oauth.mjs bot/test/meli-oauth.test.mjs
git commit -m "feat: add Mercado Livre OAuth client"
```

### Task 4: OAuth HTTP handler

**Files:**
- Create: `bot/oauth-handler.mjs`
- Test: `bot/test/oauth-handler.test.mjs`

- [ ] **Step 1: Test the start route**

Call the handler with `GET /oauth/mercadolivre/start`. Assert status `302`, `Cache-Control: no-store`, and a location created with a newly issued state.

- [ ] **Step 2: Test callback validation**

Cover missing query parameters, `error` returned by the provider, invalid/reused state, and a valid callback. A valid callback must call `exchange(code)`, then `identity(accessToken)`, then `tokens.save(...)` with the verified user ID.

- [ ] **Step 3: Test output sanitization**

Assert that responses and captured logs contain neither the authorization code nor access/refresh tokens. The successful response may contain only `Autorização concluída. Você pode fechar esta janela.`

- [ ] **Step 4: Implement the focused handler**

```js
export function meliOAuthHandler({ states, oauth, tokens, logger = console }) {
  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/oauth/mercadolivre/start") { /* 302 */ }
    if (req.method === "GET" && url.pathname === "/oauth/mercadolivre/callback") { /* validate, exchange, probe, save */ }
    return false;
  };
}
```

Return `true` when a route was handled and `false` otherwise so the existing webhook handler remains independent. Use fixed error messages and `Cache-Control: no-store` on every OAuth response.

- [ ] **Step 5: Run focused and complete tests**

Run: `node --test bot/test/oauth-handler.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit the handler**

```powershell
git add bot/oauth-handler.mjs bot/test/oauth-handler.test.mjs
git commit -m "feat: expose secure OAuth callback routes"
```

### Task 5: Compose OAuth into the bot server

**Files:**
- Modify: `bot/server.mjs`
- Modify: `compose.yaml`
- Modify: `.env.example`
- Test: `bot/test/oauth-handler.test.mjs`

- [ ] **Step 1: Add a router composition test**

Export a `createRequestHandler` function from `server.mjs` (move `main()` invocation behind an entry-point check if required by tests). Assert OAuth routes are offered first and unhandled requests fall through to the existing Evolution webhook handler.

- [ ] **Step 2: Verify the composition test fails**

Run: `node --test bot/test/oauth-handler.test.mjs`

Expected: FAIL because `createRequestHandler` is not exported.

- [ ] **Step 3: Wire dependencies in `server.mjs`**

Require `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, and `MELI_REDIRECT_URI` only when `MELI_OAUTH_ENABLED=true`. Construct `OAuthStateStore`, `TokenStore`, `MeliOAuthClient`, and `meliOAuthHandler`, then compose it with `webhookHandler`. Keep startup failures sanitized.

- [ ] **Step 4: Add Compose configuration**

Add to the bot environment:

```yaml
MELI_OAUTH_ENABLED: ${MELI_OAUTH_ENABLED:-false}
MELI_CLIENT_ID: ${MELI_CLIENT_ID:-}
MELI_CLIENT_SECRET: ${MELI_CLIENT_SECRET:-}
MELI_REDIRECT_URI: ${MELI_REDIRECT_URI:-}
MELI_OAUTH_TOKEN_PATH: /run/secrets-write/meli-oauth.json
```

Replace the read-only `./secrets:/run/secrets:ro` mount with two narrowly scoped mounts: retain the legacy file as read-only only while the old client still exists, and add `./secrets:/run/secrets-write` as writable. Keep the container root filesystem read-only.

- [ ] **Step 5: Extend `.env.example`**

```dotenv
MELI_OAUTH_ENABLED=false
MELI_CLIENT_ID=
MELI_CLIENT_SECRET=
MELI_REDIRECT_URI=
```

- [ ] **Step 6: Run tests and validate Compose**

Run: `npm test && docker compose config --quiet`

Expected: tests PASS and Compose exits with code 0.

- [ ] **Step 7: Commit server and container wiring**

```powershell
git add bot/server.mjs bot/test/oauth-handler.test.mjs compose.yaml .env.example
git commit -m "feat: wire OAuth callback into bot container"
```

### Task 6: Automatic token refresh boundary

**Files:**
- Modify: `bot/meli-oauth.mjs`
- Modify: `bot/token-store.mjs`
- Test: `bot/test/meli-oauth.test.mjs`

- [ ] **Step 1: Test fresh-token reuse**

Add `authorizedToken({ tokens, skewMs = 60_000 })`. With `expiresAt > now + skewMs`, assert it returns the stored access token without calling `refresh`.

- [ ] **Step 2: Test rotation before returning**

For an expiring token, assert `refresh(oldRefreshToken)` is called, the complete new record is persisted, and only then is the new access token returned.

- [ ] **Step 3: Test failed refresh preservation**

Make refresh return an invalid record or make saving fail. Assert `authorizedToken` rejects with a fixed error and never returns either token. Assert the prior token record remains unchanged.

- [ ] **Step 4: Implement the refresh boundary**

```js
export async function authorizedToken({ oauth, tokens, now = Date.now, skewMs = 60_000 }) {
  const current = await tokens.load();
  if (!current) throw Error("oauth_authorization_required");
  if (current.expiresAt > now() + skewMs) return current.accessToken;
  const rotated = await oauth.refresh(current.refreshToken);
  await tokens.save(rotated);
  return rotated.accessToken;
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test bot/test/meli-oauth.test.mjs bot/test/token-store.test.mjs && npm test`

Expected: all tests PASS.

```powershell
git add bot/meli-oauth.mjs bot/token-store.mjs bot/test/meli-oauth.test.mjs bot/test/token-store.test.mjs
git commit -m "feat: rotate Mercado Livre OAuth tokens"
```

### Task 7: Cloudflare Quick Tunnel script

**Files:**
- Create: `scripts/start-meli-oauth-tunnel.ps1`
- Modify: `README.md`

- [ ] **Step 1: Implement strict preflight checks**

The script must use `Set-StrictMode -Version Latest`, stop on errors, verify `http://127.0.0.1:${BOT_PORT}/health`, and locate `cloudflared` using `Get-Command`. If absent, print the exact install command `winget install --id Cloudflare.cloudflared --exact` and exit without changing `.env`.

- [ ] **Step 2: Start and parse the tunnel safely**

Start `cloudflared tunnel --url http://127.0.0.1:$BotPort --no-autoupdate` with `Start-Process -WindowStyle Hidden`, redirect stdout/stderr to files under a new `New-Item` temporary directory, and poll for at most 30 seconds. Extract only a URL matching:

```powershell
'https://[a-z0-9-]+\.trycloudflare\.com'
```

Print the URL plus `/oauth/mercadolivre/callback`. Do not read, print, or rewrite `.env`.

- [ ] **Step 3: Document the exact workflow**

Add these ordered steps to `README.md`: start containers; run the tunnel script; copy the complete callback URI into the Mercado Livre application; set `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`, and `MELI_OAUTH_ENABLED=true` locally; recreate only the bot; open `/oauth/mercadolivre/start`; authorize; confirm `secrets/meli-oauth.json` exists without opening it.

State prominently that restarting Quick Tunnel changes the URL, cookies are not a fallback, and `DRY_RUN` remains true.

- [ ] **Step 4: Perform syntax and help checks**

Run:

```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path scripts/start-meli-oauth-tunnel.ps1), [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count) { $errors | Format-List; exit 1 }
Get-Help .\scripts\start-meli-oauth-tunnel.ps1
```

Expected: no parser errors and help text displays without secrets.

- [ ] **Step 5: Commit the operational tooling**

```powershell
git add scripts/start-meli-oauth-tunnel.ps1 README.md
git commit -m "docs: add temporary OAuth tunnel workflow"
```

### Task 8: Container and live authorization verification

**Files:**
- Create: `scripts/check-meli-oauth.mjs`
- Modify: `Dockerfile`
- Modify: `tests/compose.smoke.yaml`
- Modify: `tests/smoke.test.mjs`

- [ ] **Step 1: Run the complete automated verification**

Run: `npm test && docker compose config --quiet && docker compose up -d --build bot`

Expected: unit tests PASS, Compose validates, and `docker compose ps bot` reports healthy.

- [ ] **Step 2: Verify local routes without credentials in output**

Run: `Invoke-WebRequest http://127.0.0.1:3000/health -UseBasicParsing` and then open `http://127.0.0.1:3000/oauth/mercadolivre/start` in a browser.

Expected: health returns 200; start redirects to the official Mercado Livre authorization host.

- [ ] **Step 3: Start the tunnel and register the callback**

Run: `.\scripts\start-meli-oauth-tunnel.ps1`

Expected: one `https://*.trycloudflare.com/oauth/mercadolivre/callback` URI is displayed. Register that exact URI in the Mercado Livre developer portal and ensure it exactly matches `MELI_REDIRECT_URI`.

- [ ] **Step 4: Complete the user-controlled authorization**

Open the local `/oauth/mercadolivre/start` route, authorize in Mercado Livre, and wait for the fixed success message. Do not copy the browser callback URL, code, token file, Client Secret, or container environment into chat.

- [ ] **Step 5: Verify persistence and redaction**

Run:

```powershell
Test-Path .\secrets\meli-oauth.json
docker compose logs --no-color bot | Select-String -Pattern 'access_token|refresh_token|client_secret|code=' -CaseSensitive:$false
```

Expected: `Test-Path` returns `True`; the log scan returns no matches.

- [ ] **Step 6: Add and verify a sanitized identity command**

Create `scripts/check-meli-oauth.mjs` with this output contract:

```js
import { TokenStore } from "../bot/token-store.mjs";
import { MeliOAuthClient, authorizedToken } from "../bot/meli-oauth.mjs";

const env = process.env;
const tokens = new TokenStore(env.MELI_OAUTH_TOKEN_PATH);
const oauth = new MeliOAuthClient({
  clientId: env.MELI_CLIENT_ID,
  clientSecret: env.MELI_CLIENT_SECRET,
  redirectUri: env.MELI_REDIRECT_URI,
});
const accessToken = await authorizedToken({ oauth, tokens });
const identity = await oauth.identity(accessToken);
console.log(JSON.stringify({ authorized: true, userId: identity.id }));
```

Copy the `scripts` directory into the runtime image in `Dockerfile`, then run:

`docker compose exec -T bot node scripts/check-meli-oauth.mjs`

Expected: exactly one JSON object containing `authorized: true` and the authorized account ID, with no token or raw response.

- [ ] **Step 7: Probe affiliate compatibility in isolation**

With `DRY_RUN=true`, call the affiliate-link endpoint once using a known Mercado Livre product URL and the OAuth bearer token. Record only HTTP status, a fixed error category, and—on success—the validated `meli.la` URL. Do not automatically fall back to cookies if the endpoint rejects OAuth.

- [ ] **Step 8: Run final regression and safety checks**

Run: `npm test && docker compose ps && docker compose logs --no-color --tail 100 bot`

Expected: all tests PASS, services are healthy, `DRY_RUN=true` appears in the ready event, and no secret values appear in logs.

- [ ] **Step 9: Commit the diagnostic and smoke-test adjustments**

```powershell
git add scripts/check-meli-oauth.mjs Dockerfile tests/compose.smoke.yaml tests/smoke.test.mjs
git commit -m "test: verify OAuth container integration"
```

## Execution prerequisite

This directory is not currently a Git repository. Before executing the commit steps, initialize version control and create a baseline commit, or explicitly choose to run the plan without commits. Never add `.env`, `secrets/`, cookies, tokens, or callback authorization codes to Git.
