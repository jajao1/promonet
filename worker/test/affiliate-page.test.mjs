import test from "node:test";
import assert from "node:assert/strict";
import { AffiliatePage } from "../affiliate-page.mjs";

function locator({ count = 0, text = "", calls, name }) {
  return { count: async () => count, fill: async (value) => calls.push(["fill", name, value]), click: async () => calls.push(["click", name]), textContent: async () => text, selectOption: async (value) => calls.push(["select", name, value]), waitFor: async () => {} };
}
function fakePage({ captcha = false, login = false, result = "https://meli.la/AbC123" } = {}) {
  const calls = [];
  const page = {
    calls,
    setDefaultTimeout: (value) => calls.push(["timeout", value]),
    goto: async (url) => calls.push(["goto", url]),
    getByText: (value) => locator({ count: value instanceof RegExp && value.test("captcha") && captcha ? 1 : value instanceof RegExp && value.test(result) ? 1 : 0, text: result, calls, name: String(value) }),
    getByRole: (role, options = {}) => locator({ count: role === "button" && /gerar/i.test(String(options.name)) ? 1 : login && role === "button" && /entrar/i.test(String(options.name)) ? 1 : 0, calls, name: `${role}:${options.name}` }),
    getByLabel: (value) => locator({ count: 1, calls, name: String(value) }),
  };
  return page;
}

test("generates through semantic controls", async () => {
  const page = fakePage();
  const adapter = new AffiliatePage(page, { generatorUrl: "https://www.mercadolivre.com.br/afiliados/linkbuilder" });
  assert.equal(await adapter.generate({ url: "https://produto.mercadolivre.com.br/MLB-1234567890-item", tag: "vijo3432338" }), "https://meli.la/AbC123");
  assert.ok(page.calls.some(([name]) => name === "fill"));
  assert.ok(page.calls.some(([name]) => name === "click"));
  assert.ok(!page.calls.some(([name]) => name === "locator"));
});

test("pauses on captcha and login", async () => {
  await assert.rejects(() => new AffiliatePage(fakePage({ captcha: true }), { generatorUrl: "https://www.mercadolivre.com.br/afiliados/linkbuilder" }).generate({ url: "x", tag: "x" }), /captcha_required/);
  await assert.rejects(() => new AffiliatePage(fakePage({ login: true }), { generatorUrl: "https://www.mercadolivre.com.br/afiliados/linkbuilder" }).generate({ url: "x", tag: "x" }), /authentication_required/);
});

test("maps a missing generator control to ui_changed", async () => {
  const page = fakePage();
  page.getByLabel = () => locator({ count: 0, calls: page.calls, name: "missing" });
  await assert.rejects(() => new AffiliatePage(page, { generatorUrl: "https://www.mercadolivre.com.br/afiliados/linkbuilder" }).generate({ url: "x", tag: "x" }), /ui_changed/);
});
