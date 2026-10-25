import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Cifra das credenciais das organizações (tokens da Meta, chaves do Stripe): AES-256-GCM com a chave
// mestra CHAVE_CIFRAGEM (32 bytes em base64). Formato: "v<versão>:<iv>:<tag>:<cifrado>" (base64url).
// Para trocar a chave: CHAVE_CIFRAGEM_V<n> com a nova, CHAVE_CIFRAGEM_VERSAO=<n> e recifrar (a antiga
// continua lendo o que já existe).

function chave(versao: number) {
  const valor = versao === 1 ? process.env.CHAVE_CIFRAGEM : process.env[`CHAVE_CIFRAGEM_V${versao}`];
  if (!valor) throw new Error(`Chave de cifragem v${versao} não configurada.`);
  const bytes = Buffer.from(valor, "base64");
  if (bytes.length !== 32) throw new Error(`Chave de cifragem v${versao} precisa ter 32 bytes (base64).`);
  return bytes;
}

const versaoAtual = () => Number(process.env.CHAVE_CIFRAGEM_VERSAO || 1);

export function cifrar(texto: string) {
  const versao = versaoAtual();
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(versao), iv);
  const cifrado = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return [`v${versao}`, iv.toString("base64url"), cifra.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(":");
}

export function decifrar(valor: string) {
  const [v, iv, tag, cifrado] = valor.split(":");
  if (!v?.startsWith("v") || !iv || !tag || !cifrado) throw new Error("Credencial em formato inválido.");
  const decifra = createDecipheriv("aes-256-gcm", chave(Number(v.slice(1))), Buffer.from(iv, "base64url"));
  decifra.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decifra.update(Buffer.from(cifrado, "base64url")), decifra.final()]).toString("utf8");
}

/** SHA-256 em hex (tokens de convite e de webhook, e-mail e telefone dos leads). */
export const sha256 = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");

/** Token aleatório para links e webhooks (base64url, 32 bytes). */
export const novoToken = (prefixo = "") => `${prefixo}${randomBytes(32).toString("base64url")}`;
