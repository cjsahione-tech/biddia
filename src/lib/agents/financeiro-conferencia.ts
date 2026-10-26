// Conferência da planilha do Agente Financeiro ANTES de ela ser entregue: contas e checagens que não gastam IA.
// O agente lê a tabela com a IA e depois confere o resultado aqui; só o que não fecha volta para uma segunda leitura
// mais cuidadosa (ver agente3-financeiro.ts). Regra de ouro: quando não dá para provar que está certo, avisa.

export type ItemConferivel = {
  numero?: number | null;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  /** Valor total da linha como está IMPRESSO na tabela do edital (null = a tabela não tem essa coluna). */
  valorTotalLinha?: number | null;
  lote?: string | null;
  /** Em qual trecho (bloco) do texto o item foi lido — usado para reler só o trecho suspeito. */
  bloco?: number;
};

export type ProblemaLinha = {
  indice: number;
  tipo: "TOTAL_NAO_BATE" | "QUANTIDADE_INVALIDA" | "VALOR_INVALIDO";
  /** Quantidade × valor unitário, como está na lista. */
  calculado?: number;
  /** Total que o edital imprime na linha. */
  impresso?: number;
};

export type LacunaDeNumeracao = {
  lote: string | null;
  /** Números de item que deviam existir (pela sequência) e não vieram. */
  faltando: number[];
  /** Trechos do texto onde esses itens deviam estar (do vizinho de antes ao de depois). */
  blocos: number[];
};

/** Converte o que a IA devolveu em número: aceita número, "1234.56" e o formato brasileiro "1.234,56". */
export function paraNumero(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const s = v.replace(/[R$\s]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s);
}

/** Diferença aceitável entre quantidade × unitário e o total impresso: o unitário aparece arredondado em centavos. */
function tolerancia(quantidade: number): number {
  return 0.02 + 0.005 * quantidade;
}

/** Confere linha a linha: quantidade × valor unitário tem que dar o total que o edital imprime na própria linha. */
export function conferirLinhas(itens: ItemConferivel[]): ProblemaLinha[] {
  const problemas: ProblemaLinha[] = [];
  itens.forEach((it, indice) => {
    const q = paraNumero(it.quantidade);
    const u = paraNumero(it.valorUnitario);
    const impresso = it.valorTotalLinha == null ? NaN : paraNumero(it.valorTotalLinha);

    if (!Number.isFinite(q) || q <= 0) {
      problemas.push({ indice, tipo: "QUANTIDADE_INVALIDA" });
      return;
    }
    if (!Number.isFinite(u) || u < 0) {
      problemas.push({ indice, tipo: "VALOR_INVALIDO" });
      return;
    }
    if (!Number.isFinite(impresso) || impresso <= 0) return; // a tabela não traz o total da linha: nada a comparar
    const calculado = q * u;
    if (Math.abs(calculado - impresso) > tolerancia(q)) {
      problemas.push({ indice, tipo: "TOTAL_NAO_BATE", calculado: Number(calculado.toFixed(2)), impresso });
    }
  });
  return problemas;
}

/**
 * Procura buracos na numeração dos itens (ex.: vieram 1..13 e 16..40 — faltam o 14 e o 15). Cada lote é conferido
 * separado; se a numeração se repete dentro do mesmo grupo (lotes que recomeçam do 1 sem o lote ter sido
 * identificado) ou é muito irregular, não dá para concluir nada e não acusa buraco.
 */
