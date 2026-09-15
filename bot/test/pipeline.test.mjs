import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createCollectorLoopOptions,
  createCollectorSessionAlert,
  parseCollectorConfig,
} from "../server-config.mjs";
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

test("collector configuration uses the approved production defaults", () => {
  assert.deepEqual(parseCollectorConfig({}), {
    intervalMs: 20 * 60 * 1_000,
    timeZone: "America/Sao_Paulo",
    startHour: 7,
    endHour: 23,
    roundLimit: 10,
    maxPerNiche: 1,
    dedupDays: 7,
    logoPath: "/app/site/logo.jpg",
    sendDelayMs: 15_000,
    adminWhatsapp: "5543991724961",
  });
});

test("collector configuration accepts supported numeric boundaries with the fixed operating window", () => {
  assert.deepEqual(parseCollectorConfig({
    COLLECTOR_INTERVAL_MINUTES: "1440",
    COLLECTOR_TIME_ZONE: "America/Sao_Paulo",
    COLLECTOR_START_HOUR: "7",
    COLLECTOR_END_HOUR: "23",
    COLLECTOR_ROUND_LIMIT: "1",
    COLLECTOR_MAX_PER_NICHE: "1",
    COLLECTOR_DEDUP_DAYS: "30",
    OFFER_CARD_LOGO_PATH: "/app/site/custom-logo.jpg",
    COLLECTOR_SEND_DELAY_MS: "1000",
    ADMIN_WHATSAPP: "5543991724961",
  }), {
    intervalMs: 1440 * 60 * 1_000,
    timeZone: "America/Sao_Paulo",
    startHour: 7,
    endHour: 23,
    roundLimit: 1,
    maxPerNiche: 1,
    dedupDays: 30,
    logoPath: "/app/site/custom-logo.jpg",
    sendDelayMs: 1_000,
    adminWhatsapp: "5543991724961",
  });
});

test("collector configuration rejects invalid numeric time zone window path and administrator values", () => {
  const invalid = [
    ["COLLECTOR_INTERVAL_MINUTES", "4"], ["COLLECTOR_INTERVAL_MINUTES", "1441"], ["COLLECTOR_INTERVAL_MINUTES", "5.5"],
    ["COLLECTOR_TIME_ZONE", "Mars/Olympus"], ["COLLECTOR_TIME_ZONE", "UTC"],
    ["COLLECTOR_START_HOUR", "-1"], ["COLLECTOR_START_HOUR", "0"], ["COLLECTOR_START_HOUR", "8"], ["COLLECTOR_START_HOUR", "24"],
    ["COLLECTOR_END_HOUR", "0"], ["COLLECTOR_END_HOUR", "22"], ["COLLECTOR_END_HOUR", "24"], ["COLLECTOR_END_HOUR", "25"],
    ["COLLECTOR_ROUND_LIMIT", "0"], ["COLLECTOR_ROUND_LIMIT", "11"],
    ["COLLECTOR_MAX_PER_NICHE", "0"], ["COLLECTOR_MAX_PER_NICHE", "3"],
    ["COLLECTOR_DEDUP_DAYS", "0"], ["COLLECTOR_DEDUP_DAYS", "31"],
    ["OFFER_CARD_LOGO_PATH", ""], ["OFFER_CARD_LOGO_PATH", "site/logo.jpg"],
    ["COLLECTOR_SEND_DELAY_MS", "999"], ["COLLECTOR_SEND_DELAY_MS", "60001"],
    ["ADMIN_WHATSAPP", "55 43 99172-4961"],
  ];
  for (const [name, value] of invalid) {
    assert.throws(() => parseCollectorConfig({ [name]: value }), /configuration_required/, `${name}=${value}`);
  }
  assert.throws(() => parseCollectorConfig({ COLLECTOR_START_HOUR: "23", COLLECTOR_END_HOUR: "23" }), /configuration_required/);
});

test("administrator destination defaults safely and validates explicit values", () => {
  assert.equal(parseCollectorConfig({}).adminWhatsapp, "5543991724961");
  assert.equal(parseCollectorConfig({ ADMIN_WHATSAPP: "" }).adminWhatsapp, "5543991724961");
  assert.equal(parseCollectorConfig({ ADMIN_WHATSAPP: "5511999999999" }).adminWhatsapp, "5511999999999");
  for (const value of ["123456789", "1234567890123456", "55 11999999999"])
    assert.throws(() => parseCollectorConfig({ ADMIN_WHATSAPP: value }), /configuration_required/);
});

