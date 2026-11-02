// Assistente de configuração: quais telas cada negócio vê, o que falta e a conferência da página.
import { describe, expect, it } from "vitest";
import { SCRIPT_CHECKOUT } from "@/lib/vendas/plataformas/catalogo";
import { configuracaoEmAndamento, funilSugerido, pendentes, permissoesDoToken, progresso, telaInicial, telas, type Fatos, type Onboarding } from "./modelo";
import { analisarPagina, ipPrivado, pixelsNaPagina, temScriptCheckout, validarUrlPagina } from "./pagina";

const hotmart: Onboarding = { plataforma: "hotmart", funil: "venda_direta", site: "eu", campanhas: "sim" };
const fatos = (extra: Partial<Fatos> = {}): Fatos => ({
  onboarding: {},
  temToken: false,
  temPublicacao: false,
  contaAtiva: false,
  pixelId: null,
  paginaFacebookId: null,
  stripeAtivo: false,
  webhookAtivo: false,
  plataformaAtiva: false,
  plataformaEmTeste: true,
  eventosPlataforma: 0,
  eventoComAnuncio: false,
  testeLeadOk: false,
  ...extra,
});
const tudoCerto = (onboarding: Onboarding): Fatos =>
  fatos({
    onboarding,
    temToken: true,
    temPublicacao: true,
    contaAtiva: true,
    pixelId: "1741",
    paginaFacebookId: "55",
    plataformaAtiva: true,
    eventosPlataforma: 2,
    eventoComAnuncio: true,
    stripeAtivo: true,
    webhookAtivo: true,
    testeLeadOk: true,
  });

describe("telas", () => {
  it("o caminho muda com as respostas", () => {
    expect(telas(fatos({ onboarding: { ...hotmart, campanhas: "sim" } })).map((t) => t.id)).not.toContain("parametros");
    expect(telas(fatos({ onboarding: { ...hotmart, campanhas: "nao" } })).map((t) => t.id)).toContain("parametros");
    expect(telas(fatos({ onboarding: hotmart })).find((t) => t.id === "venda")?.titulo).toBe("Conectar a Hotmart");
    expect(telas(fatos({ onboarding: { plataforma: "stripe" } })).find((t) => t.id === "teste")?.titulo).toBe("Cadastro de teste");
  });

  it("começa pela primeira pergunta e retoma pelo começo do passo a passo da Meta", () => {
    expect(telaInicial(fatos())).toBe("negocio");
    expect(telaInicial(fatos({ onboarding: hotmart }))).toBe("meta-acesso");
    expect(telaInicial(fatos({ onboarding: hotmart, temToken: true }))).toBe("meta-escolhas");
  });

  it("um token removido volta a ser pendência", () => {
    expect(pendentes(tudoCerto({ ...hotmart, destino: "checkout" }))).toEqual([]);
    expect(pendentes({ ...tudoCerto({ ...hotmart, destino: "checkout" }), temToken: false }).map((t) => t.id)).toEqual(["meta-token"]);
  });

  it("quem só acompanha não precisa de Página nem de publicação", () => {
    const o: Onboarding = { ...hotmart, campanhas: "nao", destino: "checkout" };
    expect(pendentes(fatos({ onboarding: o, temToken: true, contaAtiva: true, pixelId: "1" })).map((t) => t.id)).not.toContain("meta-escolhas");
    expect(pendentes(fatos({ onboarding: { ...o, campanhas: "sim" }, temToken: true, contaAtiva: true, pixelId: "1" })).map((t) => t.id)).toContain("meta-escolhas");
  });

  it("Hotmart: venda exige evento recebido, e o teste exige evento com o anúncio", () => {
    const o: Onboarding = { ...hotmart, destino: "checkout" };
    const base = tudoCerto(o);
    expect(pendentes({ ...base, eventosPlataforma: 0, eventoComAnuncio: false }).map((t) => t.id)).toEqual(["venda", "teste"]);
    expect(pendentes({ ...base, eventoComAnuncio: false }).map((t) => t.id)).toEqual(["teste"]);
  });

  it("página: checkout direto dispensa a conferência; erro continua pendente; aviso libera", () => {
    const f = (o: Onboarding) => pendentes(tudoCerto(o)).map((t) => t.id);
    expect(f({ ...hotmart, destino: "pagina" })).toEqual(["pagina"]);
    expect(f({ ...hotmart, destino: "pagina", pagina: { url: "u", status: "erro", itens: [], em: "" } })).toEqual(["pagina"]);
    expect(f({ ...hotmart, destino: "pagina", pagina: { url: "u", status: "aviso", itens: [], em: "" } })).toEqual([]);
    expect(f({ plataforma: "stripe", funil: "cadastro_teste_venda", site: "dev", campanhas: "sim", destino: "checkout" })).toEqual(["pagina"]);
  });

  it("progresso conta só o que é conferido", () => {
    expect(progresso(fatos())).toBe(0);
    expect(progresso(tudoCerto({ ...hotmart, destino: "checkout" }))).toBe(100);
  });
});

