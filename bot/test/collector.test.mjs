import test from "node:test";
import assert from "node:assert/strict";
import { collectDue, collectOnce } from "../collector.mjs";
import { offerIdentities } from "../product-fingerprint.mjs";

const STARTED_AT = new Date("2026-09-15T12:00:00.000Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function ids() {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

function niche(id, categoryId, maxPerRound = 2) {
  return {
    id,
    enabled: true,
    categoryId,
    categoryIds: [categoryId],
    destinationGroup: `${id}@g.us`,
    tag: id,
    maxPerRound,
  };
}

function offer(itemNumber, categoryId, overrides = {}) {
  const itemId = `MLB${itemNumber}`;
  return {
    itemId,
    rank: itemNumber,
    title: `Produto modelo ${itemNumber}`,
    status: "active",
    permalink: `https://produto.mercadolivre.com.br/MLB-${itemNumber}-produto`,
    imageUrl: `https://http2.mlstatic.com/${itemNumber}.jpg`,
    price: 100,
    originalPrice: 150,
    categoryId,
    ...overrides,
  };
}

function fakeStore(claimed, {
  recent = new Set(), reservationRejected = new Set(), preparationRejected = new Set(),
} = {}) {
  const events = [];
  const held = new Set(recent);
  return {
    events,
    held,
    claimDueNiches: async () => claimed,
    claimDueNiche: async () => claimed[0] ?? null,
    nextCategory: async (vertical) => vertical.categoryIds[0],
    recentIdentityKeys: async () => new Set(held),
    reserveOffer: async (keys, options) => {
      events.push(["reserve", options.itemId, keys, options.reservationId]);
      return !reservationRejected.has(options.itemId);
    },
    prepareDelivery: async (reservationId, keys) => {
      const reservation = events.find((event) => event[0] === "reserve" && event[3] === reservationId);
      events.push(["prepare", reservation?.[1], reservationId]);
      if (preparationRejected.has(reservation?.[1])) return false;
      for (const key of keys) held.add(key);
      return true;
    },
    savePreview: async (nicheId, candidate, state) => events.push(["preview", nicheId, candidate.itemId, state]),
    releaseOffer: async (reservationId) => { events.push(["release", reservationId]); return true; },
    quarantineOffer: async (reservationId) => {
      const reservation = events.find((event) => event[0] === "reserve" && event[3] === reservationId);
      for (const key of reservation?.[2] ?? []) held.add(key);
      events.push(["quarantine", reservationId]);
      return true;
    },
    finalizePublication: async (reservationId, nicheId, itemId, affiliateUrl) => {
      events.push(["finalize", itemId, reservationId, nicheId, affiliateUrl]);
      for (const key of events.find((event) => event[0] === "reserve" && event[3] === reservationId)?.[2] ?? []) held.add(key);
      return true;
    },
    publicationFinalized: async () => false,
    markReview: async (nicheId, itemId) => events.push(["review", nicheId, itemId]),
    completeRun: async (nicheId, result) => events.push(["complete", nicheId, result]),
    recordRound: async (roundId, summary, startedAt) => events.push(["round", roundId, { ...summary }, startedAt]),
  };
}

function dependencies({ claimed, candidatesByCategory, store = fakeStore(claimed), ...overrides }) {
  return {
    store,
    niches: claimed,
    source: { list: async (categoryId) => candidatesByCategory.get(categoryId) ?? [] },
    authorizedToken: async () => "secret-token",
    meli: { convert: async (_url, tag) => `https://meli.la/${tag}` },
    evolution: { send: async () => ({ key: { id: "sent" } }) },
    sessionAlert: { required: async () => {}, restored: async () => {} },
    composeCard: async () => JPEG,
    randomUUID: ids(),
    now: () => new Date(STARTED_AT),
    dryRun: false,
    delay: async () => {},
    logger: { info() {}, error() {} },
    ...overrides,
  };
}

test("publishes ten offers across at least five niches with no more than two per niche and completes every claim", async () => {
  const claimed = [
    niche("tools", "MLB100"), niche("games", "MLB200"), niche("phones", "MLB300"),
    niche("shoes", "MLB400"), niche("home", "MLB500"), niche("extra", "MLB600"),
  ];
  const candidatesByCategory = new Map(claimed.map((vertical, nicheIndex) => [
    vertical.categoryId,
    [1, 2, 3].map((offset) => offer(1000 + nicheIndex * 10 + offset, vertical.categoryId)),
  ]));
  const store = fakeStore(claimed);
  const sends = [];
  const waits = [];
  const result = await collectDue(dependencies({
    claimed,
    candidatesByCategory,
    store,
    evolution: { send: async (job, media) => { sends.push({ job, media }); return { key: { id: `sent-${sends.length}` } }; } },
    delay: async (milliseconds) => waits.push(milliseconds),
    sendDelayMs: 123,
  }));

  assert.equal(result.published, 10);
  assert.equal(sends.length, 10);
  const counts = sends.reduce((map, send) => map.set(send.job.destination, (map.get(send.job.destination) ?? 0) + 1), new Map());
  assert.ok(counts.size >= 5);
  assert.ok([...counts.values()].every((count) => count <= 2));
  assert.deepEqual(store.events.filter((event) => event[0] === "complete").map((event) => event[1]).sort(), claimed.map((entry) => entry.id).sort());
  assert.equal(store.events.filter((event) => event[0] === "round").length, 1);
  assert.deepEqual(waits, Array(9).fill(123));
});

test("counts food ineligible recent exact recent fingerprint quota and duplicate candidates exactly", async () => {
  const claimed = [niche("tools", "MLB100")];
  const selectedA = offer(1, "MLB100", { title: "Furadeira Bosch modelo alpha" });
  const selectedB = offer(2, "MLB100", { title: "Parafusadeira Makita modelo beta" });
  const quota = offer(3, "MLB100", { title: "Serra Dewalt modelo gamma" });
  const duplicate = { ...selectedA };
  const food = offer(4, "MLB100", { title: "Arroz branco tipo 1 5kg" });
  const ineligible = offer(5, "MLB100", { status: "paused" });
  const exactRecent = offer(6, "MLB100", { title: "Alicate Tramontina modelo seis" });
  const fingerprintRecent = offer(7, "MLB100", { title: "Martelete Stanley modelo sete" });
  const historicalEquivalent = offer(70, "MLB100", { title: fingerprintRecent.title });
  const recent = new Set([offerIdentities(exactRecent)[0], offerIdentities(historicalEquivalent).at(-1)]);
  const store = fakeStore(claimed, { recent });
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [selectedA, selectedB, quota, duplicate, food, ineligible, exactRecent, fingerprintRecent]]]),
  }));

  assert.equal(result.discovered, 8);
  assert.equal(result.rejectedFood, 1);
  assert.equal(result.rejectedIneligible, 1);
  assert.equal(result.rejectedRecent, 1);
  assert.equal(result.rejectedFingerprint, 1);
  assert.equal(result.rejectedDuplicate, 1);
  assert.equal(result.rejectedQuota, 1);
  assert.equal(result.published, 2);
});

