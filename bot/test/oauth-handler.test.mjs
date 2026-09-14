import test from "node:test";
import assert from "node:assert/strict";
import { meliOAuthHandler } from "../oauth-handler.mjs";
import { createRequestHandler } from "../http-router.mjs";

function response() {
  return { status: 0, headers: {}, body: "", writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body = "") { this.body = body; } };
}

test("OAuth start redirects with a fresh one-time state", async () => {
  const res = response();
  const handled = await meliOAuthHandler({ states: { issue: () => "fresh-state" }, oauth: { authorizationUrl: (state) => `https://auth.example/?state=${state}` }, tokens: {} })({ method: "GET", url: "/oauth/mercadolivre/start" }, res);
  assert.equal(handled, true);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "https://auth.example/?state=fresh-state");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("OAuth callback validates state, probes identity and saves tokens", async () => {
  const res = response();
  let saved;
  const tokens = { accessToken: "access-secret", refreshToken: "refresh-secret", expiresAt: 20_000, userId: 1 };
  const handled = await meliOAuthHandler({ states: { consume: (value) => value === "valid" }, oauth: { exchange: async () => tokens, identity: async () => ({ id: 42 }) }, tokens: { save: async (value) => { saved = value; } } })({ method: "GET", url: "/oauth/mercadolivre/callback?code=code-secret&state=valid" }, res);
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.deepEqual(saved, { ...tokens, userId: 42 });
  assert.equal(res.body, "Autorização concluída. Você pode fechar esta janela.");
  assert.doesNotMatch(res.body, /secret/);
});

test("OAuth callback rejects missing or reused state", async () => {
  for (const url of ["/oauth/mercadolivre/callback?code=x", "/oauth/mercadolivre/callback?code=x&state=reused"]) {
    const res = response();
    await meliOAuthHandler({ states: { consume: () => false }, oauth: {}, tokens: {} })({ method: "GET", url }, res);
    assert.equal(res.status, 400);
    assert.equal(res.headers["cache-control"], "no-store");
  }
});

test("returns false for routes it does not own", async () => {
  assert.equal(await meliOAuthHandler({ states: {}, oauth: {}, tokens: {} })({ method: "POST", url: "/webhooks/evolution" }, response()), false);
});

test("HTTP router offers OAuth first and falls through to webhook", async () => {
  const calls = [];
  const handler = createRequestHandler({ oauth: async () => { calls.push("oauth"); return false; }, site: async () => { calls.push("site"); return false; }, webhook: async () => { calls.push("webhook"); } });
  await handler({}, {});
  assert.deepEqual(calls, ["oauth", "site", "webhook"]);
});

test("HTTP router stops after the public site handles a request", async () => {
  const calls = [];
  const handler = createRequestHandler({ site: async () => { calls.push("site"); return true; }, webhook: async () => { calls.push("webhook"); } });
  await handler({}, {});
  assert.deepEqual(calls, ["site"]);
});