describe("apoios do modelo", () => {
  it("permissões e funil sugerido", () => {
    expect(permissoesDoToken(false)).toEqual(["ads_read"]);
    expect(permissoesDoToken(true)).toContain("ads_management");
    expect(funilSugerido("hotmart")).toBe("venda_direta");
    expect(funilSugerido("stripe")).toBe("cadastro_teste_venda");
  });

  it("convite para configurar: some para quem concluiu ou já está rodando", () => {
    expect(configuracaoEmAndamento(fatos(), false)).toBe(true);
    expect(configuracaoEmAndamento(fatos({ onboarding: { concluido_em: "2026-11-02" } }), false)).toBe(false);
    expect(configuracaoEmAndamento(fatos({ temToken: true, contaAtiva: true }), true)).toBe(false);
  });
});

describe("endereços que o servidor abre", () => {
  it.each(["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"])(
    "%s é privado",
    (ip) => {
      expect(ipPrivado(ip)).toBe(true);
    },
  );

  it.each(["8.8.8.8", "172.32.0.1", "2606:4700::1111"])("%s é público", (ip) => {
    expect(ipPrivado(ip)).toBe(false);
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest",
    "https://intranet/",
    "ftp://x.com/",
    "https://user:senha@x.com/",
    "https://x.com:8080/",
    "http://[::1]/",
    "nao é url",
  ])("recusa %s", (u) => {
    expect("erro" in validarUrlPagina(u)).toBe(true);
  });

  it("aceita página pública e completa o https", () => {
    const r = validarUrlPagina("www.sualoja.com.br/pagina");
    expect("url" in r && r.url.toString()).toBe("https://www.sualoja.com.br/pagina");
  });
});

describe("conferência da página", () => {
  const base = { url: "https://x.com/", status: 200, em: "2026-11-02T00:00:00Z" };
  const pixel = "<script>fbq('init', '1741074303627470');</script>";

  it("acha o pixel no código e na imagem de reserva", () => {
    expect(pixelsNaPagina(pixel)).toEqual(["1741074303627470"]);
    expect(pixelsNaPagina('<img src="https://www.facebook.com/tr?id=99988877766&ev=PageView">')).toEqual(["99988877766"]);
  });

  it("reconhece a linha de rastreio que o sistema entrega", () => {
    expect(temScriptCheckout(SCRIPT_CHECKOUT)).toBe(true);
    expect(temScriptCheckout("<html></html>")).toBe(false);
  });

  it("tudo certo", () => {
    expect(analisarPagina({ ...base, html: pixel + SCRIPT_CHECKOUT, pixelEsperado: "1741074303627470", exigeScript: true }).status).toBe("ok");
  });

  it("pixel diferente é erro e diz qual está na página", () => {
    const r = analisarPagina({ ...base, html: "<script>fbq('init','9998887776665554')</script>", pixelEsperado: "1741074303627470", exigeScript: false });
    expect(r.status).toBe("erro");
    expect(r.itens.at(-1)?.detalhe).toContain("9998887776665554");
  });

  it("pixel invisível é só aviso, e menciona o gerenciador de tags", () => {
    const r = analisarPagina({ ...base, html: '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script>', pixelEsperado: "1741074303627470", exigeScript: false });
    expect(r.status).toBe("aviso");
    expect(r.itens.at(-1)?.detalhe).toContain("Tag Manager");
  });

  it("sem a linha de rastreio, quando ela é exigida, é erro", () => {
    expect(analisarPagina({ ...base, html: pixel, pixelEsperado: "1741074303627470", exigeScript: true }).status).toBe("erro");
    expect(analisarPagina({ ...base, html: pixel, pixelEsperado: "1741074303627470", exigeScript: false }).status).toBe("ok");
  });

  it("página fora do ar para na primeira checagem", () => {
    const r = analisarPagina({ ...base, status: 404, html: "", pixelEsperado: "1", exigeScript: true });
    expect(r.status).toBe("erro");
    expect(r.itens).toHaveLength(1);
  });
});
