import { createHash } from "node:crypto";
import { dividirEmPedacos } from "@/lib/habilitacao";
import type { TipoErroIA } from "@/lib/ia-erros";
import { densidadeDeHabilitacao, selecionarTrechosDeHabilitacao } from "@/lib/habilitacao-trechos";

// Plano de leitura da auditoria: o texto dos documentos é cortado em pedaços, e cada pedaço é lido pela IA uma vez.
// Cada pedaço tem uma CHAVE que vem do seu próprio conteúdo — assim o progresso sobrevive a mudanças no conjunto de
// documentos (um arquivo que faltava e foi lido depois, um edital retificado): só o que é novo é lido, o resto não se perde.
// Um pedaço que a IA não consegue ler duas vezes é dividido ao meio, em vez de travar a auditoria inteira.

/** Pedaço menor que isto não é mais dividido (se ainda assim falhar, o erro segue o caminho normal de nova tentativa). */
export const TAMANHO_MINIMO_PARA_DIVIDIR = 6_000;
/** Quantas falhas "do pedaço" (resposta fora do formato, tempo, tamanho) antes de dividi-lo ao meio. */
export const FALHAS_ATE_DIVIDIR_PEDACO = 2;
/** Superposição entre as duas metades: uma exigência na emenda aparece inteira em pelo menos uma delas. */
const SOBREPOSICAO_DA_DIVISAO = 1_000;

/** Falhas que são "do pedaço" (grande demais, lento demais, resposta cortada): dividir ajuda. As de serviço (limite, sobrecarga, conexão) não. */
export function falhaDoPedacoPedeDivisao(tipo: TipoErroIA): boolean {
  return tipo === "RESPOSTA_INVALIDA" || tipo === "TEMPO_ESGOTADO" || tipo === "EDITAL_GRANDE";
}

export type PedacoPlano = {
  chave: string;
  docNome: string;
  indice: number;
  total: number;
  texto: string;
  densidade: number;
};

export function chaveDoPedaco(docNome: string, texto: string): string {
  return createHash("sha1").update(`${docNome}\u0000${texto}`).digest("hex").slice(0, 16);
}

/** Divide um texto em duas metades, no fim de linha mais próximo do meio, com uma pequena superposição. */
export function dividirAoMeio(texto: string): [string, string] {
  const meio = Math.floor(texto.length / 2);
  const quebra = texto.indexOf("\n", meio);
  const corte = quebra === -1 || quebra - meio > 4_000 ? meio : quebra + 1;
  const inicioB = Math.max(0, corte - SOBREPOSICAO_DA_DIVISAO);
  const alinhado = texto.indexOf("\n", inicioB);
  return [texto.slice(0, corte), texto.slice(alinhado !== -1 && alinhado < corte ? alinhado + 1 : inicioB)];
}

/**
 * Pedaços de leitura de todos os documentos, os mais ricos em termos de habilitação primeiro. Um pedaço cuja chave
 * está em `divididos` é substituído pelas suas duas metades (e assim por diante, se as metades também falharam).
 */
export function planejarPedacos(
  docs: { nome: string; texto: string }[],
  opts: { tamanho: number; divididos: ReadonlySet<string> }
): PedacoPlano[] {
  const todos: PedacoPlano[] = [];
  for (const d of docs) {
    const selecionado = selecionarTrechosDeHabilitacao(d.texto);
    const base = dividirEmPedacos(selecionado.texto, opts.tamanho);
    const expandido: string[] = [];
    const expandir = (texto: string, profundidade: number) => {
      if (profundidade < 6 && texto.length > TAMANHO_MINIMO_PARA_DIVIDIR && opts.divididos.has(chaveDoPedaco(d.nome, texto))) {
        const [a, b] = dividirAoMeio(texto);
        expandir(a, profundidade + 1);
        expandir(b, profundidade + 1);
      } else expandido.push(texto);
    };
    for (const p of base) expandir(p, 0);
    expandido.forEach((texto, i) =>
      todos.push({ chave: chaveDoPedaco(d.nome, texto), docNome: d.nome, indice: i, total: expandido.length, texto, densidade: densidadeDeHabilitacao(texto) })
    );
  }
  return todos.sort((a, b) => b.densidade - a.densidade);
}

