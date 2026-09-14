import test from "node:test";
import assert from "node:assert/strict";
import { OAuthStateStore } from "../oauth-state.mjs";

test("consumes a valid OAuth state exactly once", () => {
  const states = new OAuthStateStore({ now: () => 1_000, ttlMs: 60_000 });
  const state = states.issue();
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(states.consume(state), true);
  assert.equal(states.consume(state), false);
});

test("rejects expired and unknown OAuth states", () => {
  let now = 1_000;
  const states = new OAuthStateStore({ now: () => now, ttlMs: 100 });
  const state = states.issue();
  now = 1_101;
  assert.equal(states.consume(state), false);
  assert.equal(states.consume("unknown"), false);
});
