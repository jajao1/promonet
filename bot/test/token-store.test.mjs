import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenStore } from "../token-store.mjs";

const valid = { accessToken: "access-value", refreshToken: "refresh-value", expiresAt: 20_000, userId: 174576489 };

test("round-trips a valid OAuth token record", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "promonet-oauth-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new TokenStore(join(dir, "tokens.json"));
  assert.equal(await store.load(), null);
  await store.save(valid);
  assert.deepEqual(await store.load(), valid);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "tokens.json"), "utf8")), valid);
});

test("rejects incomplete OAuth token records without revealing values", async () => {
  const store = new TokenStore("unused");
  await assert.rejects(() => store.save({ accessToken: "secret-value" }), (error) => {
    assert.equal(error.message, "oauth_tokens_invalid");
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});

test("keeps the previous record if atomic replacement fails", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "promonet-oauth-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "tokens.json");
  const store = new TokenStore(path);
  await store.save(valid);
  const failing = new TokenStore(path, { fs: { rename: async () => { throw Error("disk"); } } });
  await assert.rejects(() => failing.save({ ...valid, accessToken: "new-value" }), /oauth_token_store_failed/);
  assert.deepEqual(await store.load(), valid);
});
