# PromoNET Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public offer storefront on the existing PromoNET backend and database with safe affiliate redirects and click tracking.

**Architecture:** Add a focused public-offers repository and HTTP handler to the existing Node service, then serve a buildless static frontend from a dedicated `site/` directory. The collector remains the writer; the public surface reads confirmed publications and records anonymous clicks.

**Tech Stack:** Node.js 24, native HTTP, PostgreSQL, HTML, CSS, browser JavaScript, Docker Compose, Node test runner.

---

### Task 1: Public offers repository

**Files:**
- Create: `bot/public-offers-store.mjs`
- Create: `bot/test/public-offers-store.test.mjs`

- [ ] Write a failing test using a recording database double that verifies schema initialization, parameterized published-offer listing, category aggregation, offer lookup, and click insertion.
- [ ] Run `node --test bot/test/public-offers-store.test.mjs` and confirm the missing-module failure.
- [ ] Implement `PublicOffersStore` with `init()`, `list()`, `categories()`, `findDestination()`, and `recordClick()`; clamp page size to 48 and never interpolate user input into SQL.
- [ ] Run the focused test and confirm it passes.

### Task 2: Public API and redirects

**Files:**
- Create: `bot/public-site-handler.mjs`
- Create: `bot/test/public-site-handler.test.mjs`
- Modify: `bot/http-router.mjs`
- Modify: `bot/server.mjs`

- [ ] Write failing handler tests for valid list/filter requests, invalid parameters, categories, safe 302 redirects, missing offers, unsafe destinations, and fixed database failures.
- [ ] Run `node --test bot/test/public-site-handler.test.mjs` and confirm failure because the handler is absent.
- [ ] Implement bounded query parsing, JSON responses, Mercado Livre destination validation, no-store redirects, and asynchronous click recording.
- [ ] Wire the handler before the webhook fallback and initialize its schema at startup.
- [ ] Run focused API and router tests and confirm they pass.

### Task 3: Storefront interface

**Files:**
- Create: `site/index.html`
- Create: `site/styles.css`
- Create: `site/app.js`
- Create: `site/favicon.svg`
- Create: `site/product-placeholder.svg`
- Create: `bot/test/site-assets.test.mjs`

- [ ] Write a failing asset test that requires semantic landmarks, affiliate disclosure, search and category controls, offer template, local favicon, local image fallback, and script/style references.
- [ ] Run `node --test bot/test/site-assets.test.mjs` and confirm failure because the assets do not exist.
- [ ] Build the approved trustworthy storefront with navy, orange, green, responsive grid, keyboard-visible focus, reduced-motion support, loading skeletons, empty state, and error retry.
- [ ] Implement debounced search, category chips, recent/discount sort, pagination, safe DOM text rendering, and navigation through internal redirect URLs.
- [ ] Run the asset test and confirm it passes.

### Task 4: Static asset serving

**Files:**
- Modify: `bot/public-site-handler.mjs`
- Modify: `bot/test/public-site-handler.test.mjs`
- Modify: `Dockerfile`

- [ ] Add failing tests for `/`, known immutable assets, missing assets, traversal attempts, content types, ETags, and SPA-safe 404 behavior.
- [ ] Run the focused tests and confirm the new assertions fail.
- [ ] Add an allowlisted static asset map with bounded reads and cache headers; copy `site/` into the runtime image.
- [ ] Run focused tests and confirm they pass.

### Task 5: End-to-end verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `compose.yaml` only if a new health or asset check is required.

- [ ] Document the public URL, API parameters, redirect behavior, disclosure, and deployment requirements.
- [ ] Run `npm test` and require zero failures.
- [ ] Run `docker compose config --quiet` and rebuild the bot image.
- [ ] Smoke-test `/health`, `/`, `/api/offers`, `/api/categories`, and one redirect without following it.
- [ ] Inspect desktop and mobile layouts in a browser, correct blocking visual or accessibility defects, and repeat the full tests after any correction.
