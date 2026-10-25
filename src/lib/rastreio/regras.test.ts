import { describe, expect, it } from "vitest";
import { avaliarParametros, conferirLead, montarUrlTeste, PARAMETROS_META, statusDoResultado } from "./regras";

describe("avaliarParametros", () => {
  it("a convenção padrão está ok", () => {
    expect(avaliarParametros(PARAMETROS_META)).toEqual({ status: "ok", problemas: [] });
  });

  it("sem parâmetros é erro", () => {
    expect(avaliarParametros(null).status).toBe("erro");
    expect(avaliarParametros("  ").status).toBe("erro");
  });

  it("só nomes (sem IDs) é erro", () => {
    const r = avaliarParametros("utm_source=meta&utm_campaign={{campaign.name}}&utm_content={{ad.name}}");
    expect(r.status).toBe("erro");
    expect(r.problemas.map((p) => p.texto).join(" ")).toMatch(/utm_ad_id/);
  });

  it("sem conjunto é só alerta", () => {
    expect(avaliarParametros("utm_source=meta&utm_campaign_id={{campaign.id}}&utm_ad_id={{ad.id}}").status).toBe("alerta");
  });

  it("aceita macro com espaços e ID fixo", () => {
    expect(avaliarParametros("utm_source=meta&utm_campaign_id={{ campaign.id }}&utm_adset_id=120200000000002&utm_ad_id={{ad.id}}").status).toBe("ok");
  });
});

describe("montarUrlTeste", () => {
  it("troca as macros pelos valores reais e mantém o caminho", () => {
    const url = new URL(
      montarUrlTeste("https://www.exemplo.com.br/lp", PARAMETROS_META, {
        "campaign.id": "1201",
        "adset.id": "1202",
        "ad.id": "1203",
        "campaign.name": "Cadastro Out",
        "adset.name": "Amplo",
        "ad.name": "A1 gaveta",
      }),
    );
    expect(url.pathname).toBe("/lp");
    expect(url.searchParams.get("utm_ad_id")).toBe("1203");
    expect(url.searchParams.get("utm_campaign")).toBe("Cadastro Out");
    expect(url.searchParams.get("fbclid")).toMatch(/^teste_rastreio_/);
  });
});

describe("conferirLead", () => {
  const esperado = { utm_source: "meta", utm_campaign_id: "1201", utm_adset_id: "1202", utm_ad_id: "1203" };
  const base = { utm_source: "meta", utm_campaign_id: "1201", utm_adset_id: "1202", utm_ad_id: "1203", ftp_utm_ad_id: null, ad_id: "1203", atribuicao: "ultimo_toque" };

  it("tudo certo", () => {
    expect(statusDoResultado(conferirLead(base, esperado))).toBe("ok");
  });

  it("ID do anúncio perdido é problema", () => {
    const r = conferirLead({ ...base, utm_ad_id: null, ad_id: null, atribuicao: "so_campanha" }, esperado);
    expect(statusDoResultado(r)).toBe("problema");
    expect(r.find((c) => c.campo === "utm_ad_id")?.correcao).toBeTruthy();
  });

  it("primeiro toque de outro anúncio é só alerta", () => {
    const r = conferirLead({ ...base, ftp_utm_ad_id: "9999" }, esperado);
    expect(statusDoResultado(r)).toBe("ok");
    expect(r.at(-1)).toMatchObject({ campo: "primeiro toque", alerta: true });
  });
});
