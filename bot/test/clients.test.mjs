import test from "node:test";
import assert from "node:assert/strict";
const mod = await import("../clients.mjs").catch(() => ({}));
const session = { cookie: "s", csrfToken: "c", origin: "https://www.mercadolivre.com.br", referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder" };
test("clients exist", () => assert.equal(typeof mod.MeliClient, "function"));
test("bridge authenticates one conversion and validates its affiliate URL", async () => {
  let calls = 0;
  const bridge = new mod.MeliBridgeClient({ url: "http://host:3210/", key: "bridge-secret", fetch: async (url, options) => {
    calls++;
    assert.equal(url, "http://host:3210/convert");
    assert.equal(options.headers.authorization, "Bearer bridge-secret");
    assert.deepEqual(JSON.parse(options.body), { url: "https://produto.mercadolivre.com.br/MLB-1234567890-item", tag: "tag" });
    return Response.json({ valid: true, affiliateUrl: "https://meli.la/result" });
  }});
  assert.equal(await bridge.convert("https://produto.mercadolivre.com.br/MLB-1234567890-item", "tag", false), "https://meli.la/result");
  assert.equal(calls, 1);
  await assert.rejects(() => bridge.convert("https://meli.la/original", "tag", true), /tag_creation_not_supported/);
});
test("bridge delegates an existing meli.la affiliate link for PowerShell resolution", async () => {
  const calls = [];
  const bridge = new mod.MeliBridgeClient({ url: "http://host:3210", key: "bridge-secret", fetch: async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    assert.deepEqual(JSON.parse(options.body), { url: "https://meli.la/other-affiliate", tag: "tag" });
    return Response.json({ valid: true, affiliateUrl: "https://meli.la/my-link" });
  }});
  assert.equal(await bridge.convert("https://meli.la/other-affiliate", "tag", false), "https://meli.la/my-link");
  assert.deepEqual(calls.map((call) => call.method), ["POST"]);
});
test("bridge distinguishes its bearer authorization from browser session expiry", async () => {
  for (const { category, expected } of [
    { category: "unauthorized", expected: "meli_bridge_unauthorized" },
    { category: "session_expired", expected: "session_expired" },
  ]) {
    const bridge = new mod.MeliBridgeClient({
      url: "http://host:3210",
      key: "bridge-secret",
      fetch: async () => Response.json(
        { valid: false, category, detail: "cookie=do-not-leak" },
        { status: 401 },
      ),
    });
    await assert.rejects(
      () => bridge.convert("https://produto.mercadolivre.com.br/MLB-1234567890-item", "tag", false),
      (error) => error?.message === expected && !error.message.includes("do-not-leak"),
    );
  }
});
test("bridge maps only allowlisted configuration and remote categories to fixed codes", async () => {
  for (const { category, status, expected } of [
    { category: "configuration", status: 500, expected: "meli_bridge_configuration" },
    { category: "remote", status: 502, expected: "meli_bridge_remote" },
  ]) {
    const bridge = new mod.MeliBridgeClient({
      url: "http://host:3210",
      key: "bridge-secret",
      fetch: async () => Response.json({ valid: false, category }, { status }),
    });
    await assert.rejects(
      () => bridge.convert("https://produto.mercadolivre.com.br/MLB-1234567890-item", "tag", false),
      (error) => error?.message === expected,
    );
  }
});
test("affiliate permits fragment removal but requires correct tag and query", async () => {
  for (const [origin, tag, success] of [
    ["https://www.mercadolivre.com.br/p/1?variation=2", "tech", true],
    ["https://www.mercadolivre.com.br/p/1?variation=3", "tech", false],
    ["https://www.mercadolivre.com.br/p/1?variation=2", "wrong", false],
  ]) {
    const c = new mod.MeliClient({
      session,
      fetch: async () =>
        Response.json({
          status: 200,
          total_success: 1,
          total_error: 0,
          urls: [
            {
              origin_url: origin,
              tag,
              created: true,
              short_url: "https://meli.la/ok",
            },
          ],
        }),
    });
    const promise = c.convert(
      "https://www.mercadolivre.com.br/p/1?variation=2#foo",
      "tech",
      false,
    );
    if (success) assert.equal(await promise, "https://meli.la/ok");
    else await assert.rejects(() => promise);
  }
});
test("Evolution receives full bounded image download envelope", async () => {
  const imageMessage = {
    url: "https://mmg.whatsapp.net/image",
    mediaKey: "abc",
    mimetype: "image/jpeg",
  };
  const c = new mod.EvolutionClient({
    url: "http://evolution",
    instance: "main",
    apiKey: "s",
    fetch: async (url, options) => {
      assert.deepEqual(JSON.parse(options.body).message, {
        key: { id: "1" },
        message: { imageMessage },
      });
      return Response.json({ base64: "YWJj" });
    },
  });
  assert.equal(await c.media({ key: { id: "1" }, imageMessage }), "YWJj");
});
test("tag intent persisted before POST and unknown response blocks link", async () => {
  let intended = false;
  let called = 0;
  const c = new mod.MeliClient({
    session,
    tags: {
      begin: async () => {
        intended = true;
        return "new";
      },
      confirm: async () => assert.fail(),
    },
    fetch: async (url) => {
      assert.equal(intended, true);
      assert.match(url, /createTag$/);
      called++;
      return Response.json({ unknown: true });
    },
  });
  await assert.rejects(() => c.convert("https://meli.la/a", "tech", true));
  assert.equal(called, 1);
});
test("affiliate validates schema and preserves original query", async () => {
  let body;
  const client = new mod.MeliClient({
    session: { ...session, cookie: "secret", csrfToken: "csrf" },
    fetch: async (url, options) => {
      body = JSON.parse(options.body);
      return Response.json({
        status: 200,
        urls: [
          {
            short_url: "https://meli.la/ok",
            origin_url: body.urls[0],
            tag: body.tag,
            created: true,
          },
        ],
        total_success: 1,
        total_error: 0,
      });
    },
  });
  assert.equal(
    await client.convert(
      "https://www.mercadolivre.com.br/p/1?variation=2",
      "tech",
      false,
    ),
    "https://meli.la/ok",
  );
  assert.equal(body.urls[0], "https://www.mercadolivre.com.br/p/1?variation=2");
});
test("affiliate blocks redirects, error schemas and unknown tag schema", async () => {
  for (const response of [
    new Response("", {
      status: 302,
      headers: { location: "http://localhost" },
    }),
    Response.json({ status: 200, urls: [] }),
    Response.json({ error: "secret" }),
  ]) {
    const c = new mod.MeliClient({
      session,
      fetch: async () => response,
    });
    await assert.rejects(() => c.convert("https://meli.la/a", "t", false));
  }
  const c = new mod.MeliClient({
    session,
    fetch: async () => Response.json({ arbitrary: true }),
  });
  await assert.rejects(() => c.convert("https://meli.la/a", "t", true));
});
test("affiliate classifies redirects and authorization failures as expired without retry", async () => {
  for (const status of [301, 302, 401, 403]) {
    let calls = 0;
    const c = new mod.MeliClient({ session, fetch: async () => { calls++; return new Response("", { status }); } });
    await assert.rejects(() => c.convert("https://meli.la/a", "t", false), /session_expired/);
    assert.equal(calls, 1);
  }
});
test("affiliate forwards only imported browser-context headers", async () => {
  let sent;
  const c = new mod.MeliClient({
    session: { ...session, browserHeaders: { "accept-language": "pt-BR", "sec-fetch-site": "same-origin" } },
    fetch: async (_url, options) => {
      sent = options.headers;
      return Response.json({ status: 200, total_success: 1, total_error: 0, urls: [{ origin_url: "https://meli.la/a", tag: "t", created: true, short_url: "https://meli.la/ok" }] });
    },
  });
  await c.convert("https://meli.la/a", "t", false);
  assert.equal(sent["accept-language"], "pt-BR");
  assert.equal(sent["sec-fetch-site"], "same-origin");
});
test("Evolution sends text and validates acknowledgement", async () => {
  let call;
  const c = new mod.EvolutionClient({
    url: "http://evolution:8080",
    apiKey: "secret",
    instance: "main",
    fetch: async (url, options) => {
      call = { url, body: JSON.parse(options.body) };
      return Response.json({ key: { id: "sent" } });
    },
  });
  await c.send({ destination: "d@g.us", text: "hi", kind: "text" });
  assert.equal(call.body.number, "d@g.us");
  assert.equal(call.body.text, "hi");
  assert.match(call.url, /sendText\/main$/);
});

