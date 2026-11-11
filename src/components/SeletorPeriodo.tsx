import Link from "next/link";
import { PERIODOS } from "@/lib/periodo";

/** Abas de período (7, 14, 30, 90 dias). Cada tela diz para onde cada uma leva, mantendo o resto da busca. */
export function SeletorPeriodo({ dias, href }: { dias: number; href: (dias: number) => string }) {
  return (
    <div role="tablist" aria-label="Período" className="flex gap-1 rounded-lg bg-sunken p-1">
      {PERIODOS.map((d) => (
        <Link
          key={d}
          href={href(d)}
          role="tab"
          aria-selected={d === dias}
          className={`flex min-h-10 items-center rounded-md px-3.5 text-sm font-medium no-underline ${d === dias ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink hover:no-underline"}`}
        >
          {d} dias
        </Link>
      ))}
    </div>
  );
}
