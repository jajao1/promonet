import { marketplaceUrl } from "./core.mjs";
const MAX_EVOLUTION_MEDIA_ENVELOPE_BYTES = 7 * 1024 * 1024;
const MAX_EVOLUTION_JPEG_BYTES = Math.floor(MAX_EVOLUTION_MEDIA_ENVELOPE_BYTES * 3 / 4);

function validateJpegBase64(media) {
  if (
    typeof media !== "string" ||
    media.length === 0 ||
    media.length > MAX_EVOLUTION_MEDIA_ENVELOPE_BYTES ||
    media.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(media)
  ) throw Error("media_invalid");
  const decoded = Buffer.from(media, "base64");
  if (
    decoded.length < 4 || decoded.length > MAX_EVOLUTION_JPEG_BYTES ||
    decoded.toString("base64") !== media ||
    decoded[0] !== 0xff || decoded[1] !== 0xd8 ||
    decoded.at(-2) !== 0xff || decoded.at(-1) !== 0xd9
  ) throw Error("media_invalid");
}

const PRESERVED_REQUEST_ERRORS = new Set([
  "session_expired",
  "meli_bridge_unauthorized",
  "meli_bridge_configuration",
  "meli_bridge_remote",
]);

async function boundedJson(response, max) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) throw Error("size");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function jsonRequest(fetch, url, body, headers, max = 1024 * 1024, classifyResponse) {
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!classifyResponse && [301, 302, 303, 307, 308, 401, 403].includes(response.status))
      throw Error("session_expired");
    if (classifyResponse) {
      const data = await boundedJson(response, max);
      const category = classifyResponse(response, data);
      if (category) throw Error(category);
      if (!response.ok) throw Error("http");
      return data;
    }
    if (!response.ok) throw Error("http");
    return await boundedJson(response, max);
  } catch (error) {
    if (PRESERVED_REQUEST_ERRORS.has(error?.message)) throw error;
    throw Error("remote_request_failed");
  }
}

function bridgeResponseError(response, data) {
  const category = data?.valid === false ? data.category : null;
  if (category === "session_expired") return "session_expired";
  if (category === "unauthorized") return "meli_bridge_unauthorized";
  if (["configuration", "request_invalid", "not_found"].includes(category))
    return "meli_bridge_configuration";
  if ([
    "remote", "remote_request_failed", "affiliate_source_invalid",
    "affiliate_response_invalid", "bridge_failed",
  ].includes(category)) return "meli_bridge_remote";
  return response.ok ? null : "meli_bridge_remote";
}
export class MeliClient {
  constructor({ session, tags, fetch = globalThis.fetch }) {
    this.session = session;
    this.tags = tags;
    this.fetch = fetch;
  }
  async convert(url, tag, createTag) {
    marketplaceUrl(url);
    if (!this.session?.cookie || !this.session.csrfToken ||
        this.session.origin !== "https://www.mercadolivre.com.br" ||
        !this.session.referer)
      throw Error("meli_session_missing");
    const browserHeaders = this.session.browserHeaders ?? {};
    if (Object.keys(browserHeaders).some((name) => !/^(?:accept|accept-language|cache-control|pragma|priority|sec-ch-ua|sec-ch-ua-mobile|sec-ch-ua-model|sec-ch-ua-platform|sec-ch-ua-platform-version|sec-fetch-dest|sec-fetch-mode|sec-fetch-site|sec-gpc|user-agent)$/.test(name)))
      throw Error("meli_session_missing");
    if (createTag) {
      if (!this.tags) throw Error("tag_store_required");
      const state = await this.tags.begin(tag);
      if (state === "review") throw Error("tag_needs_review");
      if (state === "new") {
        const result = await jsonRequest(
          this.fetch,
          "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createTag",
          { tag },
          {
            ...browserHeaders,
            cookie: this.session.cookie,
            "x-csrf-token": this.session.csrfToken,
            origin: this.session.origin,
            referer: this.session.referer,
          },
        );
        // Conservative acceptance contract, not yet verified against a real account.
        if (result.status !== 200 || result.tag !== tag || result.error)
          throw Error("tag_response_unverified");
        await this.tags.confirm(tag);
      }
    }
    const data = await jsonRequest(
      this.fetch,
      "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink",
      { urls: [url], tag },
      {
        ...browserHeaders,
        cookie: this.session.cookie,
        "x-csrf-token": this.session.csrfToken,
        origin: this.session.origin,
        referer: this.session.referer,
      },
    );
    const entry = data.urls?.[0];
    if (
      data.status !== 200 ||
      data.total_success !== 1 ||
      data.total_error !== 0 ||
      data.urls?.length !== 1 ||
      entry?.created !== true ||
      typeof entry.origin_url !== "string" ||
      entry.origin_url.split("#")[0] !== url.split("#")[0] ||
      entry.tag !== tag ||
      typeof entry.short_url !== "string"
    )
      throw Error("affiliate_response_invalid");
    const parsed = marketplaceUrl(entry.short_url);
    if (parsed.hostname !== "meli.la")
      throw Error("affiliate_response_invalid");
    return entry.short_url;
  }
}
export class MeliBridgeClient {
  constructor({ url, key, fetch = globalThis.fetch }) {
    if (!url || !key) throw Error("meli_bridge_configuration_required");
    this.url = url.replace(/\/$/, "");
    this.key = key;
    this.fetch = fetch;
  }
  async convert(url, tag, createTag) {
    marketplaceUrl(url);
    if (createTag) throw Error("tag_creation_not_supported");
    const data = await jsonRequest(
      this.fetch,
      `${this.url}/convert`,
      { url, tag },
      { authorization: `Bearer ${this.key}` },
      64 * 1024,
      bridgeResponseError,
    );
    if (data?.valid !== true || typeof data.affiliateUrl !== "string") throw Error("affiliate_response_invalid");
    const parsed = marketplaceUrl(data.affiliateUrl);
    if (parsed.hostname !== "meli.la") throw Error("affiliate_response_invalid");
    return data.affiliateUrl;
  }
}
export class EvolutionClient {
  constructor({ url, apiKey, instance, fetch = globalThis.fetch }) {
    this.url = url.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.instance = encodeURIComponent(instance);
    this.fetch = fetch;
  }
  request(path, body, max) {
    return jsonRequest(
      this.fetch,
      `${this.url}/${path}/${this.instance}`,
      body,
      { apikey: this.apiKey },
      max,
    );
  }
  async media(job) {
    const result = await this.request(
      "chat/getBase64FromMediaMessage",
      {
        message: { key: job.key, message: { imageMessage: job.imageMessage } },
        convertToMp4: false,
      },
      8 * 1024 * 1024,
    );
    if (
      typeof result.base64 !== "string" ||
      result.base64.length > 7 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result.base64)
    )
      throw Error("media_invalid");
    return result.base64;
  }
  async send(job, media) {
    if (job.kind === "image") {
      if (job.mimetype !== "image/jpeg") throw Error("media_invalid");
      validateJpegBase64(media);
    }
    const body =
      job.kind === "image"
        ? {
            number: job.destination,
            mediatype: "image",
            mimetype: job.mimetype,
            caption: job.text,
            media,
          }
        : { number: job.destination, text: job.text };
    if (job.kind === "image" && Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_EVOLUTION_MEDIA_ENVELOPE_BYTES) {
      throw Error("media_invalid");
    }
    const result = await this.request(
      job.kind === "image" ? "message/sendMedia" : "message/sendText",
      body,
    );
    if (!result.key?.id) throw Error("send_acknowledgement_missing");
    return { key: { id: result.key.id } };
  }
}
