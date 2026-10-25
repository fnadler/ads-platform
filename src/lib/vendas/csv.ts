// Leitura de CSV (vírgula ou ponto e vírgula, aspas com "" escapado). Primeira linha = cabeçalho.
export function lerCsv(texto: string): Array<Record<string, string>> {
  const linhas: string[][] = [];
  const sep = (texto.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) > (texto.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  const [cabecalho, ...resto] = linhas.filter((l) => l.some((c) => c.trim()));
  if (!cabecalho) return [];
  const chaves = cabecalho.map((c) => c.trim().toLowerCase().replace(/^﻿/, ""));
  return resto.map((l) => Object.fromEntries(chaves.map((k, i) => [k, (l[i] ?? "").trim()])));
}

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_campaign_id", "utm_adset_id", "utm_ad_id"];

/** Valor em formato brasileiro ou internacional ("1.234,56", "1234.56", "R$ 21,50"). */
export function valorNumerico(v: string) {
  const limpo = v.replace(/[^\d,.-]/g, "");
  if (/,\d{1,2}$/.test(limpo)) return Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number(limpo.replace(/,/g, ""));
}

/** Data "dd/mm/aaaa [hh:mm]" ou ISO → ISO com fuso de Brasília quando não informado. */
export function dataIso(v: string) {
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}T${br[4] ?? "12"}:${br[5] ?? "00"}:00-03:00`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T12:00:00-03:00`;
  return v || undefined;
}

/** Linha do CSV → evento da ingestão (validado depois pelo Zod). */
export function linhaParaEvento(l: Record<string, string>) {
  const tipo = (l.tipo || (l.valor ? "venda" : "lead")).toLowerCase();
  const atribuicao = Object.fromEntries(UTM.filter((k) => l[k]).map((k) => [k, l[k]]));
  const base = { tipo, id_externo: l.id_externo, ocorrido_em: dataIso(l.ocorrido_em || l.data || "") };
  if (tipo === "lead") return { ...base, email: l.email || undefined, telefone: l.telefone || undefined, nome: l.nome || undefined, atribuicao };
  if (tipo === "teste_iniciado") return base;
  return { ...base, valor: valorNumerico(l.valor ?? ""), moeda: l.moeda || undefined, lead_id_externo: l.lead_id_externo || undefined, email: l.email || undefined, atribuicao };
}
