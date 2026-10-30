/**
 * Leitura de planilha "proposta final" de um edital ganho — aceita QUALQUER Excel/CSV.
 *
 * Funções puras (sem tela, sem banco, sem exceljs): recebem a planilha já convertida em
 * uma tabela de células (`Matriz`), descobrem sozinhas qual linha é o cabeçalho e qual
 * coluna é o quê (descrição, quantidade, valor unitário…), e devolvem os itens. Quem abre
 * o arquivo de verdade (xlsx/csv) está em planilha-resultado-leitura.ts.
 *
 * Regra de ouro: o usuário SEMPRE confere o que foi lido antes de salvar — por isso a
 * leitura devolve também as colunas e o mapeamento usado, para a tela poder mostrar e
 * permitir trocar a coluna quando a detecção automática errar.
 */
import { lerNumeroBR } from "@/lib/numero-br";
import { round2 } from "@/lib/proposal";

export type Celula = string | number | null;
export type Matriz = Celula[][];

export type PapelColuna = "numero" | "descricao" | "unidade" | "quantidade" | "valorUnitario" | "valorTotal";

/** Índice (0 = primeira coluna) de cada papel; null/ausente = nenhuma coluna. */
export type Mapeamento = Partial<Record<PapelColuna, number | null>>;

export const PAPEIS_COLUNA: { papel: PapelColuna; rotulo: string; obrigatorio: boolean }[] = [
  { papel: "descricao", rotulo: "Descrição do item", obrigatorio: true },
  { papel: "quantidade", rotulo: "Quantidade", obrigatorio: true },
  { papel: "valorUnitario", rotulo: "Valor unitário", obrigatorio: true },
  { papel: "unidade", rotulo: "Unidade", obrigatorio: false },
  { papel: "numero", rotulo: "Nº do item", obrigatorio: false },
  { papel: "valorTotal", rotulo: "Valor total", obrigatorio: false },
];

export type ItemResultado = {
  numero: number | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
};

export type ColunaPlanilha = { indice: number; titulo: string };

/** Limite de itens por resultado — acima disso a planilha provavelmente não é a lista de itens certa. */
export const MAX_ITENS_RESULTADO = 2000;

/** Resultado registrado de um edital ganho, como a tela recebe da API. */
export type ResultadoEditalDados = {
  valorHomologado: number;
  itens: ItemResultado[];
  nomeArquivo: string | null;
  documentoId: string | null;
  atualizadoEm: string;
};

/** itensJson salvo no banco → lista de itens (tolerante a JSON inválido). */
export function parseItensResultado(itensJson: string | null | undefined): ItemResultado[] {
  if (!itensJson) return [];
  try {
    const bruto = JSON.parse(itensJson);
    if (!Array.isArray(bruto)) return [];
    return bruto
      .filter((i) => i && typeof i.descricao === "string" && Number.isFinite(i.quantidade) && Number.isFinite(i.valorUnitario))
      .map(
        (i): ItemResultado => ({
          numero: Number.isInteger(i.numero) ? i.numero : null,
          descricao: i.descricao,
          unidade: typeof i.unidade === "string" && i.unidade ? i.unidade : "un",
          quantidade: i.quantidade,
          valorUnitario: i.valorUnitario,
          valorTotal: Number.isFinite(i.valorTotal) ? i.valorTotal : round2(i.quantidade * i.valorUnitario),
        })
      );
  } catch {
    return [];
  }
}

export type LeituraPlanilha = {
  nomeAba: string | null;
  /** Índice (0 = primeira linha) da linha de cabeçalho encontrada. */
  linhaCabecalho: number;
  colunas: ColunaPlanilha[];
  mapeamento: Mapeamento;
  itens: ItemResultado[];
  avisos: string[];
  /** Papéis obrigatórios que ficaram sem coluna — a tela pede para o usuário escolher. */
  faltando: PapelColuna[];
};

const LINHAS_PROCURANDO_CABECALHO = 25;
const MAX_COLUNAS = 40;
const MAX_AVISOS_POR_TIPO = 5;

// ───────────────────────────── texto e números ─────────────────────────────

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textoDa(celula: Celula | undefined): string {
  if (celula == null) return "";
  return typeof celula === "number" ? String(celula) : celula.trim();
}

function numeroDa(celula: Celula | undefined): number | null {
  if (celula == null) return null;
  if (typeof celula === "number") return Number.isFinite(celula) ? celula : null;
  return lerNumeroBR(celula);
}

/** 0 → A, 25 → Z, 26 → AA… (igual ao Excel). */
export function letraColuna(indice: number): string {
  let n = indice;
  let letras = "";
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letras;
}

