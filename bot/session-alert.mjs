export class SessionAlert {
  constructor({ evolution, destination }) {
    if (!/^\d{10,15}$/.test(destination ?? "")) throw Error("admin_whatsapp_invalid");
    if (!evolution?.send) throw Error("admin_whatsapp_notifier_invalid");
    this.evolution = evolution;
    this.destination = destination;
    this.notified = false;
  }

  async required() {
    if (this.notified) return false;
    await this.evolution.send({
      destination: this.destination,
      kind: "text",
      text: "A sessão de afiliados do Mercado Livre expirou. Envie uma nova requisição createLink para atualizar os cookies. As publicações ficarão pausadas até a sessão ser restaurada.",
    });
    this.notified = true;
    return true;
  }

  restored() { this.notified = false; }
}
