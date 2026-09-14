import test from "node:test";
import assert from "node:assert/strict";
import { parseMeliRequest } from "../meli-request-import.mjs";

const fixture = `$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.UserAgent = "Mozilla/5.0 TestBrowser/1.0"
$session.Cookies.Add((New-Object System.Net.Cookie("ssid", "session-value", "/", ".mercadolivre.com.br")))
$session.Cookies.Add((New-Object System.Net.Cookie("_csrf", "cookie-csrf", "/", ".mercadolivre.com.br")))
Invoke-WebRequest -UseBasicParsing -Uri "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink" -Method "POST" -WebSession $session -Headers @{"x-csrf-token"="header-csrf"; "Origin"="https://www.mercadolivre.com.br"; "Referer"="https://www.mercadolivre.com.br/afiliados/linkbuilder"; "sec-ch-ua"="\`"Chromium\`";v=\`"140\`""} -ContentType "application/json" -Body "{\`"urls\`":[\`"https://www.mercadolivre.com.br/p/MLB123\`"],\`"tag\`":\`"vijo3432338\`"}"`;

test("parses one exact createLink PowerShell request without executing it", () => {
  assert.deepEqual(parseMeliRequest(fixture, { now: () => new Date("2026-09-06T12:00:00Z") }), {
    version: 1,
    cookie: "ssid=session-value; _csrf=cookie-csrf",
    csrfToken: "header-csrf",
    origin: "https://www.mercadolivre.com.br",
    referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
    browserHeaders: { "sec-ch-ua": '"Chromium";v="140"', "user-agent": "Mozilla/5.0 TestBrowser/1.0" },
    importedAt: "2026-09-06T12:00:00.000Z",
  });
});

test("rejects ambiguous or executable request text", () => {
  for (const value of [fixture + "\n" + fixture, fixture + "\n$(whoami)", fixture.replace('createLink\" -Method \"POST', 'createLink\" -Method \"GET'), fixture.replace("www.mercadolivre.com.br/affiliate-program", "evil.example/affiliate-program")]) {
    assert.throws(() => parseMeliRequest(value), /request_import_invalid/);
  }
});

test("rejects missing secrets and untrusted origin or referer", () => {
  for (const value of [fixture.replace('"x-csrf-token"="header-csrf"; ', ""), fixture.replace(/^\$session\.Cookies\.Add.*$/gm, ""), fixture.replace('"Origin"="https://www.mercadolivre.com.br"', '"Origin"="https://evil.example"'), fixture.replace("/afiliados/linkbuilder", "/minha-conta")]) {
    assert.throws(() => parseMeliRequest(value), /request_import_invalid/);
  }
});