// ───────────────────────────── CSV ─────────────────────────────

/** Texto do arquivo: tenta UTF-8; se vier com caracteres quebrados (Excel brasileiro salva em Windows-1252), relê assim. */
export function decodificarTexto(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function detectarDelimitador(texto: string): string {
  const amostra = texto
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 10)
    .map((l) => l.replace(/"[^"]*"/g, ""));
  let melhor = ";";
  let maior = -1;
  for (const d of [";", "\t", ","]) {
    const total = amostra.reduce((acc, l) => acc + l.split(d).length - 1, 0);
    if (total > maior) {
      maior = total;
      melhor = d;
    }
  }
  return melhor;
}

/** CSV → Matriz. Entende aspas, vírgula/ponto e vírgula/tab como separador e quebras de linha do Windows. */
export function csvParaMatriz(texto: string): Matriz {
  const t = texto.replace(/^﻿/, "");
  const delimitador = detectarDelimitador(t);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let entreAspas = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreAspas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === delimitador) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      campo = "";
      linhas.push(linha);
      linha = [];
    } else {
      campo += c;
    }
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.map((l) => l.map((v) => (v.trim() === "" ? null : v)));
}

// ───────────────────────────── descobrir as colunas ─────────────────────────────

const PALAVRAS_NUMERO_ITEM = new Set(["item", "n", "no", "nr", "num", "numero", "seq", "sequencial", "ordem", "do", "de"]);

function papelDoCabecalho(titulo: string): PapelColuna | null {
  const h = normalizar(titulo);
  if (!h) return null;
  const tokens = h.split(" ");
  const tem = (...palavras: string[]) => palavras.some((p) => tokens.includes(p));
  const comeca = (...prefixos: string[]) => tokens.some((t) => prefixos.some((p) => t.startsWith(p)));

  // "unit", "unitário", "v unit"… só se usam para preço.
  if (comeca("unit")) return "valorUnitario";
  if (comeca("quantid", "quant", "qtd", "qtde") || tokens.includes("qt")) return "quantidade";
  if (tem("total") || comeca("subtotal")) return "valorTotal";
  if (comeca("unidade", "unid") || tem("un", "und", "um", "medida")) return "unidade";
  if (comeca("descri", "produto", "material", "objeto", "especific", "servico", "denominacao", "nome")) return "descricao";
  if (tokens.every((t) => PALAVRAS_NUMERO_ITEM.has(t)) && tokens.some((t) => t !== "do" && t !== "de")) return "numero";
  // "Valor" / "Preço" soltos: quase sempre é o preço unitário (peso fraco na hora de escolher).
  if (tem("valor", "vlr", "vl", "preco", "custo")) return "valorUnitario";
  return null;
}

/** Quando há mais de uma coluna de valor unitário (ex.: "referência" e "proposta final"), prefere a da proposta. */
function pesoValorUnitario(titulo: string): number {
  const h = normalizar(titulo);
  let peso = 0;
  if (/\bunit/.test(h)) peso += 2;
  if (/(final|propost|ofert|lance|homolog|negoci|vencedor|adjudic)/.test(h)) peso += 3;
  if (/(referenc|estimad|maxim|orcad|edital|base|teto)/.test(h)) peso -= 3;
  return peso;
}

function textoColuna(linha: Celula[] | undefined, indice: number): string {
  return textoDa(linha?.[indice]);
}

function larguraDaMatriz(matriz: Matriz): number {
  let largura = 0;
  for (const linha of matriz) if (linha.length > largura) largura = linha.length;
  return Math.min(largura, MAX_COLUNAS);
}

type Deteccao = { linhaCabecalho: number; mapeamento: Mapeamento; avisos: string[] };

