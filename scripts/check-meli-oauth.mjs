import { TokenStore } from "../bot/token-store.mjs";
import { MeliOAuthClient, authorizedToken } from "../bot/meli-oauth.mjs";

const env = process.env;
if (!env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET || !env.MELI_REDIRECT_URI || !env.MELI_OAUTH_TOKEN_PATH)
  throw Error("configuration_required");
const tokens = new TokenStore(env.MELI_OAUTH_TOKEN_PATH);
const oauth = new MeliOAuthClient({ clientId: env.MELI_CLIENT_ID, clientSecret: env.MELI_CLIENT_SECRET, redirectUri: env.MELI_REDIRECT_URI });
const accessToken = await authorizedToken({ oauth, tokens });
const identity = await oauth.identity(accessToken);
console.log(JSON.stringify({ authorized: true, userId: identity.id }));
