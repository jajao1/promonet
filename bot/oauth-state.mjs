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
