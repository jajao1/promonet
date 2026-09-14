export function validateRoutes(config) {
  if (!Array.isArray(config.routes)) throw Error("invalid_routes");
  const destinations = new Set(config.routes.map((r) => r.destinationGroup));
  const pairs = new Set();
  const tags = new Map();
  for (const r of config.routes) {
    const pair = r.sourceGroup + ":" + r.destinationGroup;
    if (
      !/^[\w-]+@g\.us$/.test(r.sourceGroup) ||
      !/^[\w-]+@g\.us$/.test(r.destinationGroup) ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(r.tag) ||
      typeof r.createTag !== "boolean" ||
      destinations.has(r.sourceGroup) ||
      pairs.has(pair)
    )
      throw Error("invalid_route");
    pairs.add(pair);
    if (tags.has(r.destinationGroup) && tags.get(r.destinationGroup) !== r.tag)
      throw Error("conflicting_destination_tag");
    tags.set(r.destinationGroup, r.tag);
  }
  return config.routes;
}
function bytes32(value) {
  if (
    value?.type === "Buffer" &&
    Array.isArray(value.data) &&
    value.data.length === 32 &&
    value.data.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  )
    return Buffer.from(value.data).toString("base64");
  if (typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value))
    return value;
  throw Error("invalid_media_bytes");
}
function numericValue(value) {
  if (
    value &&
    typeof value === "object" &&
    Number.isInteger(value.low) &&
    value.low >= 0 &&
    value.high === 0
  )
    return value.low;
  return Number(value);
}
function imageTransport(image) {
  const url = new URL(image.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === "mmg.whatsapp.net" ||
      url.hostname === "mmg-fna.whatsapp.net"
    )
  )
    throw Error("invalid_media_url");
  const result = {
    url: url.href,
    mimetype: image.mimetype,
    mediaKey: bytes32(image.mediaKey),
  };
  if (image.directPath !== undefined) {
    if (
      typeof image.directPath !== "string" ||
      !image.directPath.startsWith("/") ||
      image.directPath.startsWith("//") ||
      image.directPath.length > 4096
    )
      throw Error("invalid_media_path");
    result.directPath = image.directPath;
  }
  for (const field of ["fileSha256", "fileEncSha256"])
    if (image[field] !== undefined) result[field] = bytes32(image[field]);
  if (image.mediaKeyTimestamp !== undefined) {
    const timestamp = Number(image.mediaKeyTimestamp);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
      throw Error("invalid_media_timestamp");
    result.mediaKeyTimestamp = timestamp;
  }
  if (image.fileLength !== undefined) {
    const size = numericValue(image.fileLength);
    if (!Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 * 1024)
      throw Error("invalid_media_size");
    result.fileLength = size;
  }
  return result;
}
export function extractJobs(event, routes, instance, dryRun = true) {
  if (event?.event !== "messages.upsert" || event.instance !== instance)
    return [];
  const data = event.data,
    key = data?.key,
    message = data?.message;
  if (
    !key?.id ||
    typeof key.id !== "string" ||
    key.id.length > 256 ||
    key.fromMe !== false ||
    routes.some((r) => r.destinationGroup === key.remoteJid)
  )
    return [];
  const allowed = routes.filter((r) => r.sourceGroup === key.remoteJid);
  if (!allowed.length) return [];
  const image = message?.imageMessage;
  const text =
    image?.caption ??
    message?.conversation ??
    message?.extendedTextMessage?.text;
  if (
    typeof text !== "string" ||
    text.length > 16000 ||
    !text.match(/https?:\/\//i)
  )
    return [];
  if (
    image &&
    !["image/jpeg", "image/png", "image/webp"].includes(image.mimetype)
  )
    return [];
  let imageMessage;
  if (image) {
    try {
      imageMessage = imageTransport(image);
    } catch {
      return [];
    }
  }
  return allowed.map((route) => ({
    id: key.id,
    source: key.remoteJid,
    destination: route.destinationGroup,
    tag: route.tag,
    createTag: route.createTag,
    text,
    kind: image ? "image" : "text",
    intakeDryRun: dryRun !== false,
    ...(image
      ? {
          mimetype: image.mimetype,
          imageMessage,
          key: {
            id: key.id,
            remoteJid: key.remoteJid,
            fromMe: false,
            ...(typeof key.participant === "string"
              ? { participant: key.participant }
              : {}),
          },
        }
      : {}),
  }));
}
export function marketplaceUrl(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !(
      u.hostname === "meli.la" ||
      u.hostname === "mercadolivre.com.br" ||
      u.hostname.endsWith(".mercadolivre.com.br")
    )
  )
    throw Error("unsupported_url");
  return u;
}
export async function processJob(
  job,
  { dryRun = true, meli, evolution, beforeSend = async () => {} },
) {
  if (typeof job.intakeDryRun !== "boolean") throw Error("intake_mode_unknown");
  const links = [...job.text.matchAll(/https?:\/\/[^\s<>]+/gi)].map((m) =>
    m[0].replace(/[.,!;:?)\]}]+$/g, ""),
  );
  if (!links.length) throw Error("no_links");
  for (const link of links) marketplaceUrl(link);
  if (dryRun || job.intakeDryRun) return "simulated";
  const replacements = new Map();
  for (const link of new Set(links))
    replacements.set(link, await meli.convert(link, job.tag, job.createTag));
  const text = job.text.replace(/https?:\/\/[^\s<>]+/gi, (raw) => {
    const link = raw.replace(/[.,!;:?)\]}]+$/g, "");
    return replacements.get(link) + raw.slice(link.length);
  });
  const media = job.kind === "image" ? await evolution.media(job) : undefined;
  await beforeSend();
  await evolution.send({ ...job, text }, media);
  return "sent";
}
