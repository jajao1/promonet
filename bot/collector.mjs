import { randomUUID as defaultRandomUUID } from "node:crypto";
import { setTimeout as defaultDelay } from "node:timers/promises";
import { composeOfferCard } from "./offer-card.mjs";
import { COLLECTOR_ROUND_METRIC_KEYS } from "./collector-store.mjs";
import { diversifyOfferPool, formatOffer, isEligibleOffer, isFoodOrBeverage } from "./offer-policy.mjs";
import { offerIdentities } from "./product-fingerprint.mjs";

function emptySummary() {
  return Object.fromEntries(COLLECTOR_ROUND_METRIC_KEYS.map((key) => [key, 0]));
}

function fixedLog(logger, level, payload) {
  try { logger?.[level]?.(payload); } catch { /* Logging cannot change delivery state. */ }
}

function eventPayload(event, context, outcome) {
  const payload = { event, roundId: context.roundId, nicheId: context.niche.id };
  if (context.categoryId) payload.categoryId = context.categoryId;
  if (context.offer?.itemId) payload.itemId = context.offer.itemId;
  if (outcome) payload.outcome = outcome;
  return payload;
}

function isSessionFailure(error) {
  return error?.message === "session_expired" || error?.message === "meli_session_missing";
}

function validAffiliateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "meli.la";
  } catch {
    return false;
  }
}

async function alertSessionOnce(sessionAlert, logger, context, alertState) {
  if (alertState.sent) return;
  alertState.sent = true;
  try {
    await sessionAlert?.required();
  } catch {
    fixedLog(logger, "error", eventPayload("session_alert_failed", context));
  }
}

async function restoreSessionIncident(sessionAlert, logger, context) {
  try {
    await sessionAlert?.restored();
    return true;
  } catch {
    fixedLog(logger, "error", eventPayload("session_incident_restore_failed", context));
    return false;
  }
}

async function quarantineReservation(store, reservationId, logger, context) {
  try {
    if (await store.quarantineOffer(reservationId)) return true;
  } catch {
    // The pre-delivery hold remains active even if conversion to review state fails.
  }
  fixedLog(logger, "error", eventPayload("quarantine_failed", context));
  return false;
}

async function safeStoreAction(action, logger, event, context) {
  try {
    return await action();
  } catch {
    fixedLog(logger, "error", eventPayload(event, context));
    return false;
  }
}

function finishResult(state, dryRun) {
  if (state.fixedResult) return state.fixedResult;
  if (!state.selected.length) return state.eligibleCount ? "quota" : "empty";
  if (state.outcomes.length !== state.selected.length) return "review";
  if (dryRun) return state.outcomes.every((result) => result === "simulated") ? "simulated" : "review";
  if (state.outcomes.every((result) => result === "published")) return "published";
  if (state.outcomes.includes("published")) return "published_partial";
  const distinct = new Set(state.outcomes);
  return distinct.size === 1 ? state.outcomes[0] : "review";
}

function classifyCandidates(states, recentIdentityKeys, summary) {
  const eligible = [];

  for (const state of states) {
    if (state.fixedResult) continue;
    for (const candidate of state.candidates) {
      if (isFoodOrBeverage(candidate)) {
        summary.rejected++;
        summary.rejectedFood++;
        continue;
      }
      if (!isEligibleOffer(candidate, { categoryId: state.categoryId, recentIds: new Set() })) {
        summary.rejected++;
        summary.rejectedIneligible++;
        continue;
      }

      let identities;
      try {
        identities = offerIdentities(candidate);
      } catch {
        summary.rejected++;
        summary.rejectedIneligible++;
        continue;
      }
      if (identities.some((key) => key.startsWith("item:") && recentIdentityKeys.has(key))) {
        summary.rejected++;
        summary.rejectedRecent++;
        continue;
      }
      if (identities.some((key) => key.startsWith("url:") && recentIdentityKeys.has(key))) {
        summary.rejected++;
        summary.rejectedUrl++;
        continue;
      }
      if (identities.some((key) => key.startsWith("product:") && recentIdentityKeys.has(key))) {
        summary.rejected++;
        summary.rejectedFingerprint++;
        continue;
      }
      candidate.identityKeys = identities;
      state.eligibleCount++;
      summary.eligible++;
      eligible.push(candidate);
    }
  }
  return eligible;
}

