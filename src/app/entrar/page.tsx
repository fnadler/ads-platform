/* eslint-disable @next/next/no-img-element -- logos estáticos de public/marca */
import type { Metadata } from "next";
import { FormEntrar } from "./FormEntrar";

export const metadata: Metadata = { title: "Entrar" };

export default async function Entrar({ searchParams }: PageProps<"/entrar">) {
  const { next, erro } = await searchParams;
  return (
    <main className="grid min-h-screen flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
      <div className="flex flex-col justify-between gap-12 bg-chrome p-[clamp(28px,5vw,64px)] text-chrome-ink">
        <img src="/marca/adverdad-logo-dark.png" alt="Adverdad" className="h-9 w-auto self-start" />
        <div className="flex max-w-[560px] flex-col gap-5">
          <h1 className="text-[clamp(32px,3.6vw,48px)] font-bold leading-[1.1] tracking-[-0.025em] [text-wrap:balance]">Saiba quais anúncios trazem venda, não só conversa.</h1>
          <p className="max-w-[460px] text-[17px] text-chrome-ink-2">E o que fazer a seguir. Mídia da Meta cruzada com as vendas do Stripe, do CRM e do seu checkout, anúncio por anúncio.</p>
        </div>
        <span aria-hidden="true" />
      </div>
      <div className="flex items-center justify-center p-[clamp(24px,5vw,64px)]">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="title-page text-[27px] text-ink">Entrar</h2>
            <p className="text-ink-2">Use o e-mail em que você recebeu o convite.</p>
          </div>
          <FormEntrar next={typeof next === "string" ? next : undefined} erroInicial={erro ? "O link expirou ou já foi usado. Tente de novo." : undefined} />
        </div>
      </div>
    </main>
  );
}
