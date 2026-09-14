import test from "node:test";
import assert from "node:assert/strict";
import { MeliOAuthClient, authorizedToken } from "../meli-oauth.mjs";

const config = { clientId: "123", clientSecret: "client-secret", redirectUri: "https://example.trycloudflare.com/oauth/mercadolivre/callback", now: () => 1_000 };

test("builds the official Mercado Livre authorization URL", () => {
  const url = new URL(new MeliOAuthClient(config).authorizationUrl("state-value"));
  assert.equal(url.origin + url.pathname, "https://auth.mercadolivre.com.br/authorization");
  assert.deepEqual(Object.fromEntries(url.searchParams), { response_type: "code", client_id: "123", redirect_uri: config.redirectUri, state: "state-value" });
});

test("exchanges a code and normalizes rotating tokens", async () => {
  let request;
  const fetch = async (url, options) => {
    request = { url, ...options };
    return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600, user_id: 42 }));
  };
  const result = await new MeliOAuthClient({ ...config, fetch }).exchange("auth-code");
  assert.equal(request.url, "https://api.mercadolibre.com/oauth/token");
  assert.equal(request.method, "POST");
  assert.match(request.body, /grant_type=authorization_code/);
  assert.deepEqual(result, { accessToken: "access", refreshToken: "refresh", expiresAt: 3_601_000, userId: 42 });
});

test("refresh requires and returns a new refresh token", async () => {
  let body;
  const fetch = async (_url, options) => { body = options.body; return new Response(JSON.stringify({ access_token: "next", refresh_token: "next-refresh", expires_in: 10, user_id: 42 })); };
  const result = await new MeliOAuthClient({ ...config, fetch }).refresh("old-refresh");
  assert.match(body, /grant_type=refresh_token/);
  assert.match(body, /refresh_token=old-refresh/);
  assert.equal(result.refreshToken, "next-refresh");
});

test("remote failures expose only a fixed error", async () => {
  const oauth = new MeliOAuthClient({ ...config, fetch: async () => new Response("secret-response", { status: 401 }) });
  await assert.rejects(() => oauth.exchange("secret-code"), (error) => error.message === "oauth_remote_failed" && !error.message.includes("secret"));
});

test("authorizedToken reuses fresh tokens and rotates expiring tokens", async () => {
  let refreshes = 0;
  const fresh = { accessToken: "fresh", refreshToken: "r1", expiresAt: 100_000, userId: 42 };
  assert.equal(await authorizedToken({ oauth: { refresh: async () => { refreshes++; } }, tokens: { load: async () => fresh }, now: () => 1_000, skewMs: 1_000 }), "fresh");
  let saved;
  const rotated = { accessToken: "rotated", refreshToken: "r2", expiresAt: 200_000, userId: 42 };
  const value = await authorizedToken({ oauth: { refresh: async () => { refreshes++; return rotated; } }, tokens: { load: async () => ({ ...fresh, expiresAt: 1_500 }), save: async (record) => { saved = record; } }, now: () => 1_000, skewMs: 1_000 });
  assert.equal(value, "rotated");
  assert.deepEqual(saved, rotated);
  assert.equal(refreshes, 1);
});
