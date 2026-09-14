const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

async function responseJson(response) {
  if (!response.ok) throw Error("oauth_remote_failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 1024 * 1024) throw Error("oauth_response_invalid");
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Error("oauth_response_invalid"); }
}

function normalized(data, now) {
  if (
    typeof data?.access_token !== "string" || !data.access_token ||
    typeof data?.refresh_token !== "string" || !data.refresh_token ||
    !Number.isFinite(data?.expires_in) || data.expires_in <= 0 ||
    !["string", "number"].includes(typeof data?.user_id)
  ) throw Error("oauth_response_invalid");
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: now() + data.expires_in * 1000, userId: data.user_id };
}

export class MeliOAuthClient {
  constructor({ clientId, clientSecret, redirectUri, fetch = globalThis.fetch, now = Date.now }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.fetch = fetch;
    this.now = now;
  }

  authorizationUrl(state) {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({ response_type: "code", client_id: this.clientId, redirect_uri: this.redirectUri, state });
    return url.toString();
  }

  async token(fields) {
    try {
      const response = await this.fetch(TOKEN_URL, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...fields }).toString() });
      return normalized(await responseJson(response), this.now);
    } catch (error) {
      if (["oauth_remote_failed", "oauth_response_invalid"].includes(error?.message)) throw error;
      throw Error("oauth_remote_failed");
    }
  }

  exchange(code) { return this.token({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri }); }
  refresh(refreshToken) { return this.token({ grant_type: "refresh_token", refresh_token: refreshToken }); }

  async identity(accessToken) {
    try {
      const response = await this.fetch("https://api.mercadolibre.com/users/me", { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${accessToken}` } });
      const data = await responseJson(response);
      if (!["string", "number"].includes(typeof data?.id)) throw Error("oauth_response_invalid");
      return { id: data.id };
    } catch (error) {
      if (["oauth_remote_failed", "oauth_response_invalid"].includes(error?.message)) throw error;
      throw Error("oauth_remote_failed");
    }
  }
}

export async function authorizedToken({ oauth, tokens, now = Date.now, skewMs = 60_000 }) {
  const current = await tokens.load();
  if (!current) throw Error("oauth_authorization_required");
  if (current.expiresAt > now() + skewMs) return current.accessToken;
  const rotated = await oauth.refresh(current.refreshToken);
  await tokens.save(rotated);
  return rotated.accessToken;
}