test("a quota-discarded offer does not suppress an equivalent selected from another niche", async () => {
  const claimed = [niche("tools", "MLB100", 1), niche("games", "MLB200", 1)];
  const quotaDiscarded = offer(1, "MLB100", { rank: 2, title: "Controle Sony DualSense PS5" });
  const selectedTool = offer(2, "MLB100", { rank: 1, title: "Furadeira Bosch GSB modelo dois" });
  const selectedEquivalent = offer(3, "MLB200", { rank: 1, title: quotaDiscarded.title });
  const store = fakeStore(claimed);
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([
      ["MLB100", [quotaDiscarded, selectedTool]],
      ["MLB200", [selectedEquivalent]],
    ]),
    roundLimit: 2,
    perNiche: 1,
  }));
  assert.equal(result.published, 2);
  assert.equal(result.rejectedQuota, 1);
  assert.equal(result.rejectedDuplicate, 0);
});

test("counts a persisted canonical URL identity separately from a recent item identity", async () => {
  const claimed = [niche("tools", "MLB100")];
  const candidate = offer(123, "MLB100", { title: "Furadeira Bosch GSB 13 RE" });
  const [, canonicalUrlIdentity] = offerIdentities(candidate);
  const store = fakeStore(claimed, { recent: new Set(["item:MLB999", canonicalUrlIdentity]) });
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
  }));
  assert.equal(result.rejectedUrl, 1);
  assert.equal(result.rejectedRecent, 0);
  assert.equal(result.rejectedFingerprint, 0);
  assert.equal(result.published, 0);
});

