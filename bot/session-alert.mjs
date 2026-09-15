export class SessionAlert {
  constructor({ evolution, destination, incidents }) {
    if (!/^\d{10,15}$/.test(destination ?? "")) throw Error("admin_whatsapp_invalid");
    if (typeof evolution?.send !== "function") throw Error("admin_whatsapp_notifier_invalid");
    if (
      typeof incidents?.beginIncident !== "function" ||
      typeof incidents?.resolveIncident !== "function"
    ) throw Error("session_incidents_invalid");
    this.evolution = evolution;
    this.destination = destination;
    this.incidents = incidents;
  }

  async required() {
    if (!await this.incidents.beginIncident("meli_session")) return false;
    try {
      await this.evolution.send({
        destination: this.destination,
        kind: "text",
        text: "A sessão de afiliados do Mercado Livre expirou. Envie uma nova requisição createLink para atualizar os cookies. As publicações ficarão pausadas até a sessão ser restaurada.",
      });
      return true;
    } catch {
      try {
        await this.incidents.resolveIncident("meli_session");
      } catch {
        // The notification failure remains authoritative and must not expose storage details.
      }
      throw Error("admin_whatsapp_notification_failed");
    }
  }

  async restored() {
    await this.incidents.resolveIncident("meli_session");
  }
}
