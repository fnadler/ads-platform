import "server-only";
import Stripe from "stripe";

// Stripe da organização (chave restrita só de leitura, guardada cifrada). Cada organização tem a sua.
export const clienteStripe = (chave: string) => new Stripe(chave, { maxNetworkRetries: 2, timeout: 20_000 });

/** Confere a chave com uma leitura (faturas: a permissão que a sincronização usa). */
export async function validarChaveStripe(chave: string) {
  if (!/^(rk|sk)_(live|test)_/.test(chave)) throw new Error("A chave do Stripe começa com rk_live_ (restrita, recomendada) ou sk_live_.");
  const stripe = clienteStripe(chave);
  try {
    await stripe.invoices.list({ limit: 1 });
    await stripe.subscriptions.list({ limit: 1 });
  } catch (e) {
    const msg = (e as Error).message;
    throw new Error(
      /permission|does not have the required/i.test(msg)
        ? "A chave não tem permissão de leitura em Faturas (Invoices) e Assinaturas (Subscriptions). Crie uma chave restrita com essas leituras."
        : `O Stripe recusou a chave: ${msg}`,
    );
  }
  return { modo: chave.includes("_live_") ? "produção" : "teste" };
}
