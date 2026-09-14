import test from "node:test";
import assert from "node:assert/strict";
import { SessionAlert } from "../session-alert.mjs";

test("notifies the configured WhatsApp once until the session is restored", async () => {
  const sends = [];
  const alert = new SessionAlert({
    destination: "5543991724961",
    evolution: { send: async (job) => sends.push(job) },
  });
  assert.equal(await alert.required(), true);
  assert.equal(await alert.required(), false);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].destination, "5543991724961");
  assert.equal(sends[0].kind, "text");
  assert.match(sends[0].text, /sessão.*Mercado Livre.*nova requisição.*createLink/is);
  alert.restored();
  assert.equal(await alert.required(), true);
  assert.equal(sends.length, 2);
});

test("rejects an invalid administrative WhatsApp destination", () => {
  assert.throws(() => new SessionAlert({ destination: "43 9999", evolution: {} }), /admin_whatsapp_invalid/);
});