export function detectarMapeamento(matriz: Matriz): Deteccao {
  let melhor: { linha: number; score: number; candidatos: Map<PapelColuna, number[]> } | null = null;

  const limite = Math.min(matriz.length, LINHAS_PROCURANDO_CABECALHO);
  for (let i = 0; i < limite; i++) {
    const candidatos = new Map<PapelColuna, number[]>();
    const linha = matriz[i] ?? [];
    for (let c = 0; c < Math.min(linha.length, MAX_COLUNAS); c++) {
      const titulo = textoDa(linha[c]);
      // Cabeçalho é texto; uma célula só de número não é título de coluna.
      if (!titulo || /^[\d.,\s]+$/.test(titulo)) continue;
      const papel = papelDoCabecalho(titulo);
      if (!papel) continue;
      candidatos.set(papel, [...(candidatos.get(papel) ?? []), c]);
    }
    const temNumerica = candidatos.has("quantidade") || candidatos.has("valorUnitario") || candidatos.has("valorTotal");
    if (!temNumerica || candidatos.size < 2) continue;
    if (!melhor || candidatos.size > melhor.score) melhor = { linha: i, score: candidatos.size, candidatos };
  }

  if (!melhor) return { linhaCabecalho: 0, mapeamento: {}, avisos: [] };

  const avisos: string[] = [];
  const linhaTitulos = matriz[melhor.linha] ?? [];
  const mapeamento: Mapeamento = {};
  for (const [papel, colunas] of melhor.candidatos) {
    if (papel === "valorUnitario" && colunas.length > 1) {
      const ordenadas = [...colunas].sort((a, b) => {
        const diferenca = pesoValorUnitario(textoColuna(linhaTitulos, b)) - pesoValorUnitario(textoColuna(linhaTitulos, a));
        return diferenca !== 0 ? diferenca : a - b;
      });
      mapeamento[papel] = ordenadas[0];
      avisos.push(
        `Há mais de uma coluna de valor: usei "${textoColuna(linhaTitulos, ordenadas[0])}" como valor unitário. Se não for essa, troque a coluna.`
      );
    } else {
      mapeamento[papel] = colunas[0];
    }
  }

  // Planilhas em que a coluna "Item" já traz o texto do produto (e não há coluna de descrição).
  if (mapeamento.descricao == null && mapeamento.numero != null) {
    const indice = mapeamento.numero;
    const dados = matriz.slice(melhor.linha + 1, melhor.linha + 31);
    const preenchidas = dados.map((l) => textoColuna(l, indice)).filter((t) => t !== "");
    const comTexto = preenchidas.filter((t) => numeroDa(t) == null).length;
    if (preenchidas.length > 0 && comTexto / preenchidas.length > 0.5) {
      mapeamento.descricao = indice;
      mapeamento.numero = null;
    }
  }

  return { linhaCabecalho: melhor.linha, mapeamento, avisos };
}

export function papeisFaltando(mapeamento: Mapeamento): PapelColuna[] {
  const faltando: PapelColuna[] = [];
  if (mapeamento.descricao == null) faltando.push("descricao");
  if (mapeamento.quantidade == null) faltando.push("quantidade");
  if (mapeamento.valorUnitario == null && mapeamento.valorTotal == null) faltando.push("valorUnitario");
  return faltando;
}

export function listarColunas(matriz: Matriz, linhaCabecalho: number): ColunaPlanilha[] {
  const titulos = matriz[linhaCabecalho] ?? [];
  const colunas: ColunaPlanilha[] = [];
  for (let i = 0; i < larguraDaMatriz(matriz); i++) {
    const titulo = textoDa(titulos[i]);
    colunas.push({ indice: i, titulo: titulo || `Coluna ${letraColuna(i)}` });
  }
  return colunas;
}

// ───────────────────────────── extrair os itens ─────────────────────────────

function ehLinhaDeTotal(descricao: string): boolean {
  const n = normalizar(descricao);
  return /^(sub ?total|total|valor total|soma|total geral)\b/.test(n);
}

function limitarAvisos(avisos: string[], tipo: string, totalDoTipo: number): string[] {
  if (totalDoTipo <= MAX_AVISOS_POR_TIPO) return avisos;
  return [...avisos.slice(0, MAX_AVISOS_POR_TIPO), `…e mais ${totalDoTipo - MAX_AVISOS_POR_TIPO} ${tipo}.`];
}

