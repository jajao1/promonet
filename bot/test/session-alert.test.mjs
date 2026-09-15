import test from "node:test";
import assert from "node:assert/strict";
import { SessionAlert } from "../session-alert.mjs";

class PersistentIncidents {
  constructor() {
    this.active = false;
    this.notified = false;
    this.claimUntil = null;
    this.claimToken = null;
    this.now = 0;
    this.failNextMark = false;
    this.failNextAbandon = false;
    this.begun = [];
    this.marked = [];
    this.abandoned = [];
    this.resolved = [];
  }

  async beginIncident(key, claimToken) {
    this.begun.push({ key, claimToken });
    if (this.active && (this.notified || this.claimUntil > this.now)) return null;
    this.active = true;
    this.notified = false;
    this.claimUntil = this.now + 300;
    this.claimToken = claimToken;
    return claimToken;
  }

  async markIncidentNotified(key, claimToken) {
    this.marked.push({ key, claimToken });
    if (this.failNextMark) {
      this.failNextMark = false;
      throw Error("incident_acknowledgement_failed");
    }
    if (!this.active || this.claimToken !== claimToken) return false;
    this.notified = true;
    this.claimUntil = null;
    this.claimToken = null;
    return true;
  }

  async abandonIncident(key, claimToken) {
    this.abandoned.push({ key, claimToken });
    if (this.failNextAbandon) {
      this.failNextAbandon = false;
      throw Error("incident_cleanup_failed");
    }
    if (!this.active || this.claimToken !== claimToken) return false;
    this.active = false;
    this.claimUntil = null;
    this.claimToken = null;
    return true;
  }

  async resolveIncident(key) {
    this.resolved.push(key);
    this.active = false;
    this.claimUntil = null;
    this.claimToken = null;
  }
}

const destination = "5543991724961";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  assert.deepEqual(incidents.begun.map(({ key }) => key), ["meli_session", "meli_session", "meli_session"]);
  assert.ok(incidents.begun.every(({ claimToken }) => uuid.test(claimToken)));
  assert.equal(new Set(incidents.begun.map(({ claimToken }) => claimToken)).size, 3);
  assert.deepEqual(incidents.marked, [incidents.begun[0], incidents.begun[2]]);
  assert.deepEqual(incidents.resolved, ["meli_session"]);
});

test("concurrent required calls claim one incident and send once", async () => {
  const incidents = new PersistentIncidents();
  const sends = [];
  const alert = createAlert({ incidents, send: async (job) => sends.push(job) }).alert;

  assert.deepEqual(await Promise.all([alert.required(), alert.required()]), [true, false]);
  assert.equal(sends.length, 1);
  assert.deepEqual(incidents.marked, [incidents.begun[0]]);
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
  assert.deepEqual(incidents.abandoned, [incidents.begun[0]]);
  assert.deepEqual(incidents.resolved, []);
  assert.equal(await alert.required(), true);
  assert.equal(attempts, 2);
  assert.deepEqual(incidents.marked, [incidents.begun[1]]);
});

test("a failed cleanup remains retryable after the unacknowledged claim lease", async () => {
  const incidents = new PersistentIncidents();
  incidents.failNextAbandon = true;
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
  assert.deepEqual(incidents.marked, [incidents.begun[2]]);
});

test("an acknowledgement persistence failure preserves the claim lease", async () => {
  const incidents = new PersistentIncidents();
  incidents.failNextMark = true;
  const sends = [];
  const alert = createAlert({ incidents, send: async (job) => sends.push(job) }).alert;

  await assert.rejects(alert.required(), /incident_acknowledgement_failed/);
  assert.deepEqual(incidents.abandoned, []);
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
    beginIncident: async (_key, claimToken) => claimToken,
    markIncidentNotified: async () => {},
    abandonIncident: async () => {},
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
    { beginIncident: async () => true, markIncidentNotified: async () => {}, resolveIncident: async () => {} },
    { beginIncident: async () => true, abandonIncident: async () => {}, resolveIncident: async () => {} },
    { markIncidentNotified: async () => {}, abandonIncident: async () => {}, resolveIncident: async () => {} },
    { beginIncident: async () => true, markIncidentNotified: async () => {}, abandonIncident: async () => {} },
  ]) {
    assert.throws(
      () => new SessionAlert({ destination, evolution: validEvolution, incidents }),
      /session_incidents_invalid/,
    );
  }
});
