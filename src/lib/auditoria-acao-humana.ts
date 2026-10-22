import type { TipoErroIA } from "@/lib/ia-erros";

// Quando NENHUM documento principal do processo pôde ser lido, o motivo de cada arquivo diz se vale tentar de novo
// sozinho (portal fora do ar, demorou) ou se só uma pessoa resolve (senha, página de login, escaneado ruim, edital apagado).

/** Motivos de falha de arquivo que repetir NÃO resolve. */
export const MOTIVOS_SEM_REMEDIO_AUTOMATICO: ReadonlySet<string> = new Set(["removido", "protegido", "corrompido", "login", "pagina", "ilegivel"]);

const TIPO_DO_MOTIVO: Record<string, TipoErroIA> = {
  removido: "EDITAL_REMOVIDO",
  protegido: "PDF_PROTEGIDO",
  corrompido: "PDF_PROTEGIDO",
  login: "LOGIN_OU_CAPTCHA",
  pagina: "LOGIN_OU_CAPTCHA",
  ilegivel: "ESCANEADO_ILEGIVEL",
};

/** Se dois motivos diferentes aparecem juntos, o mais "estrutural" (que explica os outros) manda. */
const PRIORIDADE: TipoErroIA[] = ["EDITAL_REMOVIDO", "LOGIN_OU_CAPTCHA", "PDF_PROTEGIDO", "ESCANEADO_ILEGIVEL"];

/**
 * Erro a lançar quando nenhum documento principal foi lido. Só vira "ação humana" se TODOS os arquivos que falharam têm
 * motivo sem remédio automático; se algum pode ser passageiro (download, demorou, formato), segue o caminho de nova tentativa.
 */
export function erroQuandoNenhumPrincipalFoiLido(motivos: (string | undefined)[]): TipoErroIA {
  if (motivos.length === 0) return "ARQUIVO_ILEGIVEL";
  const tipos = motivos.map((m) => (m ? TIPO_DO_MOTIVO[m] : undefined));
  if (tipos.some((t) => t === undefined)) return "ARQUIVO_ILEGIVEL";
  const achados = new Set(tipos as TipoErroIA[]);
  return PRIORIDADE.find((t) => achados.has(t)) ?? "ARQUIVO_ILEGIVEL";
}
