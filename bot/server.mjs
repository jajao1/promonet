import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { validateRoutes } from "./core.mjs";
import { MeliClient, MeliBridgeClient, EvolutionClient } from "./clients.mjs";
import { Store, webhookHandler, workOnce } from "./runtime.mjs";
import { OAuthStateStore } from "./oauth-state.mjs";
import { TokenStore } from "./token-store.mjs";
import { MeliOAuthClient } from "./meli-oauth.mjs";
import { authorizedToken } from "./meli-oauth.mjs";
import { meliOAuthHandler } from "./oauth-handler.mjs";
import { createRequestHandler } from "./http-router.mjs";
import { validateNiches } from "./niches.mjs";
import { OfficialOfferSource } from "./offer-source.mjs";
import { CollectorStore } from "./collector-store.mjs";
import { collectDue } from "./collector.mjs";
import { runCollectorLoop } from "./collector-runtime.mjs";
import { PublicOffersStore } from "./public-offers-store.mjs";
import { publicSiteHandler } from "./public-site-handler.mjs";
import { SessionAlert } from "./session-alert.mjs";
async function main() {
  const env = process.env;
  const dryRun = env.DRY_RUN !== "false";
  if (
    !env.DATABASE_URL ||
    !env.WEBHOOK_SECRET ||
    env.WEBHOOK_SECRET.length < 32 ||
    !env.EVOLUTION_INSTANCE
  )
    throw Error("configuration_required");
  if (!dryRun && (!env.EVOLUTION_URL || !env.EVOLUTION_API_KEY))
    throw Error("configuration_required");
  const oauthEnabled = env.MELI_OAUTH_ENABLED === "true";
  const collectorEnabled = env.COLLECTOR_ENABLED === "true";
  const collectorSendDelayMs = Number(env.COLLECTOR_SEND_DELAY_MS ?? 15000);
  if (!Number.isInteger(collectorSendDelayMs) || collectorSendDelayMs < 1000 || collectorSendDelayMs > 60000)
    throw Error("configuration_required");
  if (oauthEnabled && (!env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET || !env.MELI_REDIRECT_URI))
    throw Error("configuration_required");
  if (collectorEnabled && (!env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET || !env.MELI_REDIRECT_URI))
    throw Error("configuration_required");
  const routes = validateRoutes(
    JSON.parse(
      await readFile(env.CONFIG_PATH ?? "/app/config/routes.json", "utf8"),
    ),
  );
  const niches = collectorEnabled ? validateNiches(JSON.parse(await readFile(env.NICHES_CONFIG_PATH ?? "/app/config/niches.json","utf8"))) : [];
  const bridgeKey = env.MELI_BRIDGE_KEY || (env.MELI_BRIDGE_KEY_PATH
    ? await readFile(env.MELI_BRIDGE_KEY_PATH, "utf8").then((value) => value.trim()).catch(() => null)
    : null);
  const bridgeEnabled = Boolean(env.MELI_BRIDGE_URL && bridgeKey);
  const session = dryRun || bridgeEnabled
    ? null
    : JSON.parse(
        await readFile(
          env.MELI_SESSION_PATH ?? "/run/secrets/meli-session.json",
          "utf8",
        ),
      );
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 10000,
  });
  // A dedicated connection holds a singleton lock: recovery cannot race another worker.
  const lock = await pool.connect();
  const result = await lock.query(
    "SELECT pg_try_advisory_lock(734802941) AS locked",
  );
  if (!result.rows[0].locked) throw Error("worker_already_running");
  const store = new Store(pool);
  await store.init();
  await store.recover();
  await store.prune();
  const clients = {
    dryRun,
    routes,
    meli: bridgeEnabled
      ? new MeliBridgeClient({ url: env.MELI_BRIDGE_URL, key: bridgeKey })
      : new MeliClient({ session, tags: store }),
    evolution: dryRun
      ? null
      : new EvolutionClient({
          url: env.EVOLUTION_URL,
          apiKey: env.EVOLUTION_API_KEY,
          instance: env.EVOLUTION_INSTANCE,
        }),
  };
  const oauthClient = (oauthEnabled || collectorEnabled) ? new MeliOAuthClient({ clientId: env.MELI_CLIENT_ID, clientSecret: env.MELI_CLIENT_SECRET, redirectUri: env.MELI_REDIRECT_URI }) : null;
  const tokenStore = (oauthEnabled || collectorEnabled) ? new TokenStore(env.MELI_OAUTH_TOKEN_PATH ?? "/run/secrets-write/meli-oauth.json") : null;
  let running = true;
  const webhook = webhookHandler({
      dryRun,
      secret: env.WEBHOOK_SECRET,
      routes,
      instance: env.EVOLUTION_INSTANCE,
      store,
    });
  const oauthHandler = oauthEnabled
    ? meliOAuthHandler({
        states: new OAuthStateStore(),
        oauth: oauthClient,
        tokens: tokenStore,
    })
    : null;
  const publicOffers = new PublicOffersStore(pool);
  await publicOffers.init();
  const collectorStore = collectorEnabled ? new CollectorStore(pool) : null;
  if (collectorStore) await collectorStore.init();
  const sessionAlert = collectorStore && !dryRun && env.ADMIN_WHATSAPP
    ? new SessionAlert({ evolution: clients.evolution, destination: env.ADMIN_WHATSAPP, incidents: collectorStore })
    : null;
  const site = publicSiteHandler({ store: publicOffers, siteConfig: { whatsAppGroupUrl: env.WHATSAPP_GROUP_URL ?? "" } });
  const server = createServer(createRequestHandler({ oauth: oauthHandler, site, webhook }));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  server.listen(Number(env.PORT ?? 3000), "0.0.0.0");
  console.log(
    JSON.stringify({ event: "ready", dryRun, routes: routes.length, collectorEnabled }),
  );
  const collectorController = new AbortController();
  let collectorLoop = Promise.resolve();
  if (collectorEnabled) {
    const source = new OfficialOfferSource();
    const collectorLogger = { info: data => console.log(JSON.stringify(data)), error: data => console.error(JSON.stringify(data)) };
    collectorLoop = runCollectorLoop({ enabled: true, collect: () => collectDue({ store: collectorStore, niches, source, authorizedToken: () => authorizedToken({ oauth: oauthClient, tokens: tokenStore }), meli: clients.meli, evolution: clients.evolution, sessionAlert, dryRun, sendDelayMs: collectorSendDelayMs, logger: collectorLogger }), signal: collectorController.signal });
  }
  const stop = () => {
    running = false;
    collectorController.abort();
    server.close();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  while (running) {
    try {
      if (!(await workOnce(store, clients))) await delay(1000);
    } catch {
      console.error('{"event":"worker_unavailable"}');
      await delay(5000);
    }
  }
  await collectorLoop;
  lock.release();
  await pool.end();
}
main().catch((error) => {
  console.error(JSON.stringify({
    event: "startup_failed",
    reason: error instanceof Error ? error.message : "unknown",
  }));
  process.exitCode = 1;
});
