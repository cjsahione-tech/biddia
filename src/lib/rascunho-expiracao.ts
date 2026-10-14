import { prisma } from "@/lib/prisma";
import { apagarAnexo } from "@/lib/storage";
import { registrarExclusaoPermanente } from "@/lib/agents/editais-excluidos";
import { filtroRascunhoVencido } from "@/lib/rascunho-prazo";

// Editais em "Rascunho" ficam 7 dias (ver rascunho-prazo.ts) e depois são apagados de verdade.

export type ResultadoLimpezaRascunhos = { excluidos: number; arquivosApagados: number; puladosEmExecucao: number };

/**
 * Apaga de verdade os editais que estão no Rascunho há mais de 7 dias (com tudo o que pende deles:
 * análise, proposta, documentos baixados, checklist — o schema apaga em cascata). Antes, guarda a
 * chave do edital na lista de "já excluídos" para o Agente Comercial não recapturá-lo na próxima
 * busca. Os arquivos grandes que estão no Storage saem depois. Trabalha em lotes pequenos e para
 * quando o tempo acaba; o que sobrar sai na próxima chamada.
 */
export async function excluirRascunhosVencidos(opts?: {
  companyId?: string;
  tamanhoLote?: number;
  ateMs?: number;
}): Promise<ResultadoLimpezaRascunhos> {
  const tamanhoLote = opts?.tamanhoLote ?? 15;
  const fim = Date.now() + (opts?.ateMs ?? 40_000);
  const resultado: ResultadoLimpezaRascunhos = { excluidos: 0, arquivosApagados: 0, puladosEmExecucao: 0 };
  const vistos = new Set<string>();

  while (Date.now() < fim) {
    const lote = await prisma.edital.findMany({
      where: { ...filtroRascunhoVencido(), ...(opts?.companyId ? { companyId: opts.companyId } : {}), id: { notIn: [...vistos] } },
      select: { id: true, companyId: true, numeroControlePNCP: true, fonte: true },
      orderBy: { updatedAt: "asc" },
      take: tamanhoLote,
    });
    if (lote.length === 0) break;
    for (const e of lote) vistos.add(e.id);

    // Não apaga o que ainda tem agente rodando agora (acabou de ser capturado/reprocessado).
    const emExecucao = await prisma.agentRun.findMany({
      where: { editalId: { in: lote.map((e) => e.id) }, status: "RUNNING", startedAt: { gt: new Date(Date.now() - 10 * 60_000) } },
      select: { editalId: true },
    });
    const ocupados = new Set(emExecucao.map((r) => r.editalId));
    const apagar = lote.filter((e) => !ocupados.has(e.id));
    resultado.puladosEmExecucao += lote.length - apagar.length;
    if (apagar.length === 0) continue;

    const ids = apagar.map((e) => e.id);
    const comArquivo = await prisma.document.findMany({
      where: { editalId: { in: ids }, storagePath: { not: null } },
      select: { storagePath: true },
    });
    const caminhos = comArquivo.map((d) => d.storagePath).filter((c): c is string => !!c);

    await registrarExclusaoPermanente(apagar);
    const { count } = await prisma.edital.deleteMany({ where: { id: { in: ids } } });
    resultado.excluidos += count;

    // O Secretário copia para o checklist do edital o MESMO arquivo do Storage da base de documentos da empresa
    // (e outros editais podem apontar para o mesmo caminho): só apaga o que ninguém mais referencia.
    const aindaUsados = new Set<string>();
    if (caminhos.length > 0) {
      const [outrosDocumentos, documentosDaEmpresa] = await Promise.all([
        prisma.document.findMany({ where: { storagePath: { in: caminhos } }, select: { storagePath: true } }),
        prisma.companyDocument.findMany({ where: { storagePath: { in: caminhos } }, select: { storagePath: true } }),
      ]);
      for (const r of [...outrosDocumentos, ...documentosDaEmpresa]) if (r.storagePath) aindaUsados.add(r.storagePath);
    }

    for (const caminho of caminhos.filter((c) => !aindaUsados.has(c))) {
      await apagarAnexo(caminho).then(
        () => resultado.arquivosApagados++,
        () => null // arquivo já ausente ou Storage indisponível: o registro já saiu, não trava a limpeza
      );
    }
  }
  return resultado;
}
