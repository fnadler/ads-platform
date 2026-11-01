import { describe, expect, it } from "vitest";
import { lotesListaClientes, payloadPublicoPersonalizado, prontoParaUsar, targetingDoPublico, type Publico } from "./modelo";

const base = { situacao: "pronto", meta_audience_id: null };
const rapido = { paises: ["BR"], idade_min: 18, idade_max: 65, advantage: true };

describe("targeting", () => {
  it("interesses restritos, estados e gênero", () => {
    const p: Publico = {
      ...base,
      id: "a",
      nome: "Colecionadoras SP",
      tipo: "detalhado",
      definicao: { regioes: [{ key: "460", nome: "São Paulo" }], idade_min: 25, idade_max: 45, genero: "mulheres", advantage: false, interesses: [{ id: "6003", nome: "Coleção (hobbies)" }] },
    };
    expect(targetingDoPublico(p, rapido, [])).toEqual({
      geo_locations: { regions: [{ key: "460" }] },
      age_min: 25,
      age_max: 45,
      genders: [2],
      flexible_spec: [{ interests: [{ id: "6003", name: "Coleção (hobbies)" }] }],
      targeting_automation: { advantage_audience: 0 },
    });
  });

  it("sem público: o público rápido de antes", () => {
    expect(targetingDoPublico(null, rapido, ["9"])).toEqual({
      geo_locations: { countries: ["BR"] },
      age_min: 18,
      age_max: 65,
      targeting_automation: { advantage_audience: 1 },
      excluded_custom_audiences: [{ id: "9" }],
    });
  });
});

describe("públicos personalizados", () => {
  it("funil vira lista de clientes; site usa a regra do pixel; semelhante usa a origem", () => {
    const funil: Publico = { ...base, id: "f", nome: "Pagantes", tipo: "funil", definicao: { segmento: "pagantes" } };
    expect(payloadPublicoPersonalizado(funil, { pixelId: "1" })).toMatchObject({ subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY" });
    const site: Publico = { ...base, id: "s", nome: "Site 30d", tipo: "site", definicao: { dias: 30 } };
    expect(payloadPublicoPersonalizado(site, { pixelId: "174" })).toMatchObject({
      rule: { inclusions: { rules: [{ event_sources: [{ id: "174", type: "pixel" }], retention_seconds: 2_592_000 }] } },
    });
    expect(() => payloadPublicoPersonalizado(site, { pixelId: null })).toThrow(/pixel/);
    const lal: Publico = { ...base, id: "l", nome: "Semelhante pagantes", tipo: "semelhante", definicao: { origem_publico_id: "11111111-1111-4111-8111-111111111111", percentual: 2 } };
    expect(payloadPublicoPersonalizado(lal, { pixelId: null, origemMetaId: "900" })).toMatchObject({ subtype: "LOOKALIKE", origin_audience_id: "900", lookalike_spec: { country: "BR", ratio: 0.02 } });
  });

  it("público personalizado só entra na campanha depois de criado na Meta", () => {
    expect(prontoParaUsar({ ...base, id: "f", nome: "Pagantes", tipo: "funil", definicao: { segmento: "pagantes" } })).toMatch(/Enviar à Meta/);
    expect(prontoParaUsar({ ...base, id: "f", nome: "Pagantes", tipo: "funil", definicao: { segmento: "pagantes" }, meta_audience_id: "9" })).toBeNull();
  });

  it("lista de clientes: só hashes, sem linhas vazias, em lotes", () => {
    const r = lotesListaClientes(
      [
        { email_hash: "e1", telefone_hash: null },
        { email_hash: null, telefone_hash: "t2" },
        { email_hash: null, telefone_hash: null },
        { email_hash: "e3", telefone_hash: "t3" },
      ],
      2,
    );
    expect(r).toEqual({ schema: ["EMAIL", "PHONE"], total: 3, lotes: [[["e1", ""], ["", "t2"]], [["e3", "t3"]]] });
  });
});
