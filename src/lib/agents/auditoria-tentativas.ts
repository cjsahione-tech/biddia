import { prisma } from "@/lib/prisma";

// Registro de cada tentativa da auditoria de habilitação (tabela AuditoriaTentativa): quando, por quê, com qual método,
// quanto tempo e quanto custou. É só um LOG: gravar aqui nunca pode derrubar nem atrasar uma auditoria — qualquer
// falha (inclusive a tabela ainda não existir) é engolida.

export type ResultadoTentativa = "concluida" | "continua" | "retentativa" | "espera" | "definitivo" | "acao_humana" | "interrompida";

export type MetodoLeitura = "texto" | "texto+ocr" | "reconferencia";

/** O que a execução vai descobrindo enquanto trabalha (método de leitura, custo) para o registro final. */
export type MetaExecucao = {
  inicio: number;
  metodo: MetodoLeitura;
  /** Custo (US$) já acumulado quando esta execução começou. */
  custoInicialUsd: number;
  /** Custo (US$) acumulado até agora, na auditoria toda. */
  custoAtualUsd: number;
};

export function novaMeta(modo: "completo" | "reconferir" | undefined): MetaExecucao {
  return { inicio: Date.now(), metodo: modo === "reconferir" ? "reconferencia" : "texto", custoInicialUsd: 0, custoAtualUsd: 0 };
}

export async function registrarTentativa(d: {
  editalId: string;
  resultado: ResultadoTentativa;
  tipoErro?: string | null;
  meta?: MetaExecucao;
  detalhe?: string | null;
}): Promise<void> {
  try {
    await prisma.auditoriaTentativa.create({
      data: {
        editalId: d.editalId,
        resultado: d.resultado,
        tipoErro: d.tipoErro ?? null,
        metodo: d.meta?.metodo ?? null,
        duracaoMs: d.meta ? Math.max(0, Date.now() - d.meta.inicio) : null,
        custoUsd: d.meta ? Math.max(0, d.meta.custoAtualUsd - d.meta.custoInicialUsd) : 0,
        detalhe: d.detalhe?.slice(0, 300) ?? null,
      },
    });
  } catch {
    /* log: nunca atrapalha a auditoria */
  }
}