test("reserves before affiliate and card creation then sends card base64 and finalizes only after acknowledgement", async () => {
  const claimed = [niche("games", "MLB100")];
  const candidate = offer(1, "MLB100");
  const store = fakeStore(claimed);
  const order = [];
  const originalReserve = store.reserveOffer;
  const originalFinalize = store.finalizePublication;
  store.reserveOffer = async (...args) => { order.push("reserve"); return originalReserve(...args); };
  store.finalizePublication = async (...args) => { order.push("finalize"); return originalFinalize(...args); };
  let sent;
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
    meli: { convert: async () => { order.push("affiliate"); return "https://meli.la/ours"; } },
    composeCard: async () => { order.push("compose"); return JPEG; },
    evolution: { send: async (job, media) => { order.push("send"); sent = { job, media }; return { key: { id: "ack" } }; } },
  }));

  assert.equal(result.published, 1);
  assert.deepEqual(order, ["reserve", "affiliate", "compose", "send", "finalize"]);
  assert.equal(sent.media, JPEG.toString("base64"));
  assert.equal(sent.job.mimetype, "image/jpeg");
  assert.notEqual(sent.media, candidate.imageUrl);
});

test("reservation loss and known affiliate or composition failures never send and release only acquired reservations", async () => {
  const claimed = [niche("tools", "MLB100", 2), niche("games", "MLB200", 2)];
  const reservationLost = offer(1, "MLB100");
  const affiliateFailed = offer(2, "MLB100");
  const composeFailed = offer(3, "MLB200");
  const successful = offer(4, "MLB200");
  const store = fakeStore(claimed, { reservationRejected: new Set([reservationLost.itemId]) });
  const sends = [];
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([
      ["MLB100", [reservationLost, affiliateFailed]],
      ["MLB200", [composeFailed, successful]],
    ]),
    meli: { convert: async (url) => {
      if (url.includes("MLB-2-")) throw Error("affiliate_failed");
      return "https://meli.la/ours";
    } },
    composeCard: async (candidate) => {
      if (candidate.itemId === composeFailed.itemId) throw Error("offer_image_invalid");
      return JPEG;
    },
    evolution: { send: async (...args) => { sends.push(args); return { key: { id: "ack" } }; } },
  }));

  assert.equal(result.reservationRejected, 1);
  assert.equal(result.affiliateFailed, 1);
  assert.equal(result.composeFailed, 1);
  assert.equal(result.skipped, 3);
  assert.equal(result.published, 1);
  assert.equal(sends.length, 1);
  assert.equal(store.events.filter((event) => event[0] === "release").length, 2);
  assert.equal(store.events.filter((event) => event[0] === "review").length, 2);
});

test("reservation conflicts backfill the per-niche quota from ranked spare candidates", async () => {
  const claimed = [niche("tools", "MLB100", 2)];
  const candidates = [offer(1, "MLB100"), offer(2, "MLB100"), offer(3, "MLB100")];
  const store = fakeStore(claimed, { reservationRejected: new Set([candidates[0].itemId]) });
  const sent = [];

  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", candidates]]),
    roundLimit: 2,
    perNiche: 2,
    evolution: { send: async (job) => { sent.push(job.text); return { key: { id: "ack" } }; } },
  }));

  assert.equal(result.reservationRejected, 1);
  assert.equal(result.rejectedDuplicate, 0);
  assert.equal(result.rejectedQuota, 0);
  assert.equal(result.published, 2);
  assert.equal(store.events.filter((event) => event[0] === "reserve").length, 3);
  assert.equal(sent.length, 2);
  assert.ok(sent.some((text) => text.includes(candidates[1].title)));
  assert.ok(sent.some((text) => text.includes(candidates[2].title)));
});