async function publishSelected({
  selected, statesByNiche, store, meli, evolution, sessionAlert, composeCard,
  randomUUID, delay, sendDelayMs, logger, summary, roundId,
}) {
  const alertState = { sent: false };
  for (let index = 0; index < selected.length; index++) {
    const candidate = selected[index];
    const state = statesByNiche.get(candidate.nicheId);
    const context = { roundId, niche: state.niche, categoryId: state.categoryId, offer: candidate };
    const reservationId = randomUUID();
    let reserved;
    try {
      reserved = await store.reserveOffer(candidate.identityKeys, {
        nicheId: candidate.nicheId,
        itemId: candidate.itemId,
        reservationId,
      });
    } catch {
      summary.failed++;
      summary.reservationRejected++;
      summary.skipped++;
      state.outcomes.push("reservation_error");
      fixedLog(logger, "error", eventPayload("collector_offer", context, "reservation_error"));
      continue;
    }
    if (!reserved) {
      summary.reservationRejected++;
      summary.skipped++;
      state.outcomes.push("reservation_rejected");
      fixedLog(logger, "info", eventPayload("collector_offer", context, "reservation_rejected"));
      continue;
    }
    summary.reserved++;

    try {
      await store.savePreview(candidate.nicheId, candidate, "selected");
    } catch {
      summary.failed++;
      summary.review++;
      summary.skipped++;
      state.outcomes.push("preview_error");
      await safeStoreAction(() => store.releaseOffer(reservationId), logger, "reservation_release_failed", context);
      fixedLog(logger, "error", eventPayload("collector_offer", context, "preview_error"));
      continue;
    }

    let affiliateUrl;
    try {
      affiliateUrl = await meli.convert(candidate.permalink, candidate.tag, false);
      if (!validAffiliateUrl(affiliateUrl)) throw Error("affiliate_failed");
    } catch (error) {
      summary.failed++;
      summary.review++;
      summary.skipped++;
      summary.affiliateFailed++;
      if (isSessionFailure(error)) {
        summary.sessionFailed++;
        await alertSessionOnce(sessionAlert, logger, context, alertState);
      }
      await safeStoreAction(() => store.releaseOffer(reservationId), logger, "reservation_release_failed", context);
      await safeStoreAction(() => store.markReview(candidate.nicheId, candidate.itemId), logger, "review_persistence_failed", context);
      state.outcomes.push("affiliate_error");
      fixedLog(logger, "error", eventPayload("collector_offer", context, "affiliate_error"));
      continue;
    }
    if (await restoreSessionIncident(sessionAlert, logger, context)) alertState.sent = false;

    let card;
    try {
      card = await composeCard(candidate);
      if (!Buffer.isBuffer(card) || card.length === 0) throw Error("offer_image_invalid");
    } catch {
      summary.failed++;
      summary.review++;
      summary.skipped++;
      summary.composeFailed++;
      await safeStoreAction(() => store.releaseOffer(reservationId), logger, "reservation_release_failed", context);
      await safeStoreAction(() => store.markReview(candidate.nicheId, candidate.itemId), logger, "review_persistence_failed", context);
      state.outcomes.push("compose_error");
      fixedLog(logger, "error", eventPayload("collector_offer", context, "compose_error"));
      continue;
    }

    let prepared = false;
    try {
      prepared = await store.prepareDelivery(reservationId, candidate.identityKeys);
    } catch {
      summary.failed++;
    }
    if (!prepared) {
      summary.review++;
      summary.reservationRejected++;
      summary.skipped++;
      await safeStoreAction(() => store.releaseOffer(reservationId), logger, "reservation_release_failed", context);
      await safeStoreAction(() => store.markReview(candidate.nicheId, candidate.itemId), logger, "review_persistence_failed", context);
      state.outcomes.push("reservation_rejected");
      fixedLog(logger, "error", eventPayload("collector_offer", context, "reservation_rejected"));
      continue;
    }

    try {
      await evolution.send({
        destination: candidate.destinationGroup,
        text: formatOffer(candidate, affiliateUrl),
        kind: "image",
        mimetype: "image/jpeg",
      }, card.toString("base64"));
      summary.delivered++;
    } catch (error) {
      summary.failed++;
      summary.review++;
      if (error?.message === "media_invalid") {
        summary.composeFailed++;
        summary.skipped++;
        await safeStoreAction(() => store.releaseOffer(reservationId), logger, "reservation_release_failed", context);
        await safeStoreAction(() => store.markReview(candidate.nicheId, candidate.itemId), logger, "review_persistence_failed", context);
        state.outcomes.push("compose_error");
        fixedLog(logger, "error", eventPayload("collector_offer", context, "compose_error"));
        continue;
      }
      summary.deliveryFailed++;
      await quarantineReservation(store, reservationId, logger, context);
      await safeStoreAction(() => store.markReview(candidate.nicheId, candidate.itemId), logger, "review_persistence_failed", context);
      state.outcomes.push("delivery_error");
      fixedLog(logger, "error", eventPayload("collector_offer", context, "delivery_error"));
      continue;
    }

    let finalized = false;
    try {
      finalized = await store.finalizePublication(
        reservationId, candidate.nicheId, candidate.itemId, affiliateUrl,
      );
      if (!finalized) throw Error("finalization_reservation_missing");
    } catch {
      summary.failed++;
      summary.review++;
      summary.finalizationFailed++;
      await quarantineReservation(store, reservationId, logger, context);
      await safeStoreAction(() => store.markReview(candidate.nicheId, candidate.itemId), logger, "review_persistence_failed", context);
      state.outcomes.push("finalization_error");
      fixedLog(logger, "error", eventPayload("collector_offer", context, "finalization_error"));
    }

    if (finalized) {
      summary.published++;
      state.outcomes.push("published");
      fixedLog(logger, "info", eventPayload("collector_offer", context, "published"));
    }
    if (index < selected.length - 1) {
      await safeStoreAction(() => delay(sendDelayMs), logger, "collector_delay_failed", context);
    }
  }
}

