import { Cartao, Etiqueta, type Tom } from "@/components/ui";
import type { Achado, Leitura, TomAchado } from "@/lib/leitura/modelo";

// Leitura da campanha: os achados em ordem de urgência, cada um com a evidência e o que fazer.

const ROTULO: Record<TomAchado, { rotulo: string; tom: Tom }> = {
  agir: { rotulo: "Agir", tom: "erro" },
  observar: { rotulo: "Observar", tom: "alerta" },
  aguardar: { rotulo: "Aguardar", tom: "info" },
  ok: { rotulo: "Tudo certo", tom: "ok" },
};

export function ItemAchado({ achado }: { achado: Achado }) {
  const r = ROTULO[achado.tom];
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Etiqueta tom={r.tom}>{r.rotulo}</Etiqueta>
        <h3 className="font-[550] text-ink">{achado.titulo}</h3>
      </div>
      <p className="text-sm text-ink-2">{achado.texto}</p>
      {achado.acao && (
        <p className="text-sm text-ink">
          <strong className="font-[550]">O que fazer:</strong> {achado.acao}
        </p>
      )}
    </li>
  );
}

export function LeituraCampanha({ leitura }: { leitura: Leitura }) {
  if (!leitura.achados.length) return null;
  return (
    <Cartao titulo="Leitura da campanha" descricao={leitura.nota ?? undefined}>
      <ul className="flex flex-col">
        {leitura.achados.map((a) => (
          <ItemAchado key={a.id} achado={a} />
        ))}
      </ul>
    </Cartao>
  );
}
