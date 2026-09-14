# Mercado Livre Cookie Request Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely import a recent DevTools “Copy as PowerShell” request as an expiring Mercado Livre web session and validate one affiliate conversion without executing the copied text.

**Architecture:** A pure Node parser converts untrusted request text into a minimal validated session record. A local CLI writes that record atomically, while the existing `MeliClient` classifies authentication failure separately from malformed responses. A supervised probe reads the session and performs exactly one conversion with `DRY_RUN=true`; it never sends to WhatsApp.

**Tech Stack:** Node.js 24 ESM, Node test runner, built-in filesystem APIs, PowerShell wrapper, existing Mercado Livre client.

---

## File structure

- Create `bot/meli-request-import.mjs`: strict, non-executing parser and session validator.
- Create `bot/test/meli-request-import.test.mjs`: valid, ambiguous, and malicious input tests.
- Create `scripts/import-meli-request.mjs`: atomic local importer CLI.
- Modify `scripts/import-meli-session.ps1`: wrapper around the tested Node importer.
- Create `scripts/test-meli-session.mjs`: one-shot, sanitized affiliate conversion probe.
- Modify `bot/clients.mjs`: preserve `session_expired` classification for 401/403 and redirects.
- Modify `bot/test/clients.test.mjs`: status/error classification and session header tests.
- Modify `.gitignore` and `README.md`: raw capture exclusion and safe operating procedure.

### Task 1: Strict request-text parser

**Files:**
- Create: `bot/meli-request-import.mjs`
- Create: `bot/test/meli-request-import.test.mjs`

- [ ] **Step 1: Write failing tests for a valid copied request**

Build a fixture containing one `Invoke-WebRequest`, the exact `createLink` URL, `-Method POST`, a `WebRequestSession` with two `Cookie(...)` calls, `x-csrf-token`, `Origin`, `Referer`, and a JSON body. Assert:

```js
assert.deepEqual(parseMeliRequest(fixture, { now: () => new Date("2026-09-06T12:00:00Z") }), {
  version: 1,
  cookie: "ssid=session-value; _csrf=cookie-csrf",
  csrfToken: "header-csrf",
  origin: "https://www.mercadolivre.com.br",
  referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
  importedAt: "2026-09-06T12:00:00.000Z"
});
```

- [ ] **Step 2: Write rejection tests**

Assert fixed `request_import_invalid` errors for missing CSRF/cookie, GET method, non-Mercado-Livre host, wrong path, wrong origin, referer outside `/afiliados/`, two `Invoke-WebRequest` commands, `$()` or backtick command substitution, and a body without exactly one URL plus a non-empty tag.

- [ ] **Step 3: Run the tests and observe the missing module**

