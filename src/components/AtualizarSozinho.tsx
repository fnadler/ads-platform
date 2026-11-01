"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega os dados da página de tempos em tempos (acompanhar um job da fila). */
export function AtualizarSozinho({ segundos = 5 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), segundos * 1000);
    return () => clearInterval(t);
  }, [router, segundos]);
  return null;
}
