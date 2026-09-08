import { prisma } from "@/lib/prisma";
import { askJSON } from "@/lib/anthropic";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { gerarPdfTimbrado, bytesToDataUrl } from "@/lib/agents/pdf";

type AnexoGerado = {
  nome: string;
  paragrafos: string[];
};

type AdvogadoResult = {
  anexos: AnexoGerado[];
};

export async function executarAgente4(editalId: string) {
  return withAgentRun(editalId, "agente4-advogado", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({
      where: { id: editalId },
      include: { company: true, analysis: true },
    });

    const contexto = `
Edital: ${edital.titulo}
Número de controle PNCP: ${edital.numeroControlePNCP}
Órgão licitante: ${edital.orgaoNome} (CNPJ ${edital.orgaoCnpj})
Modalidade: ${edital.modalidade ?? "não informado"}
Objeto (resumo do analista): ${edital.analysis?.resumoObjeto ?? edital.descricao}

Empresa proponente:
Razão social: ${edital.company.razaoSocial}
CNPJ: ${edital.company.cnpj}
Endereço: ${edital.company.logradouro}, ${edital.company.numero}, ${edital.company.bairro}, ${edital.company.cidade}/${edital.company.uf}, CEP ${edital.company.cep}
Sócio/responsável legal: ${edital.company.socioNome} (CPF ${edital.company.socioCpf})
`.trim();

    const result = await askJSON<AdvogadoResult>(
      `Você é um advogado especialista em licitações públicas brasileiras (Lei 14.133/2021). Redija o texto de
declarações e anexos padrão que normalmente acompanham uma proposta em licitações públicas, já preenchidos com
os dados da empresa e referenciando o edital específico. Gere EXATAMENTE estes 4 documentos, nesta ordem:
1. "Declaração de Cumprimento dos Requisitos de Habilitação"
2. "Declaração de Inexistência de Fato Impeditivo da Habilitação"
3. "Declaração de Não Emprego de Menor de Idade (Art. 7º, XXXIII, CF)"
4. "Declaração de Elaboração Independente de Proposta"

Cada documento deve ser formal, em primeira pessoa da empresa, citar o número de controle PNCP e o órgão licitante,
e terminar afirmando estar ciente das penalidades legais em caso de declaração falsa.
Responda em JSON:
{ "anexos": [ { "nome": string, "paragrafos": string[] } ] }
Cada "paragrafos" deve ter de 2 a 4 parágrafos curtos e objetivos (sem usar marcações markdown).`,
      contexto
    );

    const criados = [];
    for (const anexo of result.anexos) {
      const bytes = await gerarPdfTimbrado({
        company: edital.company,
        titulo: anexo.nome,
        paragrafos: anexo.paragrafos,
        rodapeExtra: `Documento gerado automaticamente pelo Agente Advogado para o edital ${edital.numeroControlePNCP} (${edital.orgaoNome}). Revise antes do envio.`,
      });

      const doc = await prisma.document.create({
        data: {
          editalId,
          nome: anexo.nome,
          tipo: "ANEXO_GERADO",
          status: "GERADO",
          conteudoBase64: bytesToDataUrl(bytes),
        },
      });
      criados.push(doc);
    }

    await logAudit(
      editalId,
      "Agente Advogado",
      "Geração de anexos",
      "OK",
      `${criados.length} anexo(s) timbrado(s) gerado(s) automaticamente.`
    );

    return criados;
  });
}
