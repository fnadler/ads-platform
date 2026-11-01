import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerSegredo, type SegredoMeta } from "@/lib/conexoes/segredos";
import { ClienteMetaEscrita } from "@/lib/integracoes/metaEscrita";
import type { ResultadoJob, Sincronizacao } from "@/lib/jobs/tipos";
import { payloadAnuncio, payloadCampanha, payloadConjunto, payloadCriativo, validarRascunho, type ConfigPublicacao, type CriativoRascunho } from "./modelo";

// Publicação de uma campanha do assistente (job da fila, alvo = id da campanha). Passos idempotentes — o id
// de cada objeto criado na Meta é gravado na hora, então uma retomada continua de onde parou sem duplicar:
//   1. mídias: vídeo vai por URL assinada (a Meta baixa), imagem vai em base64;
//   2. espera o processamento dos vídeos e pega a miniatura (reenfileira com atraso enquanto processa);
//   3. campanha → conjunto → criativo + anúncio de cada peça, tudo PAUSADO.
// Ativar é outro passo (ação na tela), nunca automático.

export const BUCKET_UPLOADS = "uploads-criativos";
const ESPERA_VIDEO_S = 30;

interface CriativoLinha extends CriativoRascunho {
  arquivo_path: string;
  mime: string | null;
  status: string;
  meta_video_id: string | null;
  meta_image_hash: string | null;
  meta_thumb_url: string | null;
  meta_creative_id: string | null;
  meta_ad_id: string | null;
}

export async function carregarContextoPublicacao(admin: SupabaseClient, organizacaoId: string, campanhaId: string) {
  const [{ data: campanha }, { data: criativos }, { data: config }, { data: org }, { data: conexao }] = await Promise.all([
    admin.from("campanhas_assistente").select("*").eq("id", campanhaId).eq("organizacao_id", organizacaoId).maybeSingle(),
    admin.from("criativos_assistente").select("*").eq("campanha_id", campanhaId).eq("organizacao_id", organizacaoId).order("ordem").order("criado_em"),
    admin.from("config_publicacao").select("*").eq("organizacao_id", organizacaoId).maybeSingle(),
    admin.from("organizacoes").select("fuso, moeda").eq("id", organizacaoId).single(),
    admin.from("conexoes").select("id, status").eq("organizacao_id", organizacaoId).eq("tipo", "meta_publicacao").maybeSingle(),
  ]);
  if (!campanha) throw new Error("Campanha não encontrada nesta organização.");
  const segredo = conexao ? await lerSegredo<SegredoMeta>(admin, organizacaoId, conexao.id) : null;
  if (!segredo) throw new Error("Organização sem conexão de publicação na Meta (Configurações → Meta (publicação)).");
  const { data: conta } = config?.account_id
    ? await admin.from("contas_anuncio").select("moeda, fuso").eq("organizacao_id", organizacaoId).eq("account_id", config.account_id).maybeSingle()
    : { data: null };
  return {
    campanha,
    criativos: (criativos ?? []) as CriativoLinha[],
    config: config ? ({ ...config, teto_verba_diaria: Number(config.teto_verba_diaria) } as ConfigPublicacao) : null,
    fuso: (conta?.fuso as string) || (org?.fuso as string) || "America/Sao_Paulo",
    moeda: (conta?.moeda as string) || (org?.moeda as string) || "BRL",
    token: segredo.token,
  };
}

