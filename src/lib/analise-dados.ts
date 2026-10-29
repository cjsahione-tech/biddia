// Arruma os dados que a IA (Agente Analista) devolve antes de GRAVAR e antes de DESENHAR na tela.
// A IA às vezes foge do formato pedido — ex.: num edital republicado, sem seção de habilitação, devolveu
// `habilitacao: [{"categoriaEdital":"não encontrado no texto do edital"}]` (grupo SEM a lista `itens`).
// Quem esperava `itens` quebrava: a tela caía com "This page couldn't load" (React: objeto como filho) e o
// Agente Secretário falhava. Estas funções aceitam qualquer formato e devolvem só texto/listas seguras.

export type GrupoHabilitacao = { categoriaEdital: string | null; itens: string[] };

/** Qualquer valor vira texto simples (nunca objeto): objeto vira os textos que ele contém, separados por " — ". */
export function paraTexto(valor: unknown): string {
  if (valor == null) return "";
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (Array.isArray(valor)) return valor.map(paraTexto).filter(Boolean).join("; ");
  if (typeof valor === "object") {
    const partes = Object.values(valor as Record<string, unknown>)
      .map(paraTexto)
      .filter(Boolean);
    return partes.join(" — ");
  }
  return "";
}

/** Lista de textos: aceita lista de qualquer coisa, um texto solto ou lixo (vira lista vazia). */
export function normalizarLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map(paraTexto).filter(Boolean);
  const t = paraTexto(valor);
  return t ? [t] : [];
}

/**
 * Grupos de habilitação {categoriaEdital, itens[]}. Aceita o formato atual, o antigo (lista plana de
 * textos — vira um grupo sem cabeçalho) e grupos malformados (sem `itens`, com itens que não são texto):
 * grupo sem nenhum item não tem o que mostrar e é descartado.
 */
export function normalizarGruposHabilitacao(valor: unknown): GrupoHabilitacao[] {
  if (!Array.isArray(valor)) return [];
  const soltos: string[] = [];
  const grupos: GrupoHabilitacao[] = [];
  for (const g of valor) {
    if (g && typeof g === "object" && !Array.isArray(g)) {
      const o = g as Record<string, unknown>;
      const itens = normalizarLista(o.itens);
      const categoria = typeof o.categoriaEdital === "string" && o.categoriaEdital.trim() ? o.categoriaEdital.trim() : null;
      if (itens.length > 0) grupos.push({ categoriaEdital: categoria, itens });
    } else {
      const t = paraTexto(g);
      if (t) soltos.push(t);
    }
  }
  return soltos.length > 0 ? [{ categoriaEdital: null, itens: soltos }, ...grupos] : grupos;
}

export type PrazoEdital = { tipo: string; prazo: string; referencia: string | null };

/** Prazos do edital {tipo, prazo, referencia}: só os que têm tipo e prazo em texto; o resto some. */
export function normalizarPrazos(valor: unknown): PrazoEdital[] {
  if (!Array.isArray(valor)) return [];
  const prazos: PrazoEdital[] = [];
  for (const p of valor) {
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    const o = p as Record<string, unknown>;
    const tipo = paraTexto(o.tipo);
    const prazo = paraTexto(o.prazo);
    if (tipo && prazo) prazos.push({ tipo, prazo, referencia: paraTexto(o.referencia) || null });
  }
  return prazos;
}

export function lerPrazos(json: string | null | undefined): PrazoEdital[] {
  if (!json) return [];
  try {
    return normalizarPrazos(JSON.parse(json));
  } catch {
    return [];
  }
}

/** JSON gravado no banco → grupos seguros (JSON inválido = lista vazia). */
export function lerGruposHabilitacao(json: string | null | undefined): GrupoHabilitacao[] {
  if (!json) return [];
  try {
    return normalizarGruposHabilitacao(JSON.parse(json));
  } catch {
    return [];
  }
}

/** JSON gravado no banco → lista de textos segura (JSON inválido = lista vazia). */
export function lerLista(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    return normalizarLista(JSON.parse(json));
  } catch {
    return [];
  }
}

// ── Obrigações (contratada e contratante) ───────────────────────────────────
//
// Antes, o campo `obrigacoesContratada` guardava só uma lista de textos (as obrigações da contratada). Agora a
// análise também separa as obrigações da CONTRATANTE (o órgão). Para não mexer no banco, as duas listas ficam no
// mesmo campo, como um objeto { contratada, contratante }. Análises antigas (lista simples) continuam valendo:
// são lidas como "só contratada". Se um dia houver uma coluna própria para a contratante, basta mover.

export type ObrigacoesAnalise = { contratada: string[]; contratante: string[] };

export function normalizarObrigacoes(valor: unknown): ObrigacoesAnalise {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    const o = valor as Record<string, unknown>;
    return { contratada: normalizarLista(o.contratada), contratante: normalizarLista(o.contratante) };
  }
  return { contratada: normalizarLista(valor), contratante: [] };
}

/** JSON do campo → obrigações das duas partes (aceita o formato antigo; JSON inválido = listas vazias). */
export function lerObrigacoes(json: string | null | undefined): ObrigacoesAnalise {
  if (!json) return { contratada: [], contratante: [] };
  try {
    return normalizarObrigacoes(JSON.parse(json));
  } catch {
    return { contratada: [], contratante: [] };
  }
}

/** Texto gravado no campo: o objeto com as duas listas. */
export function serializarObrigacoes(o: ObrigacoesAnalise): string {
  return JSON.stringify({ contratada: o.contratada, contratante: o.contratante });
}

// ── Pontos de atenção ───────────────────────────────────────────────────────

const ROTULO_GRAVIDADE: Record<string, string> = { alta: "Alta", media: "Média", média: "Média", baixa: "Baixa" };

/**
 * Pontos de atenção do edital. A IA devolve objetos { descricao, trecho, gravidade } (ou textos soltos); cada um vira UMA
 * linha de texto: "Gravidade — descrição (trecho: «…»)". Ponto sem descrição é descartado.
 */
export function normalizarPontosDeAtencao(valor: unknown): string[] {
  if (!Array.isArray(valor)) return normalizarLista(valor);
  const linhas: string[] = [];
  for (const p of valor) {
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const o = p as Record<string, unknown>;
      const descricao = paraTexto(o.descricao);
      if (!descricao) continue;
      const trecho = paraTexto(o.trecho);
      const gravidade = ROTULO_GRAVIDADE[paraTexto(o.gravidade).toLowerCase()];
      linhas.push(`${gravidade ? `${gravidade} — ` : ""}${descricao}${trecho ? ` (trecho: «${trecho}»)` : ""}`);
    } else {
      const t = paraTexto(p);
      if (t) linhas.push(t);
    }
  }
  return linhas;
}