test("an ambiguous send is quarantined and cannot be selected automatically on the next round", async () => {
  const claimed = [niche("games", "MLB100")];
  const candidate = offer(1, "MLB100");
  const store = fakeStore(claimed);
  let sends = 0;
  const options = dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
    evolution: { send: async () => { sends++; throw Error("network-secret=do-not-log"); } },
  });
  const first = await collectDue(options);
  const second = await collectDue({ ...options, randomUUID: ids() });

  assert.equal(first.deliveryFailed, 1);
  assert.equal(first.published, 0);
  assert.equal(second.rejectedRecent, 1);
  assert.equal(sends, 1);
  assert.equal(store.events.filter((event) => event[0] === "quarantine").length, 1);
  assert.equal(store.events.filter((event) => event[0] === "finalize").length, 0);
});

test("rechecks reservation ownership immediately before delivery and releases a lost lease without sending", async () => {
  const claimed = [niche("games", "MLB100")];
  const candidate = offer(1, "MLB100");
  const store = fakeStore(claimed, { preparationRejected: new Set([candidate.itemId]) });
  let sends = 0;
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
    evolution: { send: async () => { sends++; } },
  }));
  assert.equal(sends, 0);
  assert.equal(result.reservationRejected, 1);
  assert.equal(store.events.filter((event) => event[0] === "prepare").length, 1);
  assert.equal(store.events.filter((event) => event[0] === "release").length, 1);
});

test("treats a local media validation error as known pre-send and releases instead of quarantining", async () => {
  const claimed = [niche("games", "MLB100")];
  const candidate = offer(1, "MLB100");
  const store = fakeStore(claimed);
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
    evolution: { send: async () => { throw Error("media_invalid"); } },
  }));
  assert.equal(result.composeFailed, 1);
  assert.equal(result.deliveryFailed, 0);
  assert.equal(store.events.filter((event) => event[0] === "release").length, 1);
  assert.equal(store.events.filter((event) => event[0] === "quarantine").length, 0);
});

test("the pre-delivery hold prevents retry even if ambiguous-send quarantine persistence fails", async () => {
  const claimed = [niche("games", "MLB100")];
  const candidate = offer(1, "MLB100");
  const store = fakeStore(claimed);
  store.quarantineOffer = async () => { throw Error("database-secret"); };
  let sends = 0;
  const options = dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
    evolution: { send: async () => { sends++; throw Error("ambiguous"); } },
  });
  await collectDue(options);
  const second = await collectDue({ ...options, randomUUID: ids() });
  assert.equal(sends, 1);
  assert.equal(second.rejectedRecent, 1);
});

test("an acknowledged send whose atomic finalization fails is quarantined and not reported published", async () => {
  const claimed = [niche("games", "MLB100")];
  const candidate = offer(1, "MLB100");
  const store = fakeStore(claimed);
  store.finalizePublication = async () => { throw Error("database-password=secret"); };
  const logs = [];
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
    logger: { info: (event) => logs.push(event), error: (event) => logs.push(event) },
  }));

  assert.equal(result.delivered, 1);
  assert.equal(result.finalizationFailed, 1);
  assert.equal(result.published, 0);
  assert.equal(store.events.filter((event) => event[0] === "quarantine").length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /password|secret/);
});

test("a lost finalization response is reconciled as published without review or quarantine", async () => {
  const claimed = [niche("games", "MLB200")];
  const candidate = offer(201, "MLB200");
  const store = fakeStore(claimed);
  store.finalizePublication = async () => { throw Error("commit_response_lost"); };
  store.publicationFinalized = async (reservationId, nicheId, itemId, affiliateUrl, keys) => {
    assert.match(reservationId, /^[0-9a-f-]{36}$/);
    assert.equal(nicheId, "games");
    assert.equal(itemId, candidate.itemId);
    assert.equal(affiliateUrl, "https://meli.la/games");
    assert.deepEqual(keys, offerIdentities(candidate));
    return true;
  };

  const result = await collectDue(dependencies({
    claimed,
    candidatesByCategory: new Map([["MLB200", [candidate]]]),
    store,
  }));

  assert.equal(result.delivered, 1);
  assert.equal(result.published, 1);
  assert.equal(result.finalizationFailed, 0);
  assert.equal(result.review, 0);
  assert.equal(store.events.some((event) => event[0] === "quarantine"), false);
  assert.equal(store.events.some((event) => event[0] === "review"), false);
});

