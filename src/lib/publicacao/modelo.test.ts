import { describe, expect, it } from "vitest";
import { avaliarParametros } from "@/lib/rastreio/regras";
import type { Publico } from "@/lib/publicos/modelo";
import { horarioComFuso, menorUnidade, nomeConjunto, payloadAnuncio, payloadCampanha, payloadConjunto, payloadCriativo, planoConjuntos, validarRascunho, type ConfigPublicacao, type CriativoRascunho } from "./modelo";

const config: ConfigPublicacao = { account_id: "act_1", page_id: "111", instagram_user_id: "222", pixel_id: "333", teto_verba_diaria: 100 };
const bruto = {
  verba_diaria: 50,
  inicio: "2026-11-03T00:00",
  evento: "COMPLETE_REGISTRATION",
  paises: ["BR"],
  idade_min: 18,
  idade_max: 65,
  publico_advantage: true,
  url_destino: "https://www.exemplo.com.br/",
};
const criativo: CriativoRascunho = { id: "c1", nome: "A1 | B gaveta", tipo: "video", texto: "Texto", titulo: "Título", chamada: "SIGN_UP" };
const agora = new Date("2026-11-01T12:00:00-03:00");

describe("validarRascunho", () => {
  it("rascunho completo passa", () => {
    const r = validarRascunho(bruto, [criativo], config, "America/Sao_Paulo", agora);
    expect(r.problemas).toEqual([]);
    expect(r.rascunho?.evento).toBe("COMPLETE_REGISTRATION");
  });

  it("acusa verba acima do teto, início no passado e utm na URL", () => {
    const r = validarRascunho({ ...bruto, verba_diaria: 150, inicio: "2026-10-01T00:00", url_destino: "https://x.com/?utm_source=meta" }, [criativo], config, "America/Sao_Paulo", agora);
    expect(r.problemas.map((p) => p.campo).sort()).toEqual(["inicio", "url_destino", "verba_diaria"]);
  });

  it("acusa configuração incompleta, criativo sem texto e nomes repetidos", () => {
    const r = validarRascunho(bruto, [criativo, { ...criativo, id: "c2", texto: " " }], { ...config, pixel_id: null }, "America/Sao_Paulo", agora);
    const textos = r.problemas.map((p) => p.texto).join(" | ");
    expect(textos).toMatch(/configuração de publicação/);
    expect(textos).toMatch(/falta o texto/);
    expect(textos).toMatch(/Dois criativos/);
  });
});

describe("payloads", () => {
  const r = validarRascunho(bruto, [criativo], config, "America/Sao_Paulo", agora).rascunho!;

  it("campanha nasce pausada, com objetivo de cadastros e sem categoria especial", () => {
    expect(payloadCampanha("GN | Teste")).toMatchObject({ objective: "OUTCOME_LEADS", status: "PAUSED", special_ad_categories: [] });
  });

  it("conjunto: pixel + evento, atribuição 7d/1d, verba em centavos, início com fuso", () => {
    const c = payloadConjunto(nomeConjunto("GN | Teste", r), "cmp1", r, config, "BRL", "America/Sao_Paulo");
    expect(c).toMatchObject({
      status: "PAUSED",
      daily_budget: 5000,
      optimization_goal: "OFFSITE_CONVERSIONS",
      destination_type: "WEBSITE",
      promoted_object: { pixel_id: "333", custom_event_type: "COMPLETE_REGISTRATION" },
      start_time: "2026-11-03T00:00:00-03:00",
    });
    expect(c.attribution_spec).toEqual([
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ]);
    expect(c.targeting.age_max).toBe(65);
  });

  it("criativo de vídeo leva Página, Instagram, miniatura e os Parâmetros de URL aprovados pelo Rastreio", () => {
    const p = payloadCriativo(criativo, r, config, { video_id: "v1", thumb_url: "https://t/1.jpg" });
    expect(p.object_story_spec).toMatchObject({
      page_id: "111",
      instagram_user_id: "222",
      video_data: { video_id: "v1", image_url: "https://t/1.jpg", call_to_action: { type: "SIGN_UP", value: { link: "https://www.exemplo.com.br/" } } },
    });
    expect(avaliarParametros(p.url_tags).status).toBe("ok");
  });

  it("criativo de imagem usa link_data; anúncio nasce pausado com o nome do criativo", () => {
    const p = payloadCriativo({ ...criativo, tipo: "imagem" }, r, { ...config, instagram_user_id: null }, { image_hash: "h1" });
    expect(p.object_story_spec).toEqual(expect.objectContaining({ link_data: expect.objectContaining({ image_hash: "h1", link: "https://www.exemplo.com.br/" }) }));
    expect(p.object_story_spec).not.toHaveProperty("instagram_user_id");
    expect(payloadAnuncio(criativo, "as1", "cr1")).toEqual({ name: "A1 | B gaveta", adset_id: "as1", creative: { creative_id: "cr1" }, status: "PAUSED" });
  });
});

