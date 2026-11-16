import { describe, expect, it } from "vitest";
import { lerCampanha, type DiaCampanha, type EntradaLeitura } from "./modelo";

// Caso real: GN | Cadastro Loja | A1 ganchos, lida em 06/11/2026 às 6h (dia em andamento).
// A análise feita à mão concluiu: não é saturação; a queda de 04–05/11 veio da conversão na página
// (coincidiu com a mudança da página inicial); há 5 testes cuja primeira cobrança cai em 09–10/11.
const d = (
  dia: string,
  gasto: number,
  impressoes: number,
  frequencia: number,
  cliques_link: number,
  visualizacoes_pagina: number,
  leads_meta: number,
  leads: number,
  testes: number,
): DiaCampanha => ({
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
    expect(a.tendencia.atalhos).toEqual(["testar_pagina", "conectar_clarity"]);
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

describe("lerCampanha — verba que mudou de anúncio (caso GN, 08/11)", () => {
  // Leitura de 12/11: B Gaveta trouxe 19 testes com R$ 340; D Como Vender, 3 testes com R$ 160.
  const marco = {
    em: "2026-11-09T01:30:16Z",
    dia: "2026-11-08",
    tipo: "pausa_anuncio" as const,
    rotulo: "Pausou o anúncio “A1 | C Digitando”",
    adId: "c",
    usuarioId: null,
    efeito: {
      antes: { dias: 3, gasto: 142.85, leads: 32, visitas: 333, leadsMeta: 51, fatias: [] },
      depois: { dias: 3, gasto: 130.09, leads: 36, visitas: 243, leadsMeta: 48, fatias: [] },
      ganhou: { adId: "d", de: 0.2, para: 0.58 },
      perdeu: { adId: "b", de: 0.73, para: 0.35 },
    },
  };
  const base: EntradaLeitura = {
    ...GN,
    hoje: "2026-11-12",
    anuncios: [
      { ad_id: "a", nome: "A1 | A repetida", gasto: 25, impressoes: 2000, leads_meta: 12, leads: 8, testes: 2 },
      { ad_id: "b", nome: "A1 | B Gaveta", gasto: 340, impressoes: 24000, leads_meta: 170, leads: 120, testes: 19 },
      { ad_id: "c", nome: "A1 | C Digitando", gasto: 6.9, impressoes: 526, leads_meta: 1, leads: 2, testes: 0 },
      { ad_id: "d", nome: "A1 | D Como Vender", gasto: 160, impressoes: 12000, leads_meta: 70, leads: 45, testes: 3 },
    ],
    marcos: [marco],
  };

  it("avisa que a pausa levou a verba para o anúncio pior, com o anúncio a socorrer", () => {
    const a = lerCampanha(base).achados.find((x) => x.id.startsWith("redistribuicao"));
    expect(a?.titulo).toBe("Depois que você pausou “A1 | C Digitando” em 08/11, a Meta passou a gastar 58% em “A1 | D Como Vender”");
    expect(a?.acaoExecutavel).toEqual({ tipo: "testar_anuncios", anuncios: ["b"] });
    expect(lerCampanha(base).marcos).toHaveLength(1);
  });

  it("não acusa quando a verba foi para um anúncio tão bom quanto", () => {
    const parelho = { ...base, anuncios: base.anuncios.map((x) => (x.ad_id === "d" ? { ...x, testes: 18 } : x)) };
    expect(lerCampanha(parelho).achados.some((x) => x.id.startsWith("redistribuicao"))).toBe(false);
  });

  it("espera 2 dias depois da mudança e esquece mudanças de mais de 14 dias", () => {
    const cedo = { ...base, marcos: [{ ...marco, efeito: { ...marco.efeito, depois: { ...marco.efeito.depois, dias: 1 } } }] };
    expect(lerCampanha(cedo).achados.some((x) => x.id.startsWith("redistribuicao"))).toBe(false);
    expect(lerCampanha({ ...base, hoje: "2026-11-30" }).achados.some((x) => x.id.startsWith("redistribuicao"))).toBe(false);
  });
});

describe("lerCampanha — achados da fase 2 (caso GN, campanha toda)", () => {
  // Totais de 01 a 15/11: a Meta contou 327 cadastros, 223 chegaram; B Gaveta trouxe as 6 vendas.
  const dias = [
    d("2026-11-01", 59.7, 4227, 1.24, 125, 108, 34, 23, 2),
    d("2026-11-02", 64.98, 4832, 1.32, 223, 207, 45, 33, 4),
    d("2026-11-03", 42.07, 3368, 1.16, 133, 119, 45, 28, 2),
    d("2026-11-04", 44.79, 2973, 1.19, 130, 104, 21, 12, 0),
    d("2026-11-05", 37.22, 2297, 1.17, 103, 93, 16, 11, 1),
    d("2026-11-06", 38.29, 2545, 1.13, 90, 72, 17, 12, 2),
    d("2026-11-07", 54.0, 3649, 1.22, 148, 125, 14, 9, 2),
    d("2026-11-08", 50.56, 3684, 1.23, 156, 136, 20, 15, 3),
    d("2026-11-09", 41.56, 3294, 1.17, 98, 86, 19, 15, 2),
    d("2026-11-10", 37.69, 2950, 1.2, 89, 75, 18, 14, 1),
    d("2026-11-11", 50.84, 3590, 1.16, 93, 82, 11, 7, 1),
    d("2026-11-12", 32.01, 2154, 1.13, 59, 54, 11, 5, 1),
    d("2026-11-13", 38.6, 2574, 1.08, 75, 63, 12, 11, 2),
    d("2026-11-14", 53.28, 3958, 1.16, 124, 109, 17, 9, 2),
    d("2026-11-15", 57.11, 4419, 1.11, 141, 118, 25, 18, 2),
  ];
  const GN_FIM: EntradaLeitura = {
    ...GN,
    hoje: "2026-11-16",
    dias,
    anuncios: [
      { ad_id: "a", nome: "A1 | A repetida", gasto: 36.94, impressoes: 3059, leads_meta: 18, leads: 10, testes: 2, vendas: 0 },
      {
        ad_id: "b",
        nome: "A1 | B Gaveta",
        gasto: 424.88,
        impressoes: 29461,
        leads_meta: 212,
        leads: 147,
        testes: 19,
        vendas: 6,
        titulo: "Suas repetidas já são uma loja.",
        texto: "Tem figurinha da Copa repetida parada aí? Na GN Coleciona, suas repetidas viram uma loja com link próprio.",
      },
      { ad_id: "c", nome: "A1 | C Digitando", gasto: 6.91, impressoes: 526, leads_meta: 1, leads: 2, testes: 0, vendas: 0 },
      { ad_id: "d", nome: "A1 | D Como Vender", gasto: 243.21, impressoes: 18201, leads_meta: 96, leads: 64, testes: 6, vendas: 0 },
    ],
    navegadores: [
      { nome: "InstagramApp", sessoes: 956 },
      { nome: "ChromeMobile", sessoes: 325 },
      { nome: "MobileSafari", sessoes: 227 },
      { nome: "FacebookApp", sessoes: 227 },
      { nome: "Chrome", sessoes: 75 },
      { nome: "SamsungInternet", sessoes: 45 },
    ],
  };
  const a = porId(GN_FIM);

  it("diferença entre Meta e sistema: 68% chegam", () => {
    expect(a["diferenca-meta"]?.destaque?.para).toBe("68%");
    expect(a["diferenca-meta"]?.tom).toBe("observar");
  });

  it("vencedor por venda: B Gaveta, com o roteiro do argumento", () => {
    const v = a["vencedor-b"];
    expect(v?.titulo).toBe("“A1 | B Gaveta” trouxe 6 vendas de 6");
    expect(v?.acaoDetalhe).toContain("Suas repetidas já são uma loja.");
    expect(v?.detalhe).toContain("sem nenhuma venda");
  });

  it("navegador de app: 64% das visitas abrem dentro do Instagram ou do Facebook", () => {
    expect(a["navegador-app"]?.destaque?.para).toBe("64%");
  });

  it("não acusa sem volume nem quando a diferença é pequena", () => {
    const pouco = porId({ ...GN_FIM, navegadores: [{ nome: "InstagramApp", sessoes: 60 }], anuncios: GN_FIM.anuncios.map((x) => ({ ...x, vendas: x.ad_id === "b" ? 2 : 0 })) });
    expect(pouco["navegador-app"]).toBeUndefined();
    expect(pouco["vencedor-b"]).toBeUndefined();
    const proximo = porId({ ...GN_FIM, dias: dias.map((x) => ({ ...x, leads: Math.round(x.leads_meta * 0.9) })) });
    expect(proximo["diferenca-meta"]).toBeUndefined();
  });

  it("vendas divididas não têm vencedor", () => {
    const dividido = porId({ ...GN_FIM, anuncios: GN_FIM.anuncios.map((x) => ({ ...x, vendas: x.ad_id === "b" ? 3 : x.ad_id === "d" ? 3 : 0 })) });
    expect(Object.keys(dividido).some((k) => k.startsWith("vencedor"))).toBe(false);
  });
});
