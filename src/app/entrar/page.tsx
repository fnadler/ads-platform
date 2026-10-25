import type { Metadata } from "next";
import { FormEntrar } from "./FormEntrar";

export const metadata: Metadata = { title: "Entrar" };

export default async function Entrar({ searchParams }: PageProps<"/entrar">) {
  const { next, erro } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-borda bg-superficie p-6">
        <h1 className="text-xl font-semibold">Entrar</h1>
        <p className="mb-5 mt-1 text-sm text-suave">Saiba quais anúncios trazem venda, não só conversa.</p>
        <FormEntrar next={typeof next === "string" ? next : undefined} erroInicial={erro ? "O link expirou ou já foi usado. Tente de novo." : undefined} />
      </div>
    </main>
  );
}
