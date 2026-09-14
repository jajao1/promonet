# PowerShell Affiliate Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Mercado Livre affiliate conversion through a constrained Windows PowerShell service while the bot remains containerized.

**Architecture:** A loopback-only PowerShell HTTP listener reconstructs the fixed Mercado Livre request from normalized session data. `MeliBridgeClient` calls it through `host.docker.internal` using a shared bearer secret; direct Meli mode remains available only when bridge configuration is absent.

**Tech Stack:** PowerShell 7, Node.js 24, Docker Compose, node:test.

---

### Task 1: Bridge client

**Files:** Modify `bot/clients.mjs`; test `bot/test/clients.test.mjs`.

- [ ] Add failing tests for bearer authentication, response validation, fixed errors and one request only.
- [ ] Run `node --test bot/test/clients.test.mjs` and confirm failure.
- [ ] Implement `MeliBridgeClient.convert(url, tag, createTag)` with bounded JSON and no retry.
- [ ] Run the focused tests and confirm success.

### Task 2: Windows bridge

**Files:** Create `scripts/meli-bridge.ps1`; create `scripts/start-meli-bridge.ps1`.

- [ ] Implement a loopback `HttpListener` accepting only authenticated `POST /convert` requests up to 16 KiB.
- [ ] Validate Mercado Livre URL/tag, load normalized session, and make one fixed `Invoke-WebRequest` call with redirects disabled.
- [ ] Validate the exact success schema and `https://meli.la` result; return only fixed error categories.
- [ ] Add a launcher that obtains bridge configuration from `.env` without printing secrets.

### Task 3: Runtime and container wiring

**Files:** Modify `bot/server.mjs`, `compose.yaml`, `.env.example`, `README.md`.

- [ ] Select `MeliBridgeClient` when `MELI_BRIDGE_URL` and `MELI_BRIDGE_KEY` are set.
- [ ] Configure the bot with `http://host.docker.internal:3210`, host gateway mapping and required key.
- [ ] Document starting the host bridge before enabling live mode.
- [ ] Run `npm test` and `docker compose config`; expect all tests and configuration validation to pass.