function resultFromSummary(summary, dryRun) {
  if (!summary.claimed) return "idle";
  if (summary.published) return "published";
  if (dryRun && summary.eligible) return "simulated";
  if (summary.deliveryFailed) return "delivery_error";
  if (summary.finalizationFailed) return "finalization_error";
  if (summary.composeFailed) return "compose_error";
  if (summary.affiliateFailed) return "affiliate_error";
  if (summary.reservationRejected) return "reservation_rejected";
  return summary.empty ? "empty" : "review";
}

export async function collectDue({
  store, niches, source, authorizedToken, meli, evolution, sessionAlert, dryRun,
  composeCard = composeOfferCard, randomUUID = defaultRandomUUID,
  now = () => new Date(), delay = defaultDelay, sendDelayMs = 15000,
  roundLimit = 10, perNiche = 2, logger = { info() {}, error() {} },
}) {
  const roundId = randomUUID();
  const startedAt = now();
  const summary = emptySummary();
  const states = [];
  const completed = new Set();

  const complete = async (state, result) => {
    if (completed.has(state.niche.id)) return;
    completed.add(state.niche.id);
    await safeStoreAction(
      () => store.completeRun(state.niche.id, result),
      logger,
      "collector_run_completion_failed",
      { roundId, niche: state.niche, categoryId: state.categoryId },
    );
    fixedLog(logger, "info", eventPayload(
      "collector_niche",
      { roundId, niche: state.niche, categoryId: state.categoryId },
      result,
    ));
  };

  try {
    let claimed;
    try {
      claimed = await store.claimDueNiches(niches);
    } catch {
      summary.failed++;
      fixedLog(logger, "error", { event: "collector_claim_failed", roundId });
      return summary;
    }
    summary.claimed = claimed.length;
    for (const claimedNiche of claimed) states.push({
      niche: claimedNiche,
      categoryId: null,
      candidates: [],
      eligibleCount: 0,
      selected: [],
      outcomes: [],
      fixedResult: null,
    });
    if (!claimed.length) return summary;

    let token;
    try {
      token = await authorizedToken();
    } catch {
      for (const state of states) {
        state.fixedResult = "authorization_error";
        summary.failed++;
        await complete(state, state.fixedResult);
      }
      fixedLog(logger, "error", { event: "collector_authorization_failed", roundId });
      return summary;
    }

    let recentIdentityKeys;
    try {
      recentIdentityKeys = await store.recentIdentityKeys(7);
    } catch {
      for (const state of states) {
        state.fixedResult = "history_error";
        summary.failed++;
        await complete(state, state.fixedResult);
      }
      fixedLog(logger, "error", { event: "collector_history_failed", roundId });
      return summary;
    }

    for (const state of states) {
      try {
        state.categoryId = await store.nextCategory(state.niche);
      } catch {
        state.fixedResult = "category_error";
        summary.failed++;
        continue;
      }
      try {
        const found = await source.list(state.categoryId, token);
        if (!Array.isArray(found)) throw Error("source_response_invalid");
        summary.discovered += found.length;
        state.candidates = found.map((candidate) => ({
          ...candidate,
          nicheId: state.niche.id,
          destinationGroup: state.niche.destinationGroup,
          tag: state.niche.tag,
          requestedCategoryId: state.categoryId,
          maxPerRound: state.niche.maxPerRound,
        }));
      } catch {
        state.fixedResult = "source_error";
        summary.failed++;
      }
    }

    const eligible = classifyCandidates(states, recentIdentityKeys, summary);
    const selection = diversifyOfferPool(eligible, { limit: roundLimit, perNiche, recentIds: new Set() });
    const { selected } = selection;
    summary.rejectedDuplicate += selection.rejectedDuplicate.length;
    summary.rejected += selection.rejectedDuplicate.length;
    summary.rejectedQuota += selection.rejectedQuota.length;
    summary.skipped += selection.rejectedDuplicate.length + selection.rejectedQuota.length;
    const statesByNiche = new Map(states.map((state) => [state.niche.id, state]));
    for (const candidate of selected) statesByNiche.get(candidate.nicheId).selected.push(candidate);
    for (const state of states) {
      if (!state.fixedResult && state.selected.length === 0 && state.eligibleCount === 0) summary.empty++;
    }

    if (dryRun) {
      for (const candidate of selected) {
        const state = statesByNiche.get(candidate.nicheId);
        try {
          await store.savePreview(candidate.nicheId, candidate, "simulated");
          state.outcomes.push("simulated");
        } catch {
          summary.failed++;
          summary.review++;
          summary.skipped++;
          state.outcomes.push("preview_error");
          fixedLog(logger, "error", eventPayload(
            "collector_offer",
            { roundId, niche: state.niche, categoryId: state.categoryId, offer: candidate },
            "preview_error",
          ));
        }
      }
    } else {
      await publishSelected({
        selected, statesByNiche, store, meli, evolution, sessionAlert, composeCard,
        randomUUID, delay, sendDelayMs, logger, summary, roundId,
      });
    }

    for (const state of states) await complete(state, finishResult(state, dryRun));
    return summary;
  } finally {
    for (const state of states) {
      if (!completed.has(state.niche.id)) await complete(state, finishResult(state, dryRun));
    }
    await safeStoreAction(
      () => store.recordRound(roundId, summary, startedAt),
      logger,
      "collector_round_persistence_failed",
      { roundId, niche: { id: "round" } },
    );
  }
}

export async function collectOnce(options) {
  const { store, niches } = options;
  if (typeof store.claimDueNiche !== "function") {
    const summary = await collectDue({ ...options, roundLimit: 1, perNiche: 1 });
    return resultFromSummary(summary, options.dryRun);
  }

  const claimed = await store.claimDueNiche(niches);
  if (!claimed) return "idle";
  const proxy = Object.create(store);
  proxy.claimDueNiches = async () => [claimed];
  proxy.nextCategory = async () => claimed.categoryId ?? store.nextCategory(claimed);
  const summary = await collectDue({
    ...options,
    store: proxy,
    niches: [claimed],
    roundLimit: 1,
    perNiche: 1,
  });
  return resultFromSummary(summary, options.dryRun);
}
