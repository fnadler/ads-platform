import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaginaDesempenho } from "../PaginaDesempenho";

export const metadata: Metadata = { title: "Desempenho da campanha" };

export default async function DesempenhoCampanha({ params, searchParams }: PageProps<"/o/[org]/desempenho/[campanha]">) {
  const { org: slug, campanha } = await params;
  if (!/^\d+$/.test(campanha)) notFound();
  return <PaginaDesempenho slug={slug} busca={await searchParams} campanha={campanha} />;
}
