function reply(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

export function meliOAuthHandler({ states, oauth, tokens, logger = console }) {
  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/oauth/mercadolivre/start") {
      const state = states.issue();
      reply(res, 302, "", { location: oauth.authorizationUrl(state) });
      return true;
    }
    if (req.method !== "GET" || url.pathname !== "/oauth/mercadolivre/callback") return false;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.has("error") || !code || !state || !states.consume(state)) {
      reply(res, 400, "Autorização inválida ou expirada.");
      return true;
    }
    try {
      const record = await oauth.exchange(code);
      const identity = await oauth.identity(record.accessToken);
      await tokens.save({ ...record, userId: identity.id });
      logger.info?.(JSON.stringify({ event: "meli_oauth_authorized", userId: identity.id }));
      reply(res, 200, "Autorização concluída. Você pode fechar esta janela.");
    } catch {
      logger.error?.('{"event":"meli_oauth_failed"}');
      reply(res, 502, "Não foi possível concluir a autorização.");
    }
    return true;
  };
}
