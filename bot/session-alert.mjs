import { randomUUID } from "node:crypto";

export class SessionAlert {
  constructor({ evolution, destination, incidents }) {
    if (!/^\d{10,15}$/.test(destination ?? "")) throw Error("admin_whatsapp_invalid");
    if (typeof evolution?.send !== "function") throw Error("admin_whatsapp_notifier_invalid");
    if (
      typeof incidents?.beginIncident !== "function" ||
      typeof incidents?.markIncidentNotified !== "function" ||
      typeof incidents?.abandonIncident !== "function" ||
      typeof incidents?.resolveIncident !== "function"
    ) throw Error("session_incidents_invalid");
    this.evolution = evolution;
    this.destination = destination;
    this.incidents = incidents;
  }

  async required() {
    const claimToken = await this.incidents.beginIncident("meli_session", randomUUID());
    if (!claimToken) return false;
    try {
      await this.evolution.send({
        destination: this.destination,
        kind: "text",
        text: "A sessão de afiliados do Mercado Livre expirou. Envie uma nova requisição createLink para atualizar os cookies. As publicações ficarão pausadas até a sessão ser restaurada.",
      });
    } catch (error) {
      try {
        await this.incidents.abandonIncident("meli_session", claimToken);
      } catch {
        // The notification failure remains authoritative and must not expose storage details.
      }
      throw error;
    }
    await this.incidents.markIncidentNotified("meli_session", claimToken);
    return true;
  }

  async restored() {
    await this.incidents.resolveIncident("meli_session");
  }
}
