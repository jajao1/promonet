const APPROVED_TIME_ZONE = "America/Sao_Paulo";
const APPROVED_START_HOUR = 7;
const APPROVED_END_HOUR = 23;
const DEFAULT_ADMIN_WHATSAPP = "5543991724961";

function integerSetting(env, name, fallback, minimum, maximum) {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (
    (raw !== undefined && !/^\d+$/.test(raw)) ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) throw Error("configuration_required");
  return value;
}

function timeZoneSetting(value = APPROVED_TIME_ZONE) {
  if (typeof value !== "string" || value.length === 0) throw Error("configuration_required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw Error("configuration_required");
  }
  if (value !== APPROVED_TIME_ZONE) throw Error("configuration_required");
  return value;
}

function containerPathSetting(value = "/app/site/logo.jpg") {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) {
    throw Error("configuration_required");
  }
  return value;
}

export function parseCollectorConfig(env) {
  const startHour = integerSetting(env, "COLLECTOR_START_HOUR", APPROVED_START_HOUR, 0, 23);
  const endHour = integerSetting(env, "COLLECTOR_END_HOUR", APPROVED_END_HOUR, 1, 24);
  if (startHour !== APPROVED_START_HOUR || endHour !== APPROVED_END_HOUR) {
    throw Error("configuration_required");
  }

  const adminWhatsapp = env.ADMIN_WHATSAPP || DEFAULT_ADMIN_WHATSAPP;
  if (!/^\d{10,15}$/.test(adminWhatsapp)) {
    throw Error("configuration_required");
  }

  return {
    intervalMs: integerSetting(env, "COLLECTOR_INTERVAL_MINUTES", 20, 5, 1440) * 60 * 1_000,
    timeZone: timeZoneSetting(env.COLLECTOR_TIME_ZONE),
    startHour,
    endHour,
    roundLimit: integerSetting(env, "COLLECTOR_ROUND_LIMIT", 10, 1, 10),
    maxPerNiche: integerSetting(env, "COLLECTOR_MAX_PER_NICHE", 1, 1, 2),
    dedupDays: integerSetting(env, "COLLECTOR_DEDUP_DAYS", 7, 1, 30),
    logoPath: containerPathSetting(env.OFFER_CARD_LOGO_PATH),
    sendDelayMs: integerSetting(env, "COLLECTOR_SEND_DELAY_MS", 15_000, 1_000, 60_000),
    adminWhatsapp,
  };
}

export function createCollectorSessionAlert({
  enabled,
  dryRun,
  SessionAlert,
  evolution,
  incidents,
  destination,
}) {
  if (!enabled || dryRun) return null;
  return new SessionAlert({ evolution, incidents, destination });
}

export function createCollectorLoopOptions({
  config,
  signal,
  collectDue,
  composeOfferCard,
  store,
  niches,
  source,
  authorizedToken,
  meli,
  evolution,
  sessionAlert,
  dryRun,
  logger,
}) {
  return {
    enabled: true,
    intervalMs: config.intervalMs,
    window: {
      timeZone: config.timeZone,
      startHour: config.startHour,
      endHour: config.endHour,
    },
    signal,
    collect: () => collectDue({
      store,
      niches,
      source,
      authorizedToken,
      meli,
      evolution,
      sessionAlert,
      dryRun,
      composeCard: offer => composeOfferCard(offer, { logoPath: config.logoPath }),
      sendDelayMs: config.sendDelayMs,
      roundLimit: config.roundLimit,
      perNiche: config.maxPerNiche,
      retentionDays: config.dedupDays,
      logger,
    }),
  };
}
