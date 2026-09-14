import test from "node:test";
import assert from "node:assert/strict";
const mod = await import("../core.mjs").catch(() => ({}));
const route = {
  sourceGroup: "source@g.us",
  destinationGroup: "dest@g.us",
  tag: "tech",
  createTag: false,
};
const event = (
  text = "Offer https://www.mercadolivre.com.br/p/MLB1?attributes=COLOR:blue",
) => ({
  event: "messages.upsert",
  instance: "main",
  data: {
    key: { id: "1", remoteJid: route.sourceGroup, fromMe: false },
    message: { conversation: text },
  },
});
test("core is implemented", () =>
  assert.equal(typeof mod.extractJobs, "function"));
test("allowed text preserves variant query and ignores unrelated/fromMe/destination events", () => {
  assert.equal(
    mod.extractJobs(event(), [route], "main")[0].text,
    event().data.message.conversation,
  );
  for (const change of [
    { remoteJid: "x@g.us" },
    { fromMe: true },
    { remoteJid: "dest@g.us" },
  ]) {
    const e = event();
    Object.assign(e.data.key, change);
    assert.deepEqual(mod.extractJobs(e, [route], "main"), []);
  }
  assert.deepEqual(
    mod.extractJobs({ ...event(), instance: "other" }, [route], "main"),
    [],
  );
});
test("configuration rejects cycles and duplicate targets", () =>
  assert.throws(() =>
    mod.validateRoutes({
      routes: [
        route,
        { ...route, sourceGroup: "dest@g.us", destinationGroup: "source@g.us" },
      ],
    }),
  ));
test("dry-run performs no network and marks simulated", async () => {
  const result = await mod.processJob(
    { ...mod.extractJobs(event(), [route], "main")[0] },
    {
      dryRun: true,
      meli: { convert: () => assert.fail() },
      evolution: { send: () => assert.fail() },
    },
  );
  assert.equal(result, "simulated");
});
test("all marketplace links converted before sending, preserving other text", async () => {
  const job = mod.extractJobs(
    event(
      "A https://meli.la/one B https://produto.mercadolivre.com.br/MLB-2?x=1.",
    ),
    [route],
    "main",
    false,
  )[0];
  let sent;
  await mod.processJob(job, {
    dryRun: false,
    meli: {
      convert: async (u) =>
        "https://meli.la/" + (u.includes("one") ? "new1" : "new2"),
    },
    evolution: {
      send: async (j) => {
        sent = j;
      },
    },
  });
  assert.equal(sent.text, "A https://meli.la/new1 B https://meli.la/new2.");
});
test("conversion error blocks all sends", async () => {
  let n = 0;
  await assert.rejects(() =>
    mod.processJob(
      mod.extractJobs(
        event("https://meli.la/a https://meli.la/b"),
        [route],
        "main",
        false,
      )[0],
      {
        dryRun: false,
        meli: {
          convert: async () => {
            if (n++) throw Error("bad");
            return "https://meli.la/new";
          },
        },
        evolution: { send: () => assert.fail() },
      },
    ),
  );
});
test("unknown links fail closed", async () => {
  await assert.rejects(() =>
    mod.processJob(
      mod.extractJobs(event("https://example.com/a"), [route], "main")[0],
      { dryRun: false, meli: {}, evolution: { send: () => assert.fail() } },
    ),
  );
});
test("image captures bounded download metadata and preserves caption without unrelated fields", () => {
  const e = event();
  e.data.message = {
    imageMessage: {
      caption: "Hi https://meli.la/a",
      mimetype: "image/jpeg",
      url: "https://mmg.whatsapp.net/image",
      directPath: "/image",
      mediaKey: Buffer.alloc(32).toString("base64"),
      fileLength: 1024,
      jpegThumbnail: "private",
    },
  };
  const job = mod.extractJobs(e, [route], "main")[0];
  assert.equal(job.kind, "image");
  assert.equal(job.text, "Hi https://meli.la/a");
  assert.equal(job.imageMessage.url, "https://mmg.whatsapp.net/image");
  assert.equal(job.imageMessage.mediaKey, e.data.message.imageMessage.mediaKey);
  assert.equal(JSON.stringify(job).includes("private"), false);
});
test("image download URLs outside WhatsApp CDN are rejected", () => {
  const e = event();
  e.data.message = {
    imageMessage: {
      caption: "https://meli.la/a",
      mimetype: "image/jpeg",
      url: "http://127.0.0.1",
      mediaKey: Buffer.alloc(32).toString("base64"),
    },
  };
  assert.deepEqual(mod.extractJobs(e, [route], "main"), []);
});
test("destination cannot have conflicting tags", () =>
  assert.throws(() =>
    mod.validateRoutes({
      routes: [
        route,
        { ...route, sourceGroup: "other@g.us", tag: "different" },
      ],
    }),
  ));
test("image accepts serialized byte buffers and preserves bounded timestamp", () => {
  const e = event();
  e.data.message = {
    imageMessage: {
      caption: "https://meli.la/a",
      mimetype: "image/jpeg",
      url: "https://mmg.whatsapp.net/image",
      mediaKey: { type: "Buffer", data: Array(32).fill(1) },
      mediaKeyTimestamp: "1720000000",
    },
  };
  const job = mod.extractJobs(e, [route], "main")[0];
  assert.equal(
    job.imageMessage.mediaKey,
    Buffer.alloc(32, 1).toString("base64"),
  );
  assert.equal(job.imageMessage.mediaKeyTimestamp, 1720000000);
});
test("image accepts WhatsApp 64-bit file length objects", () => {
  const e = event();
  e.data.message = {
    imageMessage: {
      caption: "https://meli.la/a",
      mimetype: "image/jpeg",
      url: "https://mmg.whatsapp.net/image",
      mediaKey: Buffer.alloc(32).toString("base64"),
      fileLength: { low: 1024, high: 0, unsigned: true },
    },
  };
  const job = mod.extractJobs(e, [route], "main")[0];
  assert.ok(job);
  assert.equal(job.imageMessage.fileLength, 1024);
});
