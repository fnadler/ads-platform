import { describe, expect, it } from "vitest";
import { lerCampanha, type DiaCampanha, type EntradaLeitura } from "./modelo";

// Caso real: GN | Cadastro Loja | A1 ganchos, lida em 06/11/2026 às 6h (dia em andamento).
// A análise feita à mão concluiu: não é saturação; a queda de 04–05/11 veio da conversão na página
// (coincidiu com a mudança da página inicial); há 5 testes cuja primeira cobrança cai em 09–10/11.
const d = (dia: string, gasto: number, impressoes: number, frequencia: number, cliques_link: number, visualizacoes_pagina: number, leads_meta: number, leads: number, testes: number): DiaCampanha => ({
  dia,
  gasto,
  impressoes,
  frequencia,
  cliques_link,
  visualizacoes_pagina,
  leads_meta,
  leads,
  testes,
});

const GN: EntradaLeitura = {
  hoje: "2026-11-06",
  sincronizadoAs: "06h01",
  funil: "cadastro_teste_venda",
  diasTeste: 7,
  moeda: "BRL",
  dias: [
    d("2026-10-31", 0, 0, 0, 0, 0, 0, 1, 0),
    d("2026-11-01", 59.7, 4227, 1.2363, 125, 108, 34, 22, 1),
    d("2026-11-02", 64.98, 4832, 1.3209, 223, 207, 45, 33, 4),
    d("2026-11-03", 42.07, 3368, 1.1582, 133, 119, 45, 27, 2),
    d("2026-11-04", 44.79, 2973, 1.1925, 130, 104, 21, 11, 0),
    d("2026-11-05", 37.14, 2291, 1.1677, 103, 93, 16, 11, 0),
    d("2026-11-06", 4.03, 237, 1.1179, 8, 6, 1, 3, 0),
  ],
  anuncios: [
    { ad_id: "a", nome: "A1 | A repetida", gasto: 5.04, impressoes: 378, leads_meta: 5, leads: 4, testes: 2 },
    { ad_id: "b", nome: "A1 | B Gaveta", gasto: 183.69, impressoes: 13060, leads_meta: 121, leads: 81, testes: 5 },
    { ad_id: "c", nome: "A1 | C Digitando", gasto: 3.0, impressoes: 233, leads_meta: 0, leads: 0, testes: 0 },
    { ad_id: "d", nome: "A1 | D Como Vender", gasto: 60.98, impressoes: 4257, leads_meta: 36, leads: 23, testes: 0 },
  ],
  testesAtivos: ["2026-11-02T03:33:43Z", "2026-11-03T00:16:37Z", "2026-11-03T01:58:22Z", "2026-11-03T03:16:05Z", "2026-11-03T12:04:14Z"],
  vendas: 0,
  clarity: [],
};

const porId = (e: EntradaLeitura) => Object.fromEntries(lerCampanha(e).achados.map((a) => [a.id, a]));