export async function executarPublicacao(admin: SupabaseClient, s: Sincronizacao, temTempo: () => boolean): Promise<ResultadoJob> {
  const ctx = await carregarContextoPublicacao(admin, s.organizacao_id, s.alvo);
  const { campanha, criativos, config, fuso, moeda } = ctx;
  const atualizarCampanha = (campos: Record<string, unknown>) =>
    admin.from("campanhas_assistente").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", campanha.id);
  const atualizarCriativo = (id: string, campos: Record<string, unknown>) => admin.from("criativos_assistente").update(campos).eq("id", id).eq("organizacao_id", s.organizacao_id);

  try {
    // Revalida no servidor (as mesmas regras da tela; o início no passado só vale para quem ainda não criou nada).
    const { rascunho, problemas } = validarRascunho(campanha.rascunho, criativos, config, fuso, campanha.meta_campaign_id ? new Date(0) : new Date());
    if (!rascunho || !config || problemas.length) throw new Error(problemas.map((p) => p.texto).join(" "));
    const accountId = config.account_id!;
    await atualizarCampanha({ status: "criando", erro: null, account_id: accountId });
    const meta = new ClienteMetaEscrita({ token: ctx.token, admin, organizacaoId: s.organizacao_id, campanhaId: campanha.id, usuarioId: campanha.criado_por });

    // 1. Mídias
    for (const c of criativos) {
      if (!temTempo()) return { status: "continuar", cursor: { fase: "midias" }, linhas: 0 };
      if (c.tipo === "video" && !c.meta_video_id) {
        const { data: assinada, error } = await admin.storage.from(BUCKET_UPLOADS).createSignedUrl(c.arquivo_path, 3600);
        if (error || !assinada) throw new Error(`Arquivo de “${c.nome}” não encontrado no Storage.`);
        const id = await meta.enviarVideo(accountId, assinada.signedUrl, c.nome);
        await atualizarCriativo(c.id, { meta_video_id: id, status: "enviado", erro: null });
        c.meta_video_id = id;
      }
      if (c.tipo === "imagem" && !c.meta_image_hash) {
        const { data: arquivo, error } = await admin.storage.from(BUCKET_UPLOADS).download(c.arquivo_path);
        if (error || !arquivo) throw new Error(`Arquivo de “${c.nome}” não encontrado no Storage.`);
        const hash = await meta.enviarImagem(accountId, Buffer.from(await arquivo.arrayBuffer()).toString("base64"), c.nome);
        await atualizarCriativo(c.id, { meta_image_hash: hash, status: "processado", erro: null });
        c.meta_image_hash = hash;
      }
    }

    // 2. Processamento dos vídeos (a Meta leva de segundos a alguns minutos)
    for (const c of criativos.filter((x) => x.tipo === "video" && !x.meta_thumb_url)) {
      const { situacao } = await meta.situacaoVideo(c.meta_video_id!);
      if (situacao === "error") throw new Error(`A Meta não conseguiu processar o vídeo “${c.nome}”. Confira o arquivo (MP4/MOV, até 50 MB) e envie de novo.`);
      if (situacao !== "ready") return { status: "continuar", cursor: { fase: "processando" }, linhas: 0, atrasoSegundos: ESPERA_VIDEO_S };
      const thumb = await meta.miniaturaVideo(c.meta_video_id!);
      if (!thumb) return { status: "continuar", cursor: { fase: "miniatura" }, linhas: 0, atrasoSegundos: ESPERA_VIDEO_S };
      await atualizarCriativo(c.id, { meta_thumb_url: thumb, status: "processado" });
      c.meta_thumb_url = thumb;
    }

    // 3. Campanha → conjunto → criativos e anúncios (tudo pausado)
    let campaignId = campanha.meta_campaign_id as string | null;
    if (!campaignId) {
      campaignId = (await meta.criar(accountId, "campaigns", payloadCampanha(campanha.nome))).id!;
      await atualizarCampanha({ meta_campaign_id: campaignId });
    }
    let adsetId = campanha.meta_adset_id as string | null;
    if (!adsetId) {
      adsetId = (await meta.criar(accountId, "adsets", payloadConjunto(campanha.nome, campaignId, rascunho, config, moeda, fuso))).id!;
      await atualizarCampanha({ meta_adset_id: adsetId });
    }
    let criados = 0;
    for (const c of criativos) {
      if (!temTempo()) return { status: "continuar", cursor: { fase: "anuncios" }, linhas: criados };
      let creativeId = c.meta_creative_id;
      if (!creativeId) {
        creativeId = (await meta.criar(accountId, "adcreatives", payloadCriativo(c, rascunho, config, { video_id: c.meta_video_id, thumb_url: c.meta_thumb_url, image_hash: c.meta_image_hash }))).id!;
        await atualizarCriativo(c.id, { meta_creative_id: creativeId });
      }
      if (!c.meta_ad_id) {
        const adId = (await meta.criar(accountId, "ads", payloadAnuncio(c, adsetId, creativeId))).id!;
        await atualizarCriativo(c.id, { meta_ad_id: adId, status: "criado" });
        criados++;
      }
    }
    await atualizarCampanha({ status: "criada", erro: null });
    return { status: "pronto", linhas: criados };
  } catch (e) {
    await atualizarCampanha({ status: "erro", erro: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