export function acharLacunasDeNumeracao(itens: ItemConferivel[]): LacunaDeNumeracao[] {
  const grupos = new Map<string, ItemConferivel[]>();
  for (const it of itens) {
    const n = it.numero;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) continue;
    const chave = it.lote ?? "";
    grupos.set(chave, [...(grupos.get(chave) ?? []), it]);
  }

  const lacunas: LacunaDeNumeracao[] = [];
  for (const [chave, grupo] of grupos) {
    if (grupo.length < 4) continue;
    const numeros = grupo.map((i) => i.numero as number);
    if (new Set(numeros).size !== numeros.length) continue; // repetição: não dá para saber onde cada lote começa
    const presentes = new Set(numeros);
    const min = Math.min(...numeros);
    const max = Math.max(...numeros);
    // Se a sequência começa no 1 ou 2, o que falta antes do primeiro também conta.
    const inicio = min <= 2 ? 1 : min;
    const faltando: number[] = [];
    for (let n = inicio; n <= max; n++) if (!presentes.has(n)) faltando.push(n);
    if (faltando.length === 0) continue;
    // Numeração muito esburacada = provavelmente não é contínua de verdade; não vale acusar item por item.
    if (faltando.length > Math.max(5, (max - inicio + 1) * 0.3)) continue;

    // O item que falta pode estar em qualquer trecho entre o vizinho de antes e o de depois (no máximo 4 trechos).
    const blocos = new Set<number>();
    for (const n of faltando) {
      const antes = grupo.filter((i) => (i.numero as number) < n).sort((a, b) => (b.numero as number) - (a.numero as number))[0];
      const depois = grupo.filter((i) => (i.numero as number) > n).sort((a, b) => (a.numero as number) - (b.numero as number))[0];
      const de = typeof antes?.bloco === "number" ? antes.bloco : undefined;
      const ate = typeof depois?.bloco === "number" ? depois.bloco : undefined;
      if (de !== undefined && ate !== undefined) for (let b = de; b <= Math.min(ate, de + 3); b++) blocos.add(b);
      else if (de !== undefined) blocos.add(de);
      else if (ate !== undefined) blocos.add(ate);
    }
    lacunas.push({ lote: chave === "" ? null : chave, faltando, blocos: [...blocos].sort((a, b) => a - b) });
  }
  return lacunas;
}

/** Trechos do texto que valem uma segunda leitura: os das linhas que não fecham e os onde faltam itens. */
export function blocosSuspeitos(itens: ItemConferivel[], problemas: ProblemaLinha[], lacunas: LacunaDeNumeracao[]): number[] {
  const blocos = new Set<number>();
  for (const p of problemas) {
    const b = itens[p.indice]?.bloco;
    if (typeof b === "number") blocos.add(b);
  }
  for (const l of lacunas) for (const b of l.blocos) blocos.add(b);
  return [...blocos].sort((a, b) => a - b);
}

/** Quantos defeitos a lista tem (linhas que não fecham + itens faltando): a segunda leitura só vale se baixar isso. */
export function pontuarDefeitos(itens: ItemConferivel[]): number {
  const faltando = acharLacunasDeNumeracao(itens).reduce((soma, l) => soma + l.faltando.length, 0);
  return conferirLinhas(itens).length + faltando;
}

/**
 * Totais que o próprio texto do edital declara ("Valor total estimado: R$ 1.234.567,89", "Valor global", "Total geral"…).
 * Procura de forma literal no texto (nada inventado pela IA): serve para ver se a soma dos itens bate com algum deles.
 */
export function totaisDeclaradosNoTexto(texto: string): number[] {
  const achados = new Set<number>();
  const re = /(?:valor|pre[çc]o|custo)\s+(?:total|global|estimado\s+total|total\s+estimado)[^\n]{0,80}?R\$\s*([\d]{1,3}(?:\.\d{3})*,\d{2})|(?:total\s+geral|valor\s+global|total\s+do\s+lote|total\s+estimado)[^\n]{0,60}?R\$\s*([\d]{1,3}(?:\.\d{3})*,\d{2})/gi;
  for (const m of texto.matchAll(re)) {
    const v = paraNumero(m[1] ?? m[2]);
    if (Number.isFinite(v) && v > 0) achados.add(Number(v.toFixed(2)));
  }
  return [...achados];
}

export type ResultadoTotais = {
  /** Algum total declarado (no texto ou no PNCP) bate com a soma dos itens (ou de um lote)? */
  confere: boolean;
  /** Qual valor bateu, para mostrar ao usuário. */
  valorQueBateu?: number;
  /** O MAIOR total que o texto declara é maior que a soma dos itens: sinal de que podem faltar itens. */
  declaradoMaior?: number;
};

