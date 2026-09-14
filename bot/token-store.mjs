import * as defaultFs from "node:fs/promises";

function validate(tokens) {
  if (
    !tokens ||
    typeof tokens !== "object" ||
    typeof tokens.accessToken !== "string" ||
    !tokens.accessToken ||
    typeof tokens.refreshToken !== "string" ||
    !tokens.refreshToken ||
    !Number.isFinite(tokens.expiresAt) ||
    tokens.expiresAt <= 0 ||
    !(["string", "number"].includes(typeof tokens.userId))
  ) throw Error("oauth_tokens_invalid");
  return tokens;
}

export class TokenStore {
  constructor(path, { fs = {} } = {}) {
    this.path = path;
    this.fs = { ...defaultFs, ...fs };
  }

  async load() {
    try {
      return validate(JSON.parse(await this.fs.readFile(this.path, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error?.message === "oauth_tokens_invalid") throw error;
      throw Error("oauth_token_store_failed");
    }
  }

  async save(tokens) {
    validate(tokens);
    const temporary = `${this.path}.tmp`;
    try {
      await this.fs.writeFile(temporary, JSON.stringify(tokens), { encoding: "utf8", mode: 0o600 });
      await this.fs.rename(temporary, this.path);
    } catch {
      await this.fs.rm(temporary, { force: true }).catch(() => {});
      throw Error("oauth_token_store_failed");
    }
  }
}
