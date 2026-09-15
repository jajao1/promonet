import test from "node:test";
import assert from "node:assert/strict";
import { runCollectorLoop } from "../collector-runtime.mjs";

const openTime = new Date("2026-09-15T10:00:00Z");

test("disabled collector performs no work", async () => {
  let calls = 0;
  const waits = [];

  await runCollectorLoop({
    enabled: false,
    collect: async () => calls++,
    delay: async ms => waits.push(ms),
    now: () => openTime,
    iterations: 1,
  });

  assert.equal(calls, 0);
  assert.deepEqual(waits, []);
});

test("successful collection waits for the configured interval", async () => {
  let calls = 0;
  const waits = [];

  await runCollectorLoop({
    enabled: true,
    collect: async () => calls++,
    delay: async ms => waits.push(ms),
    now: () => openTime,
    intervalMs: 1_200_000,
    iterations: 1,
  });

  assert.equal(calls, 1);
  assert.deepEqual(waits, [1_200_000]);
});

test("collector failure uses fixed event and thirty-second backoff", async () => {
  const waits = [];
  const logs = [];

  await runCollectorLoop({
    enabled: true,
    collect: async () => { throw Error("secret"); },
    delay: async ms => waits.push(ms),
    log: value => logs.push(value),
    now: () => openTime,
    iterations: 1,
  });

  assert.deepEqual(waits, [30_000]);
  assert.deepEqual(logs, ['{"event":"collector_unavailable"}']);
});

test("closed collector waits until opening without collecting", async () => {
  let calls = 0;
  const waits = [];

  await runCollectorLoop({
    enabled: true,
    collect: async () => calls++,
    delay: async ms => waits.push(ms),
    now: () => new Date("2026-09-16T02:00:00Z"),
    iterations: 1,
  });

  assert.equal(calls, 0);
  assert.deepEqual(waits, [8 * 60 * 60 * 1_000]);
});

test("collector reopens once without replaying missed runs", async () => {
  let calls = 0;
  const waits = [];
  let currentTime = new Date("2026-09-16T09:59:59Z");

  await runCollectorLoop({
    enabled: true,
    collect: async () => calls++,
    delay: async ms => {
      waits.push(ms);
      currentTime = new Date(currentTime.getTime() + ms);
    },
    now: () => currentTime,
    intervalMs: 1_200_000,
    iterations: 2,
  });

  assert.equal(calls, 1);
  assert.deepEqual(waits, [1_000, 1_200_000]);
});

test("successful collection schedules from the time it finishes", async () => {
  let currentTime = new Date("2026-09-16T01:59:59Z");
  const waits = [];

  await runCollectorLoop({
    enabled: true,
    collect: async () => {
      currentTime = new Date("2026-09-16T02:00:00Z");
    },
    delay: async ms => waits.push(ms),
    now: () => currentTime,
    iterations: 1,
  });

  assert.deepEqual(waits, [8 * 60 * 60 * 1_000]);
});
