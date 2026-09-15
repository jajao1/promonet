import test from "node:test";
import assert from "node:assert/strict";
import { collectorWindow, nextCollectorDelay } from "../collector-schedule.mjs";

test("collector window maps UTC timestamps to São Paulo operating hours", () => {
  const cases = [
    ["2026-09-15T10:00:00Z", true],
    ["2026-09-16T01:59:59Z", true],
    ["2026-09-16T02:00:00Z", false],
    ["2026-09-16T09:59:59Z", false],
    ["2026-09-16T10:00:00Z", true],
  ];

  for (const [timestamp, expected] of cases) {
    assert.equal(collectorWindow(new Date(timestamp)), expected, timestamp);
  }
});

test("next delay uses the collection interval while the window is open", () => {
  assert.equal(
    nextCollectorDelay(new Date("2026-09-15T10:00:00Z"), 1_200_000),
    1_200_000,
  );
});

test("next delay reaches the next opening minute while the window is closed", () => {
  assert.equal(
    nextCollectorDelay(new Date("2026-09-16T02:00:00Z")),
    8 * 60 * 60 * 1_000,
  );
  assert.equal(
    nextCollectorDelay(new Date("2026-09-16T09:59:59Z")),
    1_000,
  );
});

test("collector window accepts an explicit time zone and hour range", () => {
  const options = { timeZone: "UTC", startHour: 9, endHour: 17 };

  assert.equal(collectorWindow(new Date("2026-09-15T08:59:59Z"), options), false);
  assert.equal(collectorWindow(new Date("2026-09-15T09:00:00Z"), options), true);
  assert.equal(collectorWindow(new Date("2026-09-15T16:59:59Z"), options), true);
  assert.equal(collectorWindow(new Date("2026-09-15T17:00:00Z"), options), false);
});
