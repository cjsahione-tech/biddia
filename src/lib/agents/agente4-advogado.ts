import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { gerarPdfTimbrado, bytesToDataUrl } from "@/lib/agents/pdf";

type AnexoGerado = {
  nome: string;
  paragrafos: string[];
};

type AdvogadoResult = {
  anexosEncontrados: AnexoGerado[];
};

// Anexos com modelo de declaração costumam vir no fim de editais longos — sem essas
// palavras-chave, o corte "burro" por tamanho (ver selecionarTrechoRelevante) manteria só
// o começo do documento e descartaria justamente os modelos que precisamos reproduzir.
const PALAVRAS_CHAVE_ANEXOS = [
  "anexo",
  "declaro",
  "declaração",
  "modelo",
  "a empresa",
  "responsável legal",
  "assinatura",
];

export async function executarAgente4(editalId: string, opts?: { notaCorrecao?: string }) {
  return withAgentRun(editalId, "agente4-advogado", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({
      where: { id: editalId },
      include: { company: true, analysis: true },
    });

    const { textoEdital, textoTermoReferencia, textoAnexosPrecos, temTextoCompleto } = await obterTextoCompletoEdital(
      editalId,
      { palavrasChave: PALAVRAS_CHAVE_ANEXOS, tamanhoMax: 45_000 }
    );

    const identificacaoEdital =
      edital.fonte === "PNCP"
        ? `Número de controle PNCP: ${edital.numeroControlePNCP}`
        : `Este edital foi enviado manualmente pelo usuário (sem número de controle do PNCP) — identifique o
número do edital/pregão pelo próprio texto abaixo, se ele aparecer lá.`;

    const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

    const contexto = `
Edital: ${edital.titulo}
${identificacaoEdital}
Órgão licitante: ${edital.orgaoNome} (CNPJ ${edital.orgaoCnpj})
Modalidade: ${edital.modalidade ?? "não informado"}
Objeto (resumo do analista): ${edital.analysis?.resumoObjeto ?? edital.descricao}
Data de hoje (para lacunas de local/data): ${hoje}

Empresa proponente:
Razão social: ${edital.company.razaoSocial}
CNPJ: ${edital.company.cnpj}
Endereço: ${edital.company.logradouro}, ${edital.company.numero}, ${edital.company.bairro}, ${edital.company.cidade}/${edital.company.uf}, CEP ${edital.company.cep}
Sócio/responsável legal: ${edital.company.socioNome} (CPF ${edital.company.socioCpf})
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA ===\n${textoTermoReferencia}` : ""}
${textoAnexosPrecos ? `\n=== TEXTO DE OUTROS ANEXOS ===\n${textoAnexosPrecos}` : ""}
${opts?.notaCorrecao ? `\n=== CORREÇÃO PEDIDA PELO USUÁRIO (sobre os anexos gerados antes) ===\n${opts.notaCorrecao}\nRefaça a extração levando isso em conta — é prioridade sobre o que você gerou antes.` : ""}
`.trim();

    const instrucaoFonte = temTextoCompleto
      ? `Você TEM ACESSO ao texto do edital e/ou termo de referência e/ou outros anexos acima. Procure NELE por anexos que sejam MODELOS
DE DECLARAÇÃO prontos para a empresa preencher e assinar (ex: "ANEXO III – DECLARAÇÃO DE...", "MODELO DE
DECLARAÇÃO DE..."). Não conte anexos que são só informativos (minuta de contrato, planilha de preços, termo de
referência) nem exigências de habilitação descritas em texto corrido sem um modelo pronto para reproduzir.`
      : `O texto completo do edital não estava disponível para leitura — sem o texto-fonte não é seguro reproduzir
nenhum modelo. Retorne "anexosEncontrados": [] neste caso.`;

    const result = await askJSON<AdvogadoResult>(
      `Você é um advogado especialista em licitações públicas brasileiras (Lei 14.133/2021). Sua tarefa é EXTRAIR
modelos de declaração oficiais de dentro do texto do edital e preencher apenas as lacunas — são documentos
oficiais entregues ao órgão público, então a EXATIDÃO do texto original importa mais que qualquer outra coisa.

${instrucaoFonte}

Para CADA modelo de declaração que encontrar, siga estas regras à risca:
1. Reproduza o texto do modelo EXATAMENTE como está no edital — mesma ordem de frases, mesma pontuação, mesma
numeração, mesmo estilo de linguagem. NÃO resuma, NÃO reformule, NÃO corrija nada, mesmo que pareça haver erro de
digitação ou português no original. A única mudança permitida é substituir as lacunas do próprio modelo.
2. Preencha SOMENTE as lacunas do modelo — campos em branco como "____________", "[razão social]",
"(nome da empresa)", "CNPJ n.º _______", "sediada em ______", local/data no rodapé, nome e CPF do responsável
legal — usando os dados da empresa e do edital fornecidos acima.
3. Se uma lacuna pedir um dado que você não tem com certeza (ex: número de protocolo, informação que só existirá
no momento do envio), deixe-a como está no texto original — nunca invente um valor.
4. Divida o resultado em "paragrafos" seguindo os próprios parágrafos/itens do modelo original, na mesma ordem —
não junte nem quebre frases de um jeito diferente do original.

Se não encontrar NENHUM modelo de declaração reproduzível no texto (só descrições de exigências sem um texto
pronto), retorne "anexosEncontrados": [] — nunca invente um modelo que não está no edital, e não gere nenhum
anexo "padrão" que não tenha sido encontrado literalmente no texto-fonte.

Responda em JSON:
{ "anexosEncontrados": [ { "nome": string (nome do anexo como aparece no edital, ex: "Anexo III – Declaração de Inexistência de Fato Impeditivo"), "paragrafos": string[] (parágrafos do modelo já preenchidos, sem marcações markdown) } ] }`,
      contexto,
      { model: MODELO_HAIKU, maxTokens: 5000 }
    );

    const todosAnexos = result.anexosEncontrados ?? [];

    // Gera todos os PDFs ANTES de tocar no banco — se a geração de algum anexo falhar,
    // o Promise.all rejeita aqui, antes de apagar os anexos antigos (ver correção via
    // chat abaixo), deixando o edital com o conjunto anterior intacto em vez de um
    // conjunto pela metade (alguns novos, os demais simplesmente sumidos).
    const gerados = await Promise.all(
      todosAnexos.map(async (anexo) => ({
        nome: anexo.nome,
        bytes: await gerarPdfTimbrado({
          company: edital.company,
          titulo: anexo.nome,
          paragrafos: anexo.paragrafos,
          rodapeExtra: `Modelo extraído do texto do edital "${edital.titulo}" — ${edital.orgaoNome} — e preenchido automaticamente pelo Agente Advogado. Confira os dados preenchidos e o texto original antes do envio.`,
        }),
      }))
    );

    // Correção via chat: os anexos antigos ficariam duplicados com os novos se não
    // fossem removidos antes — aqui é regeração completa, não um adicional. Apagar e
    // recriar juntos numa transação evita um estado intermediário sem nenhum anexo caso
    // a criação falhe no meio (a geração dos PDFs, o passo mais sujeito a falhar, já
    // terminou com sucesso pra todos antes de chegar aqui).
    const criados = await prisma.$transaction(async (tx) => {
      if (opts?.notaCorrecao) {
        await tx.document.deleteMany({ where: { editalId, tipo: "ANEXO_GERADO" } });
      }
      return Promise.all(
        gerados.map((g) =>
          tx.document.create({
            data: {
              editalId,
              nome: g.nome,
              tipo: "ANEXO_GERADO",
              status: "GERADO",
              conteudoBase64: bytesToDataUrl(g.bytes),
            },
          })
        )
      );
    });

    await logAudit(
      editalId,
      "Agente Advogado",
      opts?.notaCorrecao ? "Correção via chat" : "Geração de anexos",
      "OK",
      criados.length > 0
        ? `${criados.length} modelo(s) de declaração encontrado(s) no texto do edital e preenchido(s) automaticamente${opts?.notaCorrecao ? " (regerado a pedido do usuário)" : ""}.`
        : "Nenhum modelo de declaração reproduzível foi encontrado no texto do edital — nenhum anexo foi gerado, para não inventar um documento que o edital não forneceu."
    );

    return criados;
  });
}