test("an unavailable finalization reconciliation does not falsely quarantine a possible commit", async () => {
  const claimed = [niche("games", "MLB200")];
  const candidate = offer(202, "MLB200");
  const store = fakeStore(claimed);
  store.finalizePublication = async () => { throw Error("commit_response_lost"); };
  store.publicationFinalized = async () => { throw Error("database_unavailable"); };

  const result = await collectDue(dependencies({
    claimed,
    candidatesByCategory: new Map([["MLB200", [candidate]]]),
    store,
  }));

  assert.equal(result.published, 0);
  assert.equal(result.finalizationFailed, 1);
  assert.equal(result.review, 0);
  assert.equal(store.events.some((event) => event[0] === "quarantine"), false);
  assert.equal(store.events.some((event) => event[0] === "review"), false);
});

test("spaces acknowledged sends even when finalization fails and ignores a failed injected delay", async () => {
  const claimed = [niche("games", "MLB100")];
  const first = offer(1, "MLB100");
  const second = offer(2, "MLB100");
  const store = fakeStore(claimed);
  const finalize = store.finalizePublication;
  store.finalizePublication = async (...args) => {
    if (args[2] === first.itemId) throw Error("database-secret");
    return finalize(...args);
  };
  let waits = 0;
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [first, second]]]),
    delay: async () => { waits++; throw Error("timer-secret"); },
  }));
  assert.equal(waits, 1);
  assert.equal(result.delivered, 2);
  assert.equal(result.finalizationFailed, 1);
  assert.equal(result.published, 1);
  assert.deepEqual(store.events.filter((event) => event[0] === "complete").map((event) => event[2]), ["published_partial"]);
});

test("dry run saves selected previews and completes all claims without affiliate card reservation or delivery", async () => {
  const claimed = [niche("tools", "MLB100"), niche("empty", "MLB200")];
  const store = fakeStore(claimed);
  let external = 0;
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [offer(1, "MLB100")]], ["MLB200", []]]),
    dryRun: true,
    meli: { convert: async () => external++ },
    composeCard: async () => { external++; return JPEG; },
    evolution: { send: async () => external++ },
  }));

  assert.equal(external, 0);
  assert.equal(result.published, 0);
  assert.deepEqual(store.events.filter((event) => event[0] === "preview").map((event) => event[3]), ["simulated"]);
  assert.equal(store.events.filter((event) => event[0] === "reserve").length, 0);
  assert.equal(store.events.filter((event) => event[0] === "complete").length, 2);
  assert.equal(store.events.filter((event) => event[0] === "round").length, 1);
});

test("records sanitized round metrics and completes every claimed niche when token acquisition fails", async () => {
  const claimed = [niche("tools", "MLB100"), niche("games", "MLB200")];
  const store = fakeStore(claimed);
  const logs = [];
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map(),
    authorizedToken: async () => { throw Error("access-token=super-secret"); },
    logger: { info: (event) => logs.push(event), error: (event) => logs.push(event) },
  }));

  assert.equal(result.failed, 2);
  assert.deepEqual(store.events.filter((event) => event[0] === "complete").map((event) => event[2]), ["authorization_error", "authorization_error"]);
  const round = store.events.find((event) => event[0] === "round");
  assert.equal(round[1], "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(round[3], STARTED_AT);
  assert.ok(Object.values(round[2]).every((value) => Number.isSafeInteger(value) && value >= 0));
  assert.doesNotMatch(JSON.stringify(logs), /access-token|super-secret/);
});

