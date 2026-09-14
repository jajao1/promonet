import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MeliClient } from "../bot/clients.mjs";

export async function probeSession({ url, tag, sessionPath = "secrets/meli-session.json", fetch }) {
  try {
    const session = JSON.parse(await readFile(resolve(sessionPath), "utf8"));
    const affiliateUrl = await new MeliClient({ session, fetch }).convert(url, tag, false);
    return { valid: true, affiliateUrl };
  } catch (error) {
    const known = new Set(["session_expired", "meli_session_missing", "affiliate_response_invalid", "remote_request_failed"]);
    return { valid: false, category: known.has(error?.message) ? error.message : "local_configuration_invalid" };
  }
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
if (invoked) {
  if (process.env.DRY_RUN !== "true") throw Error("probe_requires_DRY_RUN_true");
  const url = argument("url"), tag = argument("tag");
  if (!url || !tag) throw Error("usage: --url <product-url> --tag <tag>");
  console.log(JSON.stringify(await probeSession({ url, tag })));
}
