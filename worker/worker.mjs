import { affiliateResult } from "./url-policy.mjs";

export class AffiliateWorker {
  constructor({ store, page, maxFailures = 3 }) {
    this.store = store;
    this.page = page;
    this.maxFailures = maxFailures;
    this.failures = 0;
  }

  async once() {
    if (this.failures >= this.maxFailures) return { state: "circuit_open" };
    const item = await this.store.claim();
    if (!item) return { state: "idle" };
    try {
      const cached = await this.store.cached(item.canonical_url, item.tag);
      const affiliateUrl = affiliateResult(cached ?? await this.page.generate({ url: item.canonical_url, tag: item.tag }));
      await this.store.generated(item.id, affiliateUrl);
      this.failures = 0;
      return { state: "awaiting_confirmation", id: item.id, url: item.canonical_url, affiliateUrl };
    } catch (error) {
      this.failures++;
      const category = error?.message === "authentication_required" ? "blocked_auth" : ["captcha_required", "ui_changed", "ineligible_url", "invalid_affiliate_result"].includes(error?.message) ? error.message : "worker_failed";
      await this.store.block(item.id, category);
      return { state: ["blocked_auth", "captcha_required"].includes(category) ? "blocked_auth" : "review", id: item.id, category };
    }
  }
}
