import { prisma } from "@/lib/prisma";
import { askJSON } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { gerarPdfTimbrado, bytesToDataUrl } from "@/lib/agents/pdf";

type AnexoGerado = {
  nome: string;
  paragrafos: string[];
};

type AdvogadoResult = {
  anexosPadrao: AnexoGerado[];
  anexosEspecificosDoEdital: AnexoGerado[];
};

export async function executarAgente4(editalId: string) {
  return withAgentRun(editalId, "agente4-advogado", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({
      where: { id: editalId },
      include: { company: true, analysis: true },
    });

    const { textoEdital, textoTermoReferencia, temTextoCompleto } =
      await obterTextoCompletoEdital(editalId);

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
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA ===\n${textoTermoReferencia}` : ""}
`.trim();

    const instrucaoEspecificos = temTextoCompleto
      ? `Além disso, procure no texto do edital acima por declarações/anexos ESPECÍFICOS exigidos por ESTE edital em
particular, além dos 4 padrão (ex: declaração de ME/EPP, declaração de sustentabilidade, declaração de não
possuir servidor público no quadro societário, declaração de visita técnica, etc.). Gere um documento para cada
um que encontrar EXPLICITAMENTE exigido no texto — não invente exigências que não estão lá. Se não encontrar
nenhuma exigência específica além das padrão, retorne "anexosEspecificosDoEdital": [].`
      : `O texto completo do edital não estava disponível para leitura, então não é possível identificar exigências
específicas com segurança. Retorne "anexosEspecificosDoEdital": [] neste caso.`;

    const result = await askJSON<AdvogadoResult>(
      `Você é um advogado especialista em licitações públicas brasileiras (Lei 14.133/2021). Redija o texto de
declarações e anexos que acompanham uma proposta em licitação, já preenchidos com os dados da empresa e
referenciando o edital específico.

Gere EXATAMENTE estes 4 documentos padrão em "anexosPadrao", nesta ordem:
1. "Declaração de Cumprimento dos Requisitos de Habilitação"
2. "Declaração de Inexistência de Fato Impeditivo da Habilitação"
3. "Declaração de Não Emprego de Menor de Idade (Art. 7º, XXXIII, CF)"
4. "Declaração de Elaboração Independente de Proposta"

${instrucaoEspecificos}

Cada documento deve ser formal, em primeira pessoa da empresa, citar o número de controle PNCP e o órgão licitante,
e terminar afirmando estar ciente das penalidades legais em caso de declaração falsa.
Responda em JSON:
{
  "anexosPadrao": [ { "nome": string, "paragrafos": string[] } ],
  "anexosEspecificosDoEdital": [ { "nome": string, "paragrafos": string[] } ]
}
Cada "paragrafos" deve ter de 2 a 4 parágrafos curtos e objetivos (sem usar marcações markdown).`,
      contexto,
      { maxTokens: 6000 }
    );

    const todosAnexos = [...result.anexosPadrao, ...(result.anexosEspecificosDoEdital ?? [])];

    const criados = [];
    for (const anexo of todosAnexos) {
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

    const qtdEspecificos = result.anexosEspecificosDoEdital?.length ?? 0;
    await logAudit(
      editalId,
      "Agente Advogado",
      "Geração de anexos",
      "OK",
      `${criados.length} anexo(s) timbrado(s) gerado(s) automaticamente (${result.anexosPadrao.length} padrão${qtdEspecificos > 0 ? ` + ${qtdEspecificos} específico(s) identificado(s) no texto do edital` : ""}).`
    );

    return criados;
  });
}
