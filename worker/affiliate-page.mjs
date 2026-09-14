export class AffiliatePage {
  constructor(page, { generatorUrl }) {
    this.page = page;
    this.generatorUrl = generatorUrl;
    page.setDefaultTimeout(30_000);
  }

  async sessionState() {
    if (await this.page.getByText(/captcha|não sou um robô|verificação de segurança/i).count()) return "captcha";
    if (await this.page.getByRole("button", { name: /entrar|iniciar sessão/i }).count()) return "authentication_required";
    return "authenticated";
  }

  async generate({ url, tag }) {
    try {
      await this.page.goto(this.generatorUrl, { waitUntil: "domcontentloaded" });
      const state = await this.sessionState();
      if (state === "captcha") throw Error("captcha_required");
      if (state !== "authenticated") throw Error("authentication_required");
      const urlInput = this.page.getByLabel(/link|url.*produto|produto/i).first?.() ?? this.page.getByLabel(/link|url.*produto|produto/i);
      if (!(await urlInput.count())) throw Error("ui_changed");
      await urlInput.fill(url);
      const tagInput = this.page.getByLabel(/etiqueta|tag/i).first?.() ?? this.page.getByLabel(/etiqueta|tag/i);
      if (await tagInput.count()) await tagInput.selectOption({ label: tag });
      const generate = this.page.getByRole("button", { name: /gerar/i });
      if (!(await generate.count())) throw Error("ui_changed");
      await generate.click();
      const result = this.page.getByText(/^https:\/\/meli\.la\//i).first?.() ?? this.page.getByText(/^https:\/\/meli\.la\//i);
      await result.waitFor({ state: "visible" });
      const value = (await result.textContent())?.trim();
      if (!value) throw Error("invalid_affiliate_result");
      return value;
    } catch (error) {
      if (["captcha_required", "authentication_required", "ui_changed", "invalid_affiliate_result"].includes(error?.message)) throw error;
      throw Error("ui_changed");
    }
  }
}