test("Evolution accepts a canonical bounded JPEG base64 envelope and returns its acknowledgement", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  let body;
  const client = new mod.EvolutionClient({
    url: "http://evolution:8080",
    apiKey: "secret",
    instance: "main",
    fetch: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({ key: { id: "sent-image" } });
    },
  });
  assert.deepEqual(await client.send({
    destination: "d@g.us",
    text: "offer",
    kind: "image",
    mimetype: "image/jpeg",
  }, jpeg), { key: { id: "sent-image" } });
  assert.equal(body.media, jpeg);
  assert.equal(body.mimetype, "image/jpeg");
});

test("Evolution rejects URLs malformed base64 and oversized image envelopes before POST", async () => {
  let calls = 0;
  const client = new mod.EvolutionClient({
    url: "http://evolution:8080",
    apiKey: "secret",
    instance: "main",
    fetch: async () => {
      calls++;
      return Response.json({ key: { id: "unexpected" } });
    },
  });
  const job = { destination: "d@g.us", text: "offer", kind: "image", mimetype: "image/jpeg" };
  for (const media of [
    "https://http2.mlstatic.com/product.jpg",
    "//79AA==",
    "abcd===",
    Buffer.alloc(7 * 1024 * 1024, "a").toString("base64"),
  ]) await assert.rejects(() => client.send(job, media), /media_invalid/);
  assert.equal(calls, 0);
});

test("Evolution bounds the complete encoded JSON image envelope rather than only its media field", async () => {
  const bytes = Buffer.alloc(5_505_000);
  bytes.set([0xff, 0xd8, 0xff], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  const media = bytes.toString("base64");
  assert.ok(media.length < 7 * 1024 * 1024);
  let calls = 0;
  const client = new mod.EvolutionClient({
    url: "http://evolution:8080",
    apiKey: "secret",
    instance: "main",
    fetch: async () => { calls++; return Response.json({ key: { id: "unexpected" } }); },
  });
  await assert.rejects(() => client.send({
    destination: "destination@g.us",
    text: "caption adds bytes to the bounded envelope",
    kind: "image",
    mimetype: "image/jpeg",
  }, media), /media_invalid/);
  assert.equal(calls, 0);
});