describe("lerCampanha — caso GN (06/11)", () => {
  const leitura = lerCampanha(GN);
  const a = porId(GN);

  it("deixa hoje de fora e diz até quando vai a leitura", () => {
    expect(leitura.ultimoDiaCompleto).toBe("2026-11-05");
    expect(leitura.nota).toMatch(/Hoje fica de fora/);
  });

  it("aponta a página como causa da queda, com o anúncio ainda atraindo", () => {
    expect(a.tendencia.tom).toBe("agir");
    expect(a.tendencia.titulo).toBe("Menos visitantes estão se cadastrando");
    expect(a.tendencia.destaque).toEqual({ de: "29%", para: "19%", rotulo: "das visitas à página viram cadastro", sentido: "pior" });
    expect(a.tendencia.acao).toBeTruthy();
    expect(a.tendencia.detalhe).toMatch(/O anúncio continua atraindo/);
    expect(a.tendencia.detalhe).toMatch(/Conecte o Microsoft Clarity/);
  });

  it("mostra as etapas do caminho com o peso de cada uma na queda", () => {
    const passos = a.tendencia.passos!;
    expect(passos.map((p) => p.rotulo)).toEqual([
      "Verba gasta por dia",
      "Custo para exibir mil vezes",
      "De quem vê, quantos clicam",
      "De quem clica, quantos abrem a página",
      "De quem visita, quantos se cadastram",
    ]);
    const pagina = passos[4];
    expect(pagina.piorou).toBe(true);
    expect(Math.round(pagina.parte * 100)).toBe(52);
    expect(passos[2]).toMatchObject({ piorou: false, parte: 0 }); // o CTR subiu
    expect(passos[1].piorou).toBe(true); // CPM subiu = exibir ficou mais caro
  });

  it("aponta também a queda de gasto diário como fator secundário", () => {
    expect(a["tendencia-entrega"]?.tom).toBe("observar");
  });

  it("com o Clarity conectado e ainda sem coletas, não pede para conectar", () => {
    const b = porId({ ...GN, clarityConectado: true });
    expect(b.tendencia.detalhe).toMatch(/ainda não cobre esses dias/);
    expect(b.clarity.tom).toBe("aguardar");
  });

  it("não chama de saturação", () => {
    expect(a.saturacao.tom).toBe("ok");
  });

  it("observa os leads recentes sem teste, sem alarmar (ainda pode ser acaso)", () => {
    expect(a["testes-recentes"].tom).toBe("observar");
    expect(a["testes-recentes"].destaque?.para).toBe("0 de 25");
    expect(a["testes-recentes"].titulo).toMatch(/desde 04\/11/);
  });

  it("não acusa o D Como Vender com 23 leads (amostra insuficiente)", () => {
    expect(a["qualidade-d"]).toBeUndefined();
  });

  it("nota a concentração no B Gaveta e os anúncios sem amostra", () => {
    expect(a.concentracao.destaque).toMatchObject({ para: "73%" });
    expect(a.concentracao.detalhe).toMatch(/“A1 \| A repetida” e “A1 \| C Digitando”/);
    expect(a.concentracao.acaoExecutavel).toEqual({ tipo: "testar_anuncios", anuncios: ["a", "c"] });
  });

  it("manda aguardar as cobranças de 09 e 10/11 para julgar custo por venda", () => {
    expect(a.maturidade.tom).toBe("aguardar");
    expect(a.maturidade.destaque?.para).toBe("09/11");
    expect(a.maturidade.detalhe).toMatch(/entre 09\/11 e 10\/11/);
  });

  it("todo achado tem o essencial (título e destaque) e o detalhe", () => {
    for (const x of leitura.achados) {
      expect(x.titulo.length).toBeLessThan(60);
      expect(x.destaque).toBeTruthy();
      expect(x.detalhe).toBeTruthy();
    }
  });

  it("ordena: agir primeiro, ok por último", () => {
    const tons = leitura.achados.map((x) => x.tom);
    expect(tons[0]).toBe("agir");
    expect(tons.at(-1)).toBe("ok");
  });
});

describe("lerCampanha — outros cenários", () => {
  it("com o Clarity mostrando piora, a evidência entra no achado da página", () => {
    const clarity = ["01", "02", "03", "04", "05"].map((dd, i) => ({
      dia: `2026-11-${dd}`,
      sessoes: 100,
      rolagem: i < 3 ? 60 : 38,
      tempoAtivo: 40,
      voltaRapida: i < 3 ? 10 : 18,
      cliqueMorto: 2,
      cliqueRaiva: 0,
      erroScript: 0,
    }));
    const a = porId({ ...GN, clarity });
    expect(a.tendencia.detalhe).toMatch(/descer menos na página \(de 60% para 38%/);
    expect(a.tendencia.detalhe).toMatch(/voltam logo para o anúncio subiram/);
    expect(a.clarity.tom).toBe("observar");
  });

  it("variação pequena é ruído: ritmo estável", () => {
    const dias = GN.dias.slice(0, 4).concat([d("2026-11-04", 60, 4500, 1.2, 180, 160, 40, 30, 2), d("2026-11-05", 60, 4500, 1.2, 180, 160, 38, 30, 2)]);
    const a = porId({ ...GN, dias });
    expect(a.tendencia.tom).toBe("ok");
    expect(a.tendencia.titulo).toBe("Cadastros no ritmo de sempre");
  });

  it("frequência alta com CTR em queda é saturação", () => {
    const dias = [
      d("2026-11-01", 50, 5000, 2.8, 200, 180, 40, 30, 2),
      d("2026-11-02", 50, 5000, 2.9, 200, 180, 40, 30, 2),
      d("2026-11-03", 50, 5000, 3.0, 200, 180, 40, 30, 2),
      d("2026-11-04", 50, 5000, 3.2, 120, 108, 24, 18, 1),
      d("2026-11-05", 50, 5000, 3.4, 110, 99, 22, 16, 1),
    ];
    const a = porId({ ...GN, dias, hoje: "2026-11-06" });
    expect(a.saturacao.tom).toBe("agir");
    expect(a.tendencia.titulo).toBe("Menos gente está clicando nos anúncios");
  });

  it("menos de 4 dias completos: aguardar", () => {
    const a = porId({ ...GN, dias: GN.dias.slice(0, 3), hoje: "2026-11-03" });
    expect(a["tendencia-amostra"].tom).toBe("aguardar");
  });
});
