import { readFile, writeFile, rename, mkdir, chmod, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseMeliRequest } from "../bot/meli-request-import.mjs";

export async function importRequest({ requestPath, outputPath, removeSource = false }) {
  const source = resolve(requestPath);
  const destination = resolve(outputPath);
  const temporary = `${destination}.tmp`;
  const parsed = parseMeliRequest(await readFile(source, "utf8"));
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
    if (removeSource) await rm(source);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { cookieCount: parsed.cookie.split("; ").length, destination };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
  const [requestPath, outputPath = "secrets/meli-session.json"] = process.argv.slice(2);
  if (!requestPath) throw Error("usage: node scripts/import-meli-request.mjs <request> [output]");
  const result = await importRequest({ requestPath, outputPath });
  console.log(`Sessao importada: ${result.cookieCount} cookies; valores nao exibidos.`);
}
