import test from "node:test";
import assert from "node:assert/strict";
import { SessionAlert } from "../session-alert.mjs";

class PersistentIncidents {
  constructor() {
    this.active = new Set();
    this.begun = [];
    this.resolved = [];
  }

  async beginIncident(key) {
    this.begun.push(key);
    if (this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }

  async resolveIncident(key) {
    this.resolved.push(key);
    this.active.delete(key);
  }
}

const destination = "5543991724961";

function createAlert({ incidents = new PersistentIncidents(), send = async () => {} } = {}) {
  return {
    alert: new SessionAlert({ destination, evolution: { send }, incidents }),
    incidents,
  };
}

test("two alert instances notify the configured WhatsApp once per persisted incident", async () => {
  const incidents = new PersistentIncidents();
  const sends = [];
  const send = async (job) => sends.push(job);
  const first = createAlert({ incidents, send }).alert;
  const second = createAlert({ incidents, send }).alert;

  assert.equal(await first.required(), true);
  assert.equal(await second.required(), false);
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0], { destination, kind: "text", text: sends[0].text });
  assert.match(sends[0].text, /sessão.*Mercado Livre.*nova requisição.*createLink/is);
  assert.match(sends[0].text, /publicações.*pausadas/is);
  assert.doesNotMatch(sends[0].text, /token|api.?key|cookie\s*[=:]|secret/i);

  await first.restored();
  assert.equal(await second.required(), true);
  assert.equal(sends.length, 2);
  assert.deepEqual(incidents.begun, ["meli_session", "meli_session", "meli_session"]);
  assert.deepEqual(incidents.resolved, ["meli_session"]);
});

test("concurrent required calls claim one incident and send once", async () => {
  const incidents = new PersistentIncidents();
  const sends = [];
  const alert = createAlert({ incidents, send: async (job) => sends.push(job) }).alert;

  assert.deepEqual(await Promise.all([alert.required(), alert.required()]), [true, false]);
  assert.equal(sends.length, 1);
});

test("a failed notification releases the incident and rethrows the original send error without logging", async () => {
  const incidents = new PersistentIncidents();
  const sendError = Error("evolution_send_failed");
  const logged = [];
  const originalLog = console.log;
  const originalError = console.error;
  let attempts = 0;
  const alert = createAlert({
    incidents,
    send: async () => {
      attempts++;
      if (attempts === 1) throw sendError;
    },
  }).alert;

  console.log = (...args) => logged.push(args);
  console.error = (...args) => logged.push(args);
  try {
    await assert.rejects(alert.required(), (error) => {
      assert.equal(error, sendError);
      assert.equal(error.message, "evolution_send_failed");
      return true;
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.deepEqual(logged, []);
  assert.deepEqual(incidents.resolved, ["meli_session"]);
  assert.equal(await alert.required(), true);
  assert.equal(attempts, 2);
});

test("restored awaits the idempotent persistent resolution", async () => {
  let release;
  const resolution = new Promise((resolve) => { release = resolve; });
  let finished = false;
  const incidents = {
    beginIncident: async () => true,
    resolveIncident: async (key) => {
      assert.equal(key, "meli_session");
      await resolution;
      finished = true;
    },
  };
  const alert = createAlert({ incidents }).alert;

  const restoring = alert.restored();
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await restoring;
  assert.equal(finished, true);
  await alert.restored();
});

test("rejects invalid dependencies and administrative destination", () => {
  const validIncidents = new PersistentIncidents();
  const validEvolution = { send: async () => {} };
  assert.throws(
    () => new SessionAlert({ destination: "43 9999", evolution: validEvolution, incidents: validIncidents }),
    /admin_whatsapp_invalid/,
  );
  for (const evolution of [undefined, {}, { send: true }]) {
    assert.throws(
      () => new SessionAlert({ destination, evolution, incidents: validIncidents }),
      /admin_whatsapp_notifier_invalid/,
    );
  }
  for (const incidents of [undefined, {}, { beginIncident: async () => true }, { resolveIncident: async () => {} }]) {
    assert.throws(
      () => new SessionAlert({ destination, evolution: validEvolution, incidents }),
      /session_incidents_invalid/,
    );
  }
});
