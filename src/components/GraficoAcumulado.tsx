"use client";

import { useState } from "react";

// Leads acumulados dia a dia: período atual contra o anterior, mesmo número de dias. Linha mais
// íngreme = tração; achatando = saturação. Uma escala só; legenda + rótulo no fim das linhas; tooltip
// com linha-guia ao passar o mouse (ou o dedo) sobre o dia.

export interface PontoComparacao {
  rotulo: string; // "seg 03/11"
  atual: number; // acumulado no dia
  anterior: number;
  rotuloAnterior: string;
}

const L = 640;
const A = 220;
const M = { topo: 16, dir: 92, base: 28, esq: 36 };

export function GraficoAcumulado({ pontos, titulo }: { pontos: PontoComparacao[]; titulo: string }) {
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(1, ...pontos.flatMap((p) => [p.atual, p.anterior]));
  const passo = Math.pow(10, Math.floor(Math.log10(max)));
  const topo = Math.ceil(max / passo) * passo;
  const marcas = [0, topo / 2, topo];
  const largura = L - M.esq - M.dir;
  const altura = A - M.topo - M.base;
  const x = (i: number) => M.esq + (pontos.length === 1 ? largura / 2 : (i * largura) / (pontos.length - 1));
  const y = (v: number) => M.topo + altura - (v / topo) * altura;
  const caminho = (k: "atual" | "anterior") => pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const ultimo = pontos.length - 1;
  const rotulosFinais = [
    { k: "atual" as const, nome: "Últimos 7 dias", y: y(pontos[ultimo]?.atual ?? 0), cor: "var(--serie-atual)" },
    { k: "anterior" as const, nome: "7 anteriores", y: y(pontos[ultimo]?.anterior ?? 0), cor: "var(--serie-anterior)" },
  ];
  // Rótulos finais muito próximos: afasta só o suficiente para não sobrepor.
  if (Math.abs(rotulosFinais[0].y - rotulosFinais[1].y) < 28) {
    const meio = (rotulosFinais[0].y + rotulosFinais[1].y) / 2;
    const [cima, baixo] = rotulosFinais[0].y <= rotulosFinais[1].y ? [0, 1] : [1, 0];
    rotulosFinais[cima].y = meio - 14;
    rotulosFinais[baixo].y = meio + 14;
  }
  const p = foco !== null ? pontos[foco] : null;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{titulo}</span>
        <span className="flex gap-4 text-xs text-suave">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-serie-atual" /> Últimos 7 dias
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-serie-anterior" /> 7 dias anteriores
          </span>
        </span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${L} ${A}`} className="w-full" role="img" aria-label={`${titulo}: ${pontos.at(-1)?.atual ?? 0} nos últimos 7 dias contra ${pontos.at(-1)?.anterior ?? 0} nos 7 anteriores`}>
          {marcas.map((m) => (
            <g key={m}>
              <line x1={M.esq} x2={L - M.dir} y1={y(m)} y2={y(m)} stroke="var(--grade)" strokeWidth={1} />
              <text x={M.esq - 6} y={y(m)} dy="0.32em" textAnchor="end" className="fill-suave text-[11px]">
                {m.toLocaleString("pt-BR")}
              </text>
            </g>
          ))}
          {pontos.map((pt, i) => (
            <text key={pt.rotulo} x={x(i)} y={A - 8} textAnchor="middle" className="fill-suave text-[11px]">
              {pt.rotulo}
            </text>
          ))}
          {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={M.topo} y2={M.topo + altura} stroke="var(--suave)" strokeWidth={1} />}
          <path d={caminho("anterior")} fill="none" stroke="var(--serie-anterior)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={caminho("atual")} fill="none" stroke="var(--serie-atual)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {foco !== null &&
            (["anterior", "atual"] as const).map((k) => (
              <circle key={k} cx={x(foco)} cy={y(pontos[foco][k])} r={4} fill={`var(--serie-${k})`} stroke="var(--superficie)" strokeWidth={2} />
            ))}
          {ultimo >= 0 &&
            rotulosFinais.map((r) => (
              <g key={r.k}>
                <line x1={x(ultimo) + 4} x2={x(ultimo) + 12} y1={y(pontos[ultimo][r.k])} y2={r.y} stroke={r.cor} strokeWidth={1} />
                <text x={x(ultimo) + 16} y={r.y} dy="0.32em" className="fill-texto text-[12px] font-medium">
                  {pontos[ultimo][r.k].toLocaleString("pt-BR")}
                </text>
              </g>
            ))}
          {pontos.map((pt, i) => (
            <rect
              key={pt.rotulo}
              x={x(i) - largura / Math.max(1, pontos.length - 1) / 2}
              y={M.topo}
              width={largura / Math.max(1, pontos.length - 1)}
              height={altura}
              fill="transparent"
              onPointerEnter={() => setFoco(i)}
              onPointerLeave={() => setFoco(null)}
            />
          ))}
        </svg>
        {p && foco !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-borda bg-superficie px-3 py-2 text-xs shadow-sm"
            style={{ left: `${(x(foco) / L) * 100}%`, transform: foco > pontos.length / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 bg-serie-atual" /> {p.rotulo}: <strong>{p.atual.toLocaleString("pt-BR")}</strong>
            </div>
            <div className="flex items-center gap-1.5 text-suave">
              <span className="inline-block h-0.5 w-3 bg-serie-anterior" /> {p.rotuloAnterior}: <strong className="text-texto">{p.anterior.toLocaleString("pt-BR")}</strong>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