/**
 * A soma dos itens (inteira ou por lote) bate, com folga de 0,5%, com algum total que o edital declara (no texto ou
 * no PNCP)? Só acusa quando o MAIOR total do texto é maior que a soma: totais menores que a soma podem ser de uma
 * linha ou de um lote, e não provam nada; um total geral maior que a soma sugere item faltando.
 */
export function compararComTotais(
  somaItens: number,
  somaPorLote: number[],
  totaisNoTexto: number[],
  outrosTotais: number[] = []
): ResultadoTotais {
  const candidatos = [somaItens, ...somaPorLote];
  for (const alvo of [...totaisNoTexto, ...outrosTotais]) {
    for (const c of candidatos) {
      if (alvo > 0 && Math.abs(c - alvo) <= Math.max(0.05, alvo * 0.005)) return { confere: true, valorQueBateu: alvo };
    }
  }
  const maior = totaisNoTexto.length > 0 ? Math.max(...totaisNoTexto) : 0;
  if (maior > somaItens * 1.005 + 0.05) return { confere: false, declaradoMaior: maior };
  return { confere: false };
}

export type Veredito = {
  /** CONFERIDA = tudo que dava para conferir fechou; PARCIAL = nada errado, mas pouco foi conferível; DIVERGENTE = há defeito. */
  status: "CONFERIDA" | "PARCIAL" | "DIVERGENTE";
  linhasConferidas: number;
  linhasComDefeito: number;
  itensFaltando: number;
  /** Frases prontas (em português) para mostrar ao usuário. */
  avisos: string[];
};

export function montarVeredito(args: {
  itens: ItemConferivel[];
  totais: ResultadoTotais;
  /** Quantos itens vieram com preço sugerido pela IA porque o edital não publicou preço. */
  precosEstimados?: number;
}): Veredito {
  const problemas = conferirLinhas(args.itens);
  const lacunas = acharLacunasDeNumeracao(args.itens);
  const itensFaltando = lacunas.reduce((s, l) => s + l.faltando.length, 0);
  const linhasConferidas = args.itens.filter((i) => {
    const t = i.valorTotalLinha == null ? NaN : paraNumero(i.valorTotalLinha);
    return Number.isFinite(t) && t > 0;
  }).length;
  const avisos: string[] = [];

  for (const p of problemas.slice(0, 5)) {
    const it = args.itens[p.indice];
    const nome = `${it.numero != null ? `item ${it.numero} ` : ""}"${it.descricao.slice(0, 50)}"`;
    if (p.tipo === "TOTAL_NAO_BATE") {
      avisos.push(`${nome}: quantidade × valor unitário dá R$ ${p.calculado?.toFixed(2)}, mas o edital imprime R$ ${p.impresso?.toFixed(2)} na linha`);
    } else if (p.tipo === "QUANTIDADE_INVALIDA") {
      avisos.push(`${nome}: quantidade inválida`);
    } else {
      avisos.push(`${nome}: valor unitário inválido`);
    }
  }
  if (problemas.length > 5) avisos.push(`e mais ${problemas.length - 5} linha(s) que não fecham`);
  for (const l of lacunas) {
    const lista = l.faltando.slice(0, 8).join(", ") + (l.faltando.length > 8 ? "…" : "");
    avisos.push(`faltam itens na sequência${l.lote ? ` do lote ${l.lote}` : ""}: ${lista}`);
  }
  if (args.totais.declaradoMaior) {
    avisos.push(`o edital declara um total de R$ ${args.totais.declaradoMaior.toFixed(2)}, maior que a soma dos itens — podem faltar itens`);
  }
  if (args.precosEstimados) avisos.push(`${args.precosEstimados} preço(s) foram sugeridos pela Bidd.IA porque o edital não os publicou`);

  const defeitos = problemas.length + itensFaltando + (args.totais.declaradoMaior ? 1 : 0);
  const status: Veredito["status"] =
    defeitos > 0 ? "DIVERGENTE" : linhasConferidas >= Math.max(3, args.itens.length * 0.5) || args.totais.confere ? "CONFERIDA" : "PARCIAL";
  return { status, linhasConferidas, linhasComDefeito: problemas.length, itensFaltando, avisos };
}