describe("orçamento total", () => {
  const total = { ...bruto, tipo_orcamento: "total", verba_diaria: 0, verba_total: 750, fim: "2026-11-18T00:00" };

  it("vai como lifetime_budget, com fim, e a média diária respeita o teto", () => {
    const v = validarRascunho(total, [criativo], config, "America/Sao_Paulo", agora);
    expect(v.problemas).toEqual([]);
    const c = payloadConjunto("GN", "cmp1", v.rascunho!, config, "BRL", "America/Sao_Paulo");
    expect(c).toMatchObject({ lifetime_budget: 75000, end_time: "2026-11-18T00:00:00-03:00" });
    expect(c).not.toHaveProperty("daily_budget");
  });

  it("exige fim e acusa média acima do teto", () => {
    const semFim = validarRascunho({ ...total, fim: "" }, [criativo], config, "America/Sao_Paulo", agora);
    expect(semFim.problemas.map((p) => p.campo)).toContain("fim");
    const curto = validarRascunho({ ...total, fim: "2026-11-05T00:00" }, [criativo], config, "America/Sao_Paulo", agora); // R$ 375/dia
    expect(curto.problemas.map((p) => p.texto).join(" ")).toMatch(/média por dia/);
  });

  it("diário sem verba é problema; diário não manda lifetime_budget", () => {
    expect(validarRascunho({ ...bruto, verba_diaria: 0 }, [criativo], config, "America/Sao_Paulo", agora).problemas.map((p) => p.campo)).toContain("verba_diaria");
    const v = validarRascunho(bruto, [criativo], config, "America/Sao_Paulo", agora).rascunho!;
    expect(payloadConjunto("GN", "c", v, config, "BRL", "America/Sao_Paulo")).not.toHaveProperty("lifetime_budget");
  });
});

describe("conversões", () => {
  it("horário no fuso e moeda na menor unidade", () => {
    expect(horarioComFuso("2026-11-03T09:30", "America/Sao_Paulo")).toBe("2026-11-03T09:30:00-03:00");
    expect(horarioComFuso("2026-07-01T09:30", "Europe/Lisbon")).toBe("2026-07-01T09:30:00+01:00");
    expect(menorUnidade(21.5, "BRL")).toBe(2150);
    expect(menorUnidade(1000, "JPY")).toBe(1000);
  });
});

describe("públicos na campanha", () => {
  const colecionadores: Publico = {
    id: "11111111-1111-4111-8111-111111111111",
    nome: "Colecionadores Copa",
    tipo: "detalhado",
    situacao: "pronto",
    meta_audience_id: null,
    definicao: { paises: ["BR"], idade_min: 18, idade_max: 50, genero: "todos", advantage: true, interesses: [{ id: "6003", nome: "Coleção (hobbies)" }] },
  };
  const pagantes: Publico = { id: "22222222-2222-4222-8222-222222222222", nome: "Pagantes", tipo: "funil", situacao: "pronto", meta_audience_id: "9001", definicao: { segmento: "pagantes" } };
  const naoEnviado: Publico = { ...pagantes, id: "33333333-3333-4333-8333-333333333333", nome: "Testando", meta_audience_id: null };
  const todos = [colecionadores, pagantes, naoEnviado];

  it("um conjunto por público, com interesses como sugestão e exclusão dos pagantes", () => {
    const v = validarRascunho({ ...bruto, publicos: [colecionadores.id], excluir: [pagantes.id] }, [criativo], config, "America/Sao_Paulo", agora, todos);
    expect(v.problemas).toEqual([]);
    const plano = planoConjuntos("GN", v.rascunho!, todos);
    expect(plano.map((p) => p.nome)).toEqual(["GN | Colecionadores Copa"]);
    const c = payloadConjunto(plano[0].nome, "cmp", v.rascunho!, config, "BRL", "America/Sao_Paulo", plano[0].publico, ["9001"]);
    expect(c.targeting).toMatchObject({
      flexible_spec: [{ interests: [{ id: "6003", name: "Coleção (hobbies)" }] }],
      targeting_automation: { advantage_audience: 1 },
      age_max: 65,
      excluded_custom_audiences: [{ id: "9001" }],
    });
    expect(c).toHaveProperty("daily_budget", 5000);
  });

  it("com vários públicos, orçamento vai para a campanha e sai dos conjuntos", () => {
    const v = validarRascunho({ ...bruto, publicos: [colecionadores.id, pagantes.id] }, [criativo], config, "America/Sao_Paulo", agora, todos).rascunho!;
    expect(payloadCampanha("GN", v, "BRL", true)).toMatchObject({ daily_budget: 5000, bid_strategy: "LOWEST_COST_WITHOUT_CAP" });
    const c = payloadConjunto("GN | Pagantes", "cmp", v, config, "BRL", "America/Sao_Paulo", pagantes, [], true);
    expect(c).not.toHaveProperty("daily_budget");
    expect(c.targeting).toMatchObject({ custom_audiences: [{ id: "9001" }], targeting_automation: { advantage_audience: 0 } });
  });

  it("acusa público não enviado à Meta e incluído e excluído ao mesmo tempo", () => {
    const v = validarRascunho({ ...bruto, publicos: [naoEnviado.id, pagantes.id], excluir: [pagantes.id] }, [criativo], config, "America/Sao_Paulo", agora, todos);
    const textos = v.problemas.map((p) => p.texto).join(" | ");
    expect(textos).toMatch(/ainda não foi criado na Meta/);
    expect(textos).toMatch(/incluído e excluído/);
  });
});
