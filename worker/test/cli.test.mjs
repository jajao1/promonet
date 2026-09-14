import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand, browserSettings } from "../cli.mjs";

test("parses supported worker commands", () => {
  assert.deepEqual(parseCommand(["run"]), { name: "run" });
  assert.deepEqual(parseCommand(["enqueue", "manual-1", "https://meli.la/Source1"]), { name: "enqueue", sourceId: "manual-1", url: "https://meli.la/Source1" });
  assert.deepEqual(parseCommand(["confirm", "12"]), { name: "confirm", id: 12 });
  assert.deepEqual(parseCommand(["reject", "13"]), { name: "reject", id: 13 });
  assert.deepEqual(parseCommand(["status"]), { name: "status" });
});

test("rejects unknown commands and invalid identifiers", () => {
  for (const args of [[], ["unknown"], ["confirm", "x"], ["enqueue", "only-id"]]) assert.throws(() => parseCommand(args), /invalid_command/);
});

test("uses Edge with an isolated persistent profile", () => {
  const settings = browserSettings({ PLAYWRIGHT_CHANNEL: "msedge", PLAYWRIGHT_PROFILE_PATH: "./secrets/edge-profile" });
  assert.equal(settings.channel, "msedge");
  assert.match(settings.profile, /secrets[\\/]edge-profile$/);
  assert.equal(settings.headless, false);
});
