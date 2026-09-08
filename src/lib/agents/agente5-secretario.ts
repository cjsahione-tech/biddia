import { prisma } from "@/lib/prisma";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

// Documentos de habilitação recorrentes em licitações públicas brasileiras (Lei 14.133/2021).
const CHECKLIST_BASE = [
  "Contrato Social / Estatuto consolidado",
  "Cartão CNPJ atualizado",
  "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)",
  "Certidão Negativa de Débitos Estaduais",
  "Certidão Negativa de Débitos Municipais",
  "Certificado de Regularidade do FGTS (CRF)",
  "Certidão Negativa de Débitos Trabalhistas (CNDT)",
  "Balanço patrimonial / atestado de capacidade financeira",
  "Atestado(s) de Capacidade Técnica",
];

export async function executarAgente5(editalId: string) {
  return withAgentRun(editalId, "agente5-secretario", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({
      where: { id: editalId },
      include: { analysis: true, documents: true, checklistItems: true },
    });

    const existentes = new Set(edital.checklistItems.map((c) => c.documentoNome));

    let habilitacaoEdital: string[] = [];
    if (edital.analysis?.habilitacao) {
      try {
        habilitacaoEdital = JSON.parse(edital.analysis.habilitacao) as string[];
      } catch {
        habilitacaoEdital = [];
      }
    }

    const todosItens = Array.from(new Set([...CHECKLIST_BASE, ...habilitacaoEdital]));

    let criados = 0;
    for (const nome of todosItens) {
      if (existentes.has(nome)) continue;
      await prisma.checklistItem.create({
        data: {
          editalId,
          documentoNome: nome,
          obrigatorio: CHECKLIST_BASE.includes(nome),
          status: "FALTANTE",
        },
      });
      criados++;
    }

    for (const doc of edital.documents) {
      if (!existentes.has(doc.nome)) {
        await prisma.checklistItem.create({
          data: {
            editalId,
            documentoNome: doc.nome,
            obrigatorio: true,
            status: "OK",
            observacao: "Gerado automaticamente pelo Agente Advogado",
          },
        });
        criados++;
      }
    }

    const hoje = new Date();
    const itensAtuais = await prisma.checklistItem.findMany({ where: { editalId } });
    let vencidos = 0;
    for (const item of itensAtuais) {
      if (item.validade && item.validade < hoje && item.status !== "VENCIDO") {
        await prisma.checklistItem.update({
          where: { id: item.id },
          data: { status: "VENCIDO" },
        });
        vencidos++;
      }
    }

    const faltantes = itensAtuais.filter((i) => i.status === "FALTANTE" && i.obrigatorio).length;

    await logAudit(
      editalId,
      "Agente Secretário",
      "Checklist de documentos",
      faltantes > 0 ? "ALERTA" : "OK",
      `${criados} item(ns) novo(s) no checklist. ${faltantes} documento(s) obrigatório(s) ainda pendente(s) de envio. ${vencidos} vencido(s).`
    );

    return { criados, faltantes, vencidos };
  });
}
