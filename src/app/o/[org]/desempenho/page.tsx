import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { rotaDesempenho } from "@/lib/rotas";
import { PaginaDesempenho } from "./PaginaDesempenho";

export const metadata: Metadata = { title: "Desempenho" };

export default async function Desempenho({ params, searchParams }: PageProps<"/o/[org]/desempenho">) {
  const { org: slug } = await params;
  const busca = await searchParams;
  // Links antigos (?campanha=<id>) vão para o endereço da campanha, mantendo período e aba.
  if (typeof busca.campanha === "string" && /^\d+$/.test(busca.campanha)) {
    const q = new URLSearchParams();
    for (const k of ["dias", "aba"]) if (typeof busca[k] === "string") q.set(k, busca[k]);
    redirect(`${rotaDesempenho(slug, busca.campanha)}${q.size ? `?${q}` : ""}`);
  }
  return <PaginaDesempenho slug={slug} busca={busca} campanha={null} />;
}