Run: `node --test bot/test/meli-request-import.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement the pure parser**

```js
export function parseMeliRequest(text, { now = () => new Date() } = {}) {
  // Reject executable substitutions and multiple web requests before extraction.
  // Require the exact HTTPS endpoint, POST method, trusted origin/referer, cookies,
  // CSRF header, and a parseable createLink body. Return only the normalized record.
}
```

Use bounded input of 512 KiB, regexes restricted to the known PowerShell serialization, `URL` for origin/referer checks, and `JSON.parse` for the decoded body. Never return the captured request body.

- [ ] **Step 5: Run focused and complete tests**

Run: `node --test bot/test/meli-request-import.test.mjs && npm test`

Expected: all tests PASS.

### Task 2: Atomic importer CLI

**Files:**
- Create: `scripts/import-meli-request.mjs`
- Create: `bot/test/meli-import-cli.test.mjs`
- Modify: `scripts/import-meli-session.ps1`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing atomic-write tests**

Import `importRequest({ requestPath, outputPath, removeSource, fs })`. Assert a valid fixture produces `meli-session.json` with mode `0o600`, uses `output.tmp` followed by `rename`, and returns only `{ imported: true, cookieCount }`. Stub `rename` to fail and assert the prior session file remains unchanged. Assert `removeSource=false` is the default.

- [ ] **Step 2: Verify failure before implementation**

Run: `node --test bot/test/meli-import-cli.test.mjs`

Expected: FAIL because `scripts/import-meli-request.mjs` does not exist.

- [ ] **Step 3: Implement the CLI and exported function**

```js
export async function importRequest({ requestPath, outputPath, removeSource = false, fs = defaultFs }) {}
```

Resolve both paths, reject identical paths, read no more than 512 KiB, call `parseMeliRequest`, write JSON to a sibling temporary file, rename atomically, optionally remove the source only after success, and emit fixed errors without request content.

- [ ] **Step 4: Replace the PowerShell parser with a safe wrapper**

`scripts/import-meli-session.ps1` must accept `-RequestPath`, optional `-OutputPath`, and `-RemoveSource`, then invoke only:

```powershell
node "$PSScriptRoot\import-meli-request.mjs" --request "$RequestPath" --output "$OutputPath" $(if ($RemoveSource) { '--remove-source' })
```

It must never read, regex, execute, or print the source content.

- [ ] **Step 5: Exclude raw and normalized secrets**

Add:

```gitignore
secrets/meli-request.ps1.txt
secrets/meli-session.json
secrets/meli-session.json.tmp
```

- [ ] **Step 6: Run tests and parse the wrapper**

Run `node --test bot/test/meli-import-cli.test.mjs && npm test`, then parse the PowerShell file with `[System.Management.Automation.Language.Parser]::ParseFile`.

Expected: all tests PASS and no PowerShell parser errors.

### Task 3: Authentication-expiry classification

**Files:**
- Modify: `bot/clients.mjs`
- Modify: `bot/test/clients.test.mjs`

- [ ] **Step 1: Write failing status-classification tests**

For `MeliClient.convert`, inject responses 401, 403, and 302. Assert all reject with exactly `session_expired`. Inject 429 and 500 and assert `remote_request_failed`. Assert fetch is called once in every case.

- [ ] **Step 2: Run the focused tests and confirm current generic errors**

Run: `node --test bot/test/clients.test.mjs`

Expected: new assertions FAIL because `jsonRequest` currently maps every status to `remote_request_failed`.

- [ ] **Step 3: Preserve fixed status categories**

Change `jsonRequest` to inspect status before consuming the body:

```js
if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) throw Error("session_expired");
if (!response.ok) throw Error("remote_request_failed");
```

In its catch block, rethrow only the fixed categories `session_expired` and `remote_request_failed`; map all other errors to `remote_request_failed`. Do not include status text, response bodies, URLs, cookies, or headers.

- [ ] **Step 4: Use the imported origin and referer**

Require normalized `session.origin` and `session.referer` in addition to cookie and CSRF, then use those exact validated values as headers. Update existing fixtures to include the trusted values.

- [ ] **Step 5: Run focused and complete tests**

Run: `node --test bot/test/clients.test.mjs && npm test`

Expected: all tests PASS.

### Task 4: Supervised one-shot probe

**Files:**
- Create: `scripts/test-meli-session.mjs`
- Create: `bot/test/meli-session-probe.test.mjs`

- [ ] **Step 1: Write failing parser/output tests**

Export `parseArguments(argv)` and `probe({ sessionPath, url, tag, fetch })`. Require exact `--url` and `--tag` arguments. Assert success returns only `{ valid: true, affiliateUrl }`; session expiry returns `{ valid: false, category: "session_expired" }`; all other failures return fixed categories without tokens or cookies.

- [ ] **Step 2: Verify the probe module is missing**

Run: `node --test bot/test/meli-session-probe.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the one-shot probe**

Read and validate the normalized session, construct `MeliClient`, call `convert(url, tag, false)` exactly once, and print one JSON object. Require `DRY_RUN=true` from `.env` before the executable entry point proceeds. Never initialize Evolution API or send a WhatsApp message.

- [ ] **Step 4: Run focused and complete tests**

Run: `node --test bot/test/meli-session-probe.test.mjs && npm test`

Expected: all tests PASS.

### Task 5: Safe live validation and documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document capture and import**

Document exact operator steps: open Edge DevTools Network; generate one successful link manually; select only the `createLink` request; choose Copy as PowerShell; save it as `secrets/meli-request.ps1.txt`; run the importer; never paste it into chat or execute it.

- [ ] **Step 2: Import without displaying secrets**

Run:

```powershell
.\scripts\import-meli-session.ps1 -RequestPath .\secrets\meli-request.ps1.txt
```

Expected: a sanitized success containing only the cookie count. Do not read `meli-session.json` to the console.

- [ ] **Step 3: Run one supervised conversion**

Run:

```powershell
node scripts/test-meli-session.mjs --url "https://www.mercadolivre.com.br/controle-joystick-sem-fio-sony-playstation-5-dualsense-midnight-black/p/MLB18010993" --tag "vijo3432338"
```

Expected: either one validated `https://meli.la/...` link or the fixed category `session_expired`. No WhatsApp message is sent.

- [ ] **Step 4: Verify regression and secret hygiene**

Run `npm test`, `docker compose config --quiet`, verify `DRY_RUN=true`, and scan bot logs for `cookie=`, `x-csrf-token`, and known token field names. Expected: all tests PASS, Compose exits 0, and log scan has zero matches.

## Execution prerequisite

The directory is not a Git repository, so worktree isolation and commits are unavailable. Execute only in the current workspace after explicit user selection. Never add `.env`, raw copied requests, cookies, CSRF values, browser profiles, OAuth tokens, or callback codes to version control.
