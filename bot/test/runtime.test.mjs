import test from "node:test";
import assert from "node:assert/strict";
const mod = await import("../runtime.mjs").catch(() => ({}));
test("webhook stamps intake mode durably for both modes", async () => {
  for (const dryRun of [true, false]) {
    let queued;
    const handler = mod.webhookHandler({
      secret: "a".repeat(32),
      dryRun,
      routes: [
        {
          sourceGroup: "s@g.us",
          destinationGroup: "d@g.us",
          tag: "t",
          createTag: false,
        },
      ],
      instance: "main",
      store: {
        enqueue: async (jobs) => {
          queued = jobs;
        },
      },
    });
    await handler(
      {
        url: "/webhooks/evolution",
        method: "POST",
        headers: { "x-webhook-secret": "a".repeat(32) },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(
            JSON.stringify({
              event: "messages.upsert",
              instance: "main",
              data: {
                key: { id: "1", fromMe: false, remoteJid: "s@g.us" },
                message: { conversation: "https://meli.la/a" },
              },
            }),
          );
        },
      },
      { writeHead() {}, end() {} },
    );
    assert.equal(queued[0].intakeDryRun, dryRun);
  }
});
test("backlog obeys intake mode and current authorization", async () => {
  const route = {
    sourceGroup: "s@g.us",
    destinationGroup: "d@g.us",
    tag: "tech",
    createTag: false,
  };
  for (const [marker, routes, expected] of [
    [true, [route], "simulated"],
    [false, [], "review"],
    [false, [{ ...route, tag: "changed" }], "review"],
    [undefined, [route], "review"],
  ]) {
    const states = [];
    let calls = 0;
    const job = {
      source: "s@g.us",
      destination: "d@g.us",
      tag: "tech",
      createTag: false,
      text: "https://meli.la/a",
      kind: "text",
      intakeDryRun: marker,
    };
    await mod.workOnce(
      {
        claim: async () => ({ id: 1, payload: job }),
        state: async (id, state) => states.push(state),
      },
      {
        dryRun: false,
        routes,
        meli: {
          convert: async () => {
            calls++;
            return "https://meli.la/new";
          },
        },
        evolution: {
          send: async () => {
            calls++;
          },
        },
      },
    );
    assert.deepEqual(states, [expected]);
    assert.equal(calls, 0);
  }
});
test("runtime exists", () =>
  assert.equal(typeof mod.webhookHandler, "function"));
test("webhook auth blocks queue and authorized delivery queues", async () => {
  let count = 0;
  const handler = mod.webhookHandler({
    secret: "a".repeat(32),
    routes: [],
    instance: "main",
    store: {
      enqueue: async () => {
        count++;
      },
    },
  });
  const response = () => ({
    writeHead(s) {
      this.status = s;
    },
    end(s) {
      this.body = s;
    },
  });
  let res = response();
  await handler(
    { url: "/webhooks/evolution", method: "POST", headers: {} },
    res,
  );
  assert.equal(res.status, 401);
  assert.equal(count, 0);
  res = response();
  const req = {
    url: "/webhooks/evolution",
    method: "POST",
    headers: { "x-webhook-secret": "a".repeat(32) },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("{}");
    },
  };
  await handler(req, res);
  assert.equal(res.status, 202);
});
test("worker puts ambiguous send in review, never retries", async () => {
  const states = [];
  let available = true;
  const store = {
    claim: async () =>
      available
        ? ((available = false),
          {
            id: 1,
            payload: {
              text: "https://meli.la/a",
              kind: "text",
              intakeDryRun: false,
              source: "s",
              destination: "d",
              tag: "t",
              createTag: false,
            },
          })
        : null,
    state: async (id, state) => states.push(state),
  };
  await mod.workOnce(store, {
    dryRun: false,
    routes: [
      { sourceGroup: "s", destinationGroup: "d", tag: "t", createTag: false },
    ],
    meli: { convert: async () => "https://meli.la/new" },
    evolution: {
      send: async () => {
        throw Error("secret");
      },
    },
  });
  assert.deepEqual(states, ["sending", "review"]);
  assert.equal(await mod.workOnce(store, {}), false);
});
test("enqueue SQL has both durable id and fingerprint dedup", async () => {
  const queries = [];
  const db = {
    query: async (sql, args) => {
      queries.push({ sql, args });
      return { rows: [] };
    },
  };
  const store = new mod.Store(db);
  await store.enqueue([
    { id: "1", source: "s", destination: "d", text: "hello", kind: "text" },
  ]);
  assert.match(queries.at(-1).sql, /ON CONFLICT DO NOTHING/);
  assert.equal(queries.at(-1).args[4].length, 64);
});
