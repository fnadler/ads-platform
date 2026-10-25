import "server-only";
import { headers } from "next/headers";

/** Endereço público do sistema (links de convite, webhook, teste de rastreio). */
export async function urlSistema() {
  if (process.env.URL_SISTEMA) return process.env.URL_SISTEMA.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocolo}://${host}`;
}
