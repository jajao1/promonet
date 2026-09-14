import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importRequest } from "../../scripts/import-meli-request.mjs";

const request = `$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.Cookies.Add((New-Object System.Net.Cookie("ssid", "value", "/", ".mercadolivre.com.br")))
Invoke-WebRequest -Uri "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink" -Method "POST" -Headers @{ "x-csrf-token"="csrf"; "Origin"="https://www.mercadolivre.com.br"; "Referer"="https://www.mercadolivre.com.br/afiliados/linkbuilder" } -Body "{\`"urls\`":[\`"https://meli.la/a\`"],\`"tag\`":\`"tag\`"}"`;

test("imports atomically without exposing cookie values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meli-import-"));
  const source = join(dir, "request.txt"), output = join(dir, "session.json");
  await writeFile(source, request);
  const result = await importRequest({ requestPath: source, outputPath: output });
  const saved = JSON.parse(await readFile(output, "utf8"));
  assert.equal(saved.cookie, "ssid=value");
  assert.equal(result.cookieCount, 1);
});

test("invalid input preserves the previous session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meli-import-"));
  const source = join(dir, "request.txt"), output = join(dir, "session.json");
  await writeFile(source, "malicious");
  await writeFile(output, "old");
  await assert.rejects(() => importRequest({ requestPath: source, outputPath: output }));
  assert.equal(await readFile(output, "utf8"), "old");
});
