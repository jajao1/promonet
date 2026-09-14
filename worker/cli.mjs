import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import { chromium } from "playwright";
import { ConversionStore } from "./store.mjs";
import { AffiliatePage } from "./affiliate-page.mjs";
import { AffiliateWorker } from "./worker.mjs";
import { resolveSourceUrl } from "./url-policy.mjs";

export function parseCommand(args) {
  const [name, first, second, ...rest] = args;
  if (rest.length) throw Error("invalid_command");
  if (["run", "status"].includes(name) && first === undefined) return { name };
  if (name === "enqueue" && first && second) return { name, sourceId: first, url: second };
  if (["confirm", "reject"].includes(name) && /^\d+$/.test(first ?? "") && second === undefined) return { name, id: Number(first) };
  throw Error("invalid_command");
}

export function browserSettings(env) {
  return {
    channel: env.PLAYWRIGHT_CHANNEL ?? "msedge",
    profile: resolve(env.PLAYWRIGHT_PROFILE_PATH ?? "./secrets/edge-profile"),
    headless: false,
  };
}

function settings(env) {
  const password = env.POSTGRES_PASSWORD;
  const databaseUrl = env.WORKER_DATABASE_URL ?? (password ? `postgresql://promonet:${encodeURIComponent(password)}@127.0.0.1:${env.POSTGRES_PORT ?? 5433}/promonet` : null);
  const tag = env.AFFILIATE_TAG ?? "vijo3432338";
  const generatorUrl = env.AFFILIATE_GENERATOR_URL ?? "https://www.mercadolivre.com.br/afiliados/linkbuilder";
  const browser = browserSettings(env);
  if (!databaseUrl) throw Error("configuration_required");
  return { databaseUrl, tag, generatorUrl, ...browser };
}

async function execute(command, env = process.env) {
  const config = settings(env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 10_000 });
  const store = new ConversionStore(pool);
  await store.init();
  try {
    if (command.name === "enqueue") {
      const url = await resolveSourceUrl(command.url);
      console.log(JSON.stringify({ queued: true, id: await store.enqueue({ sourceId: command.sourceId, url, tag: config.tag }) }));
    } else if (command.name === "confirm") {
      await store.confirm(command.id); console.log(JSON.stringify({ confirmed: true, id: command.id }));
    } else if (command.name === "reject") {
      await store.reject(command.id); console.log(JSON.stringify({ rejected: true, id: command.id }));
    } else if (command.name === "status") {
      console.log(JSON.stringify(await store.status()));
    } else {
      await store.recover();
      await mkdir(config.profile, { recursive: true });
      const context = await chromium.launchPersistentContext(config.profile, { headless: config.headless, channel: config.channel });
      const page = context.pages()[0] ?? await context.newPage();
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await page.goto(config.generatorUrl, { waitUntil: "domcontentloaded" });
        await input.question("Conclua o login ou QR no navegador e pressione Enter aqui. ");
        const result = await new AffiliateWorker({ store, page: new AffiliatePage(page, { generatorUrl: config.generatorUrl }) }).once();
        console.log(JSON.stringify(result));
        if (result.state === "awaiting_confirmation") {
          const answer = await input.question("Confirmar este link? [s/N] ");
          if (answer.trim().toLowerCase() === "s") await store.confirm(result.id); else await store.reject(result.id);
          console.log(JSON.stringify({ id: result.id, state: answer.trim().toLowerCase() === "s" ? "confirmed" : "review" }));
        }
      } finally { input.close(); await context.close(); }
    }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { loadEnvFile(); await execute(parseCommand(process.argv.slice(2))); }
  catch (error) { console.error(JSON.stringify({ error: ["invalid_command", "configuration_required", "ineligible_url"].includes(error?.message) ? error.message : "worker_failed" })); process.exitCode = 1; }
}