/** Impressão digital do plano no formato ANTIGO (índices): serve só para reconhecer progresso gravado antes das chaves. */
export function hashDoPlanoLegado(pedacos: Pick<PedacoPlano, "docNome" | "indice" | "texto">[]): string {
  return createHash("sha1").update(pedacos.map((p) => `${p.docNome}:${p.indice}:${p.texto.length}`).join("|")).digest("hex");
}

/** Tamanhos de pedaço que já foram usados no passado — para reconhecer progresso antigo. */
export const TAMANHOS_ANTIGOS_DE_PEDACO = [30_000, 45_000];

/** Chave reservada para as exigências de progresso gravado no formato antigo (não dá para saber de qual pedaço vieram). */
export const CHAVE_LEGADO = "legado";

export type ProgressoDePedacos = {
  chunksTotal: number;
  /** Formato antigo (por índice) — lido só para migrar. */
  feitos: number[];
  brutas: unknown[];
  plano?: string;
  tamanhoPedaco?: number;
  feitosChaves?: string[];
  brutasPorChave?: Record<string, unknown[]>;
  falhasPedaco?: Record<string, number>;
  divididos?: string[];
};

/**
 * Se o progresso foi gravado no formato antigo e ainda corresponde ao plano de algum tamanho conhecido, converte para
 * chaves (as exigências antigas ficam sob CHAVE_LEGADO). Se não corresponde, descarta (recomeça), como sempre foi.
 * Devolve o tamanho de pedaço a usar.
 */
export function migrarProgressoLegado(
  progresso: ProgressoDePedacos,
  docs: { nome: string; texto: string }[],
  tamanhoPadrao: number
): number {
  if (progresso.feitosChaves) return progresso.tamanhoPedaco ?? tamanhoPadrao;

  progresso.feitosChaves = [];
  progresso.brutasPorChave = {};
  if (progresso.feitos.length > 0 && progresso.plano) {
    for (const tamanho of [tamanhoPadrao, ...TAMANHOS_ANTIGOS_DE_PEDACO.filter((t) => t !== tamanhoPadrao)]) {
      const plano = planejarPedacos(docs, { tamanho, divididos: new Set() });
      if (hashDoPlanoLegado(plano) !== progresso.plano) continue;
      progresso.feitosChaves = progresso.feitos.map((i) => plano[i]?.chave).filter((c): c is string => !!c);
      progresso.brutasPorChave[CHAVE_LEGADO] = progresso.brutas;
      progresso.tamanhoPedaco = tamanho;
      break;
    }
  }
  progresso.feitos = [];
  progresso.brutas = [];
  progresso.tamanhoPedaco ??= tamanhoPadrao;
  return progresso.tamanhoPedaco;
}

/**
 * Ao PEDIR uma nova auditoria (ex.: "Tentar novamente"), o que já foi lido do edital continua valendo — as chaves vêm do
 * conteúdo, então um documento trocado simplesmente gera pedaços novos. O que depende da situação do momento
 * (arquivos desistidos, contagem de passos, conferência com os documentos da empresa) recomeça.
 */
export function reaproveitarProgresso(json: string | null): string | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    const mantido: Record<string, unknown> = {};
    for (const campo of ["tamanhoPedaco", "feitosChaves", "brutasPorChave", "divididos", "ocr", "feitos", "brutas", "plano", "chunksTotal"]) {
      if (p[campo] !== undefined) mantido[campo] = p[campo];
    }
    if (!mantido.feitosChaves && !mantido.feitos) return null; // nada de leitura para aproveitar
    return JSON.stringify(mantido);
  } catch {
    return null;
  }
}