test("isolates category and source failures while alerting once for repeated session failures", async () => {
  const claimed = [
    niche("category", "MLB100"), niche("source", "MLB200"),
    niche("session-a", "MLB300"), niche("session-b", "MLB400"),
  ];
  const store = fakeStore(claimed);
  store.nextCategory = async (vertical) => {
    if (vertical.id === "category") throw Error("cursor database secret");
    return vertical.categoryId;
  };
  let alerts = 0;
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map(),
    source: { list: async (categoryId) => {
      if (categoryId === "MLB200") throw Error("source_api_key=secret");
      return [offer(Number(categoryId.slice(3)), categoryId)];
    } },
    meli: { convert: async () => { throw Error("session_expired"); } },
    sessionAlert: { required: async () => { alerts++; }, restored: async () => {} },
  }));

  assert.equal(result.failed, 4);
  assert.equal(result.sessionFailed, 2);
  assert.equal(alerts, 1);
  assert.deepEqual(store.events.filter((event) => event[0] === "complete").map((event) => event[2]), [
    "category_error", "source_error", "affiliate_error", "affiliate_error",
  ]);
});

test("successful incident restoration rearms one alert for a later independent expiry", async () => {
  const claimed = [
    niche("session-a", "MLB100"), niche("restored", "MLB200"), niche("session-b", "MLB300"),
  ];
  const store = fakeStore(claimed);
  let alerts = 0;
  let restorations = 0;
  const result = await collectDue(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map(claimed.map((vertical, index) => [
      vertical.categoryId, [offer(index + 1, vertical.categoryId)],
    ])),
    meli: { convert: async (url) => {
      if (!url.includes("MLB-2-")) throw Error("session_expired");
      return "https://meli.la/ours";
    } },
    sessionAlert: {
      required: async () => { alerts++; },
      restored: async () => { restorations++; },
    },
  }));
  assert.equal(result.sessionFailed, 2);
  assert.equal(alerts, 2);
  assert.equal(restorations, 1);
});

test("collectOnce uses reservation affiliate branded JPEG delivery and durable ambiguous quarantine", async () => {
  const claimed = [niche("games", "MLB100")];
  const candidate = offer(1, "MLB100");
  const store = fakeStore(claimed);
  const order = [];
  const originalReserve = store.reserveOffer;
  const originalQuarantine = store.quarantineOffer;
  store.reserveOffer = async (...args) => { order.push("reserve"); return originalReserve(...args); };
  store.quarantineOffer = async (...args) => { order.push("quarantine"); return originalQuarantine(...args); };
  const result = await collectOnce(dependencies({
    claimed,
    store,
    candidatesByCategory: new Map([["MLB100", [candidate]]]),
    meli: { convert: async () => { order.push("affiliate"); return "https://meli.la/ours"; } },
    composeCard: async () => { order.push("compose"); return JPEG; },
    evolution: { send: async (job, media) => {
      order.push("send");
      assert.equal(media, JPEG.toString("base64"));
      assert.equal(job.mimetype, "image/jpeg");
      throw Error("ambiguous");
    } },
  }));

  assert.equal(result, "delivery_error");
  assert.deepEqual(order, ["reserve", "affiliate", "compose", "send", "quarantine"]);
  assert.equal(store.events.filter((event) => event[0] === "release").length, 0);
  assert.equal(store.events.filter((event) => event[0] === "finalize").length, 0);
});

test("collectOnce processes exactly one niche through the modern atomic claim interface", async () => {
  const due = [niche("tools", "MLB100"), niche("games", "MLB200")];
  const store = fakeStore(due);
  store.claimDueNiche = async (niches) => {
    assert.deepEqual(niches, due);
    return due[0];
  };
  store.claimDueNiches = async () => assert.fail("collectOnce must not claim the full due batch");
  const listed = [];

  const result = await collectOnce(dependencies({
    claimed: due,
    store,
    candidatesByCategory: new Map(),
    source: { list: async (categoryId) => { listed.push(categoryId); return [offer(1, categoryId)]; } },
  }));

  assert.equal(result, "published");
  assert.deepEqual(listed, ["MLB100"]);
  assert.deepEqual(
    store.events.filter((event) => event[0] === "complete").map((event) => event[1]),
    ["tools"],
  );
});