test("session alert is disabled only for dry or disabled collectors and mandatory in live collection", () => {
  const fail = () => assert.fail("dry or disabled mode must not construct a session alert");
  assert.equal(createCollectorSessionAlert({ enabled: true, dryRun: true, SessionAlert: fail }), null);
  assert.equal(createCollectorSessionAlert({ enabled: false, dryRun: false, SessionAlert: fail }), null);

  const calls = [];
  const result = createCollectorSessionAlert({
    enabled: true,
    dryRun: false,
    SessionAlert: class {
      constructor(options) { calls.push(options); this.ready = true; }
    },
    evolution: { name: "evolution" },
    incidents: { name: "collector-store" },
    destination: parseCollectorConfig({}).adminWhatsapp,
  });
  assert.equal(result.ready, true);
  assert.deepEqual(calls, [{
    evolution: { name: "evolution" },
    incidents: { name: "collector-store" },
    destination: "5543991724961",
  }]);
});

test("collector pipeline injects the configured card schedule limits retention and abort signal", async () => {
  const signal = new AbortController().signal;
  const config = parseCollectorConfig({});
  const card = Buffer.from("card");
  let collected;
  let composed;
  const options = createCollectorLoopOptions({
    config,
    signal,
    collectDue: async (value) => { collected = value; },
    composeOfferCard: async (offer, settings) => { composed = { offer, settings }; return card; },
    store: { name: "collector-store" },
    niches: [{ id: "tools" }],
    source: { name: "source" },
    authorizedToken: async () => "token",
    meli: { name: "meli" },
    evolution: { name: "evolution" },
    sessionAlert: { name: "alert" },
    dryRun: false,
    logger: { info() {}, error() {} },
  });

  assert.equal(options.enabled, true);
  assert.equal(options.intervalMs, 1_200_000);
  assert.deepEqual(options.window, { timeZone: "America/Sao_Paulo", startHour: 7, endHour: 23 });
  assert.equal(options.signal, signal);
  await options.collect();
  assert.equal(collected.roundLimit, 10);
  assert.equal(collected.perNiche, 1);
  assert.equal(collected.retentionDays, 7);
  assert.equal(collected.sendDelayMs, 15_000);
  assert.equal(await collected.composeCard({ itemId: "MLB1" }), card);
  assert.deepEqual(composed, { offer: { itemId: "MLB1" }, settings: { logoPath: "/app/site/logo.jpg" } });
});

test("production configuration exposes every collector setting and keeps the logo in the image", async () => {
  const [envExample, compose, dockerfile] = await Promise.all([
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../../compose.yaml", import.meta.url), "utf8"),
    readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
  ]);
  const defaults = {
    COLLECTOR_INTERVAL_MINUTES: "20",
    COLLECTOR_TIME_ZONE: "America/Sao_Paulo",
    COLLECTOR_START_HOUR: "7",
    COLLECTOR_END_HOUR: "23",
    COLLECTOR_ROUND_LIMIT: "10",
    COLLECTOR_MAX_PER_NICHE: "1",
    COLLECTOR_DEDUP_DAYS: "7",
    OFFER_CARD_LOGO_PATH: "/app/site/logo.jpg",
    ADMIN_WHATSAPP: "5543991724961",
  };
  for (const [name, value] of Object.entries(defaults)) {
    assert.ok(envExample.split(/\r?\n/).includes(`${name}=${value}`), `.env.example ${name}`);
    assert.ok(compose.includes(`${name}: \${${name}:-${value}}`), `compose ${name}`);
  }
  assert.match(dockerfile, /COPY --chown=node:node site \.\/site/);
});

test("server initializes the collector store before constructing its durable session alert", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const created = server.indexOf("new CollectorStore(pool)");
  const initialized = server.indexOf("await collectorStore.init()", created);
  const alert = server.indexOf("createCollectorSessionAlert", initialized);
  assert.ok(created >= 0 && initialized > created && alert > initialized);
  assert.equal([...server.matchAll(/new CollectorStore\(pool\)/g)].length, 1);
  assert.equal([...server.matchAll(/await collectorStore\.init\(\)/g)].length, 1);
  assert.match(server.slice(alert, alert + 350), /incidents:\s*collectorStore/);
});

test("README documents the scheduled branded collector safety contract", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  for (const required of [
    /20 minutos/i,
    /\[07:00,\s*23:00\)/,
    /America\/Sao_Paulo/,
    /sem (?:criar|acumular|reproduzir).*backlog/i,
    /no máximo 10/i,
    /no máximo 2 por (?:nicho|vertical)/i,
    /roupas/i,
    /acessórios/i,
    /alimentos e bebidas.*excluídos/i,
    /item.*URL canônica.*fingerprint.*7 dias/is,
    /1080.?×.?1080.*Sharp/is,
    /um alerta.*incidente.*5543991724961/is,
    /não.*(?:fallback|substitu).*link (?:comum|normal)/is,
    /collector_rounds/i,
    /DRY_RUN=true/,
    /createLink/i,
  ]) assert.match(readme, required);
  assert.doesNotMatch(readme, /no máximo uma por vertical/i);
  assert.doesNotMatch(readme, /envia (?:a |uma )?imagem original/i);
});
