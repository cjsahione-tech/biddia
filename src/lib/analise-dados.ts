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