export function extrairItens(matriz: Matriz, linhaCabecalho: number, mapeamento: Mapeamento): { itens: ItemResultado[]; avisos: string[] } {
  const itens: ItemResultado[] = [];
  const ignoradas: string[] = [];
  let derivadosDoTotal = 0;
  let totaisDiferentes = 0;

  for (let r = linhaCabecalho + 1; r < matriz.length; r++) {
    const linha = matriz[r] ?? [];
    const lida = (papel: PapelColuna): Celula | undefined => {
      const indice = mapeamento[papel];
      return indice == null ? undefined : linha[indice];
    };

    const descricao = textoDa(lida("descricao"));
    const quantidade = numeroDa(lida("quantidade"));
    const unitarioLido = numeroDa(lida("valorUnitario"));
    const totalLido = numeroDa(lida("valorTotal"));

    const algoPreenchido = linha.some((c) => textoDa(c) !== "");
    if (!algoPreenchido) continue;
    if (descricao && ehLinhaDeTotal(descricao)) continue;
    // Linha só com o total geral (sem descrição nem quantidade): é o rodapé, não um item.
    if (!descricao && quantidade == null && unitarioLido == null) continue;

    const nomeLinha = `Linha ${r + 1}${descricao ? ` ("${descricao.slice(0, 40)}")` : ""}`;
    if (!descricao) {
      ignoradas.push(`${nomeLinha}: sem descrição — ignorada.`);
      continue;
    }
    if (quantidade == null || quantidade <= 0) {
      ignoradas.push(`${nomeLinha}: quantidade ausente ou inválida — ignorada.`);
      continue;
    }

    let valorUnitario = unitarioLido;
    let valorTotal: number;
    if (valorUnitario == null) {
      if (totalLido == null) {
        ignoradas.push(`${nomeLinha}: sem valor unitário nem total — ignorada.`);
        continue;
      }
      valorUnitario = Math.round((totalLido / quantidade) * 10000) / 10000;
      valorTotal = round2(totalLido);
      derivadosDoTotal++;
    } else {
      valorTotal = round2(quantidade * valorUnitario);
      if (totalLido != null && Math.abs(totalLido - valorTotal) > 0.05) totaisDiferentes++;
    }
    if (valorUnitario < 0) {
      ignoradas.push(`${nomeLinha}: valor negativo — ignorada.`);
      continue;
    }

    const numeroBruto = numeroDa(lida("numero"));
    itens.push({
      numero: numeroBruto != null && Number.isInteger(numeroBruto) ? numeroBruto : null,
      descricao,
      unidade: textoDa(lida("unidade")) || "un",
      quantidade,
      valorUnitario,
      valorTotal,
    });
  }

  let avisos = limitarAvisos(ignoradas, "linha(s) ignorada(s)", ignoradas.length);
  if (derivadosDoTotal > 0) {
    avisos = [...avisos, `${derivadosDoTotal} item(ns) sem valor unitário: calculei dividindo o total pela quantidade.`];
  }
  if (totaisDiferentes > 0) {
    avisos = [...avisos, `${totaisDiferentes} item(ns) têm total na planilha diferente de quantidade × valor unitário; usei quantidade × valor unitário.`];
  }
  return { itens, avisos };
}

/**
 * Leitura completa de uma aba. `ajuste` é o mapeamento que o usuário corrigiu na tela (só as
 * colunas que ele trocou); o resto continua com o que foi detectado.
 */
export function lerPlanilhaDeMatriz(matriz: Matriz, nomeAba: string | null = null, ajuste?: Mapeamento): LeituraPlanilha {
  const deteccao = detectarMapeamento(matriz);
  // Só vale o que o usuário realmente escolheu (null = "nenhuma coluna"); chave ausente mantém a detecção.
  const escolhido = Object.fromEntries(Object.entries(ajuste ?? {}).filter(([, v]) => v !== undefined)) as Mapeamento;
  const mapeamento: Mapeamento = { ...deteccao.mapeamento, ...escolhido };
  const { itens, avisos } = extrairItens(matriz, deteccao.linhaCabecalho, mapeamento);
  return {
    nomeAba,
    linhaCabecalho: deteccao.linhaCabecalho,
    colunas: listarColunas(matriz, deteccao.linhaCabecalho),
    mapeamento,
    itens,
    avisos: ajuste ? avisos : [...deteccao.avisos, ...avisos],
    faltando: papeisFaltando(mapeamento),
  };
}

// ───────────────────────────── conferência com o valor homologado ─────────────────────────────

export function somaDosItens(itens: Pick<ItemResultado, "valorTotal">[]): number {
  return round2(itens.reduce((acc, i) => acc + i.valorTotal, 0));
}

export type ConferenciaTotais = {
  somaItens: number;
  diferenca: number;
  /** Diferença em relação ao valor homologado (0–100). */
  percentual: number | null;
  /** true quando a diferença passa de 1% — a tela avisa, mas não impede de salvar. */
  divergente: boolean;
};

export function conferirTotais(valorHomologado: number | null, itens: Pick<ItemResultado, "valorTotal">[]): ConferenciaTotais {
  const somaItens = somaDosItens(itens);
  if (valorHomologado == null || valorHomologado <= 0 || itens.length === 0) {
    return { somaItens, diferenca: 0, percentual: null, divergente: false };
  }
  const diferenca = round2(somaItens - valorHomologado);
  const percentual = Math.abs(diferenca / valorHomologado) * 100;
  return { somaItens, diferenca, percentual, divergente: percentual > 1 };
}

/** Quanto o valor homologado ficou abaixo (positivo) ou acima (negativo) do valor de referência do edital, em %. */
export function descontoSobreReferencia(valorReferencia: number | null, valorHomologado: number | null): number | null {
  if (valorReferencia == null || valorReferencia <= 0 || valorHomologado == null) return null;
  return ((valorReferencia - valorHomologado) / valorReferencia) * 100;
}
