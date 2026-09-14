import { createHash, timingSafeEqual } from "node:crypto";
import { extractJobs, processJob } from "./core.mjs";
export class Store {
  constructor(db) {
    this.db = db;
  }
  async init() {
    await this.db.query(`CREATE SCHEMA IF NOT EXISTS promonet;
 CREATE TABLE IF NOT EXISTS promonet.jobs (
 id BIGSERIAL PRIMARY KEY, message_id TEXT NOT NULL, source_group TEXT NOT NULL,
 destination_group TEXT NOT NULL, day DATE NOT NULL DEFAULT CURRENT_DATE,
 fingerprint TEXT NOT NULL, payload JSONB, status TEXT NOT NULL DEFAULT 'queued',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(message_id,source_group,destination_group),UNIQUE(destination_group,day,fingerprint));
 CREATE INDEX IF NOT EXISTS promonet_jobs_status ON promonet.jobs(status,id);
 CREATE TABLE IF NOT EXISTS promonet.tags(tag TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'review',created_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  }
  async begin(tag) {
    const result = await this.db.query(
      `INSERT INTO promonet.tags(tag) VALUES($1) ON CONFLICT DO NOTHING RETURNING tag`,
      [tag],
    );
    if (result.rows.length) return "new";
    const existing = await this.db.query(
      "SELECT status FROM promonet.tags WHERE tag=$1",
      [tag],
    );
    return existing.rows[0]?.status === "ready" ? "ready" : "review";
  }
  async confirm(tag) {
    await this.db.query(
      "UPDATE promonet.tags SET status='ready' WHERE tag=$1",
      [tag],
    );
  }
  async enqueue(jobs) {
    for (const job of jobs) {
      const fingerprint = createHash("sha256")
        .update(job.kind + "\n" + job.text)
        .digest("hex");
      await this.db.query(
        `INSERT INTO promonet.jobs(message_id,source_group,destination_group,payload,fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [job.id, job.source, job.destination, JSON.stringify(job), fingerprint],
      );
    }
  }
  async claim() {
    const result = await this.db.query(
      `UPDATE promonet.jobs SET status='processing',updated_at=now() WHERE id=(SELECT id FROM promonet.jobs WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,payload`,
    );
    return result.rows[0] ?? null;
  }
  async state(id, state) {
    await this.db.query(
      `UPDATE promonet.jobs SET status=$2,updated_at=now(),payload=CASE WHEN $2 IN ('sent','simulated') THEN NULL ELSE payload END WHERE id=$1`,
      [id, state],
    );
  }
  async recover() {
    await this.db.query(
      `UPDATE promonet.jobs SET status='review',updated_at=now() WHERE status IN ('processing','sending')`,
    );
  }
  async prune() {
    await this.db.query(
      `UPDATE promonet.jobs SET payload=NULL WHERE payload IS NOT NULL AND created_at < now()-interval '7 days'; DELETE FROM promonet.jobs WHERE created_at < now()-interval '30 days'`,
    );
  }
}
export async function workOnce(store, clients) {
  const row = await store.claim();
  if (!row) return false;
  try {
    const job = row.payload;
    if (
      !clients.routes?.some(
        (route) =>
          route.sourceGroup === job?.source &&
          route.destinationGroup === job.destination &&
          route.tag === job.tag &&
          route.createTag === job.createTag,
      )
    )
      throw Error("route_no_longer_authorized");
    const state = await processJob(row.payload, {
      ...clients,
      beforeSend: () => store.state(row.id, "sending"),
    });
    await store.state(row.id, state);
  } catch {
    await store.state(row.id, "review");
    console.warn(JSON.stringify({ event: "job_review", id: row.id }));
  }
  return true;
}
export function webhookHandler({
  secret,
  routes,
  instance,
  store,
  dryRun = true,
}) {
  const expected = Buffer.from(secret);
  return async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/health" && req.method === "GET")
      return reply(200, { status: "ok" });
    if (req.url !== "/webhooks/evolution" || req.method !== "POST")
      return reply(404, { error: "not_found" });
    const supplied = Buffer.from(
      typeof req.headers["x-webhook-secret"] === "string"
        ? req.headers["x-webhook-secret"]
        : "",
    );
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return reply(401, { error: "unauthorized" });
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024) return reply(413, { error: "too_large" });
        chunks.push(chunk);
      }
      let event;
      try {
        event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(400, { error: "invalid_json" });
      }
      const jobs = extractJobs(event, routes, instance, dryRun);
      await store.enqueue(jobs);
      reply(202, { accepted: jobs.length });
    } catch {
      reply(503, { error: "unavailable" });
    }
  };
}
