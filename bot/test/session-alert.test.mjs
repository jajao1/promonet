import test from "node:test";
import assert from "node:assert/strict";
import { SessionAlert } from "../session-alert.mjs";

class PersistentIncidents {
  constructor() {
    this.active = false;
    this.notified = false;
    this.claimUntil = null;
    this.now = 0;
    this.failNextMark = false;
    this.failNextResolve = false;
    this.begun = [];
    this.marked = [];
    this.resolved = [];
  }

  async beginIncident(key) {
    this.begun.push(key);
    if (this.active && (this.notified || this.claimUntil > this.now)) return false;
    this.active = true;
    this.notified = false;
    this.claimUntil = this.now + 300;
    return true;
  }

  async markIncidentNotified(key) {
    this.marked.push(key);
    if (this.failNextMark) {
      this.failNextMark = false;
      throw Error("incident_acknowledgement_failed");
    }
    this.notified = true;
    this.claimUntil = null;
  }

  async resolveIncident(key) {
    this.resolved.push(key);
    if (this.failNextResolve) {
      this.failNextResolve = false;
      throw Error("incident_cleanup_failed");
    }
    this.active = false;
    this.claimUntil = null;
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
  assert.deepEqual(incidents.marked, ["meli_session", "meli_session"]);
  assert.deepEqual(incidents.resolved, ["meli_session"]);
});

test("concurrent required calls claim one incident and send once", async () => {
  const incidents = new PersistentIncidents();
  const sends = [];
  const alert = createAlert({ incidents, send: async (job) => sends.push(job) }).alert;

  assert.deepEqual(await Promise.all([alert.required(), alert.required()]), [true, false]);
  assert.equal(sends.length, 1);
  assert.deepEqual(incidents.marked, ["meli_session"]);
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
  assert.deepEqual(incidents.marked, ["meli_session"]);
});

test("a failed cleanup remains retryable after the unacknowledged claim lease", async () => {
  const incidents = new PersistentIncidents();
  incidents.failNextResolve = true;
  const sendError = Error("evolution_send_failed");
  let attempts = 0;
  const alert = createAlert({
    incidents,
    send: async () => {
      attempts++;
      if (attempts === 1) throw sendError;
    },
  }).alert;

  await assert.rejects(alert.required(), (error) => error === sendError);
  assert.equal(await alert.required(), false);
  incidents.now = incidents.claimUntil + 1;
  assert.equal(await alert.required(), true);
  assert.equal(attempts, 2);
  assert.deepEqual(incidents.marked, ["meli_session"]);
});

test("an acknowledgement persistence failure preserves the claim lease", async () => {
  const incidents = new PersistentIncidents();
  incidents.failNextMark = true;
  const sends = [];
  const alert = createAlert({ incidents, send: async (job) => sends.push(job) }).alert;

  await assert.rejects(alert.required(), /incident_acknowledgement_failed/);
  assert.deepEqual(incidents.resolved, []);
  assert.equal(await alert.required(), false);
  incidents.now = incidents.claimUntil + 1;
  assert.equal(await alert.required(), true);
  assert.equal(sends.length, 2);
});

test("restored awaits the idempotent persistent resolution", async () => {
  let release;
  const resolution = new Promise((resolve) => { release = resolve; });
  let finished = false;
  const incidents = {
    beginIncident: async () => true,
    markIncidentNotified: async () => {},
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
  for (const incidents of [
    undefined,
    {},
    { beginIncident: async () => true, resolveIncident: async () => {} },
    { beginIncident: async () => true, markIncidentNotified: async () => {} },
    { markIncidentNotified: async () => {}, resolveIncident: async () => {} },
  ]) {
    assert.throws(
      () => new SessionAlert({ destination, evolution: validEvolution, incidents }),
      /session_incidents_invalid/,
    );
  }
});
