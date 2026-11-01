"use client";

import { useState } from "react";
import { Botao } from "@/components/ui";
import { registrarCriativo } from "@/lib/publicacao/acoes";
import { criarClienteNavegador } from "@/lib/supabase/navegador";

// Envia vídeos e imagens direto do navegador para o Storage (sem passar pela função da Vercel, que limita o
// corpo a 4,5 MB) e registra cada um como criativo da campanha.
const ACEITOS = ["video/mp4", "video/quicktime", "image/jpeg", "image/png", "image/webp"];
const LIMITE = 50 * 1024 * 1024;

export function EnviarArquivos({ orgId, campanhaId }: { orgId: string; campanhaId: string }) {
  const [linhas, setLinhas] = useState<Array<{ nome: string; situacao: string; erro?: boolean }>>([]);
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setEnviando(true);
    const supabase = criarClienteNavegador();
    const lista = Array.from(arquivos);
    setLinhas(lista.map((f) => ({ nome: f.name, situacao: "na fila" })));
    const marcar = (i: number, situacao: string, erro = false) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, situacao, erro } : x)));
    for (const [i, f] of lista.entries()) {
      if (!ACEITOS.includes(f.type)) {
        marcar(i, "formato não aceito (use MP4, MOV, JPG, PNG ou WEBP)", true);
        continue;
      }
      if (f.size > LIMITE) {
        marcar(i, "maior que 50 MB", true);
        continue;
      }
      marcar(i, "enviando…");
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${orgId}/${campanhaId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("uploads-criativos").upload(path, f, { contentType: f.type, upsert: false });
      if (error) {
        marcar(i, `falhou: ${error.message}`, true);
        continue;
      }
      try {
        await registrarCriativo(orgId, campanhaId, { path, nome: f.name, mime: f.type, tamanho: f.size });
        marcar(i, "pronto");
      } catch (e) {
        marcar(i, `falhou: ${(e as Error).message}`, true);
      }
    }
    setEnviando(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-borda bg-fundo px-4 py-6 text-center text-sm hover:border-marca">
        <span className="font-medium">{enviando ? "Enviando…" : "Escolher vídeos ou imagens"}</span>
        <span className="text-xs text-suave">MP4, MOV, JPG, PNG ou WEBP, até 50 MB cada. Um anúncio por arquivo.</span>
        <input type="file" multiple accept={ACEITOS.join(",")} className="hidden" disabled={enviando} onChange={(e) => enviar(e.currentTarget.files)} />
      </label>
      {linhas.map((l, i) => (
        <div key={`${l.nome}-${i}`} className={`text-xs ${l.erro ? "text-erro" : "text-suave"}`}>
          {l.nome}: {l.situacao}
        </div>
      ))}
      {!enviando && linhas.length > 0 && (
        <Botao type="button" variante="secundario" className="self-start" onClick={() => setLinhas([])}>
          Limpar lista
        </Botao>
      )}
    </div>
  );
}
