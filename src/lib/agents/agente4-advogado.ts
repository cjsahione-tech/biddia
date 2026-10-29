import type { Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU, MODELO_SONNET } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { gerarPdfTimbrado, bytesToDataUrl } from "@/lib/agents/pdf";
import { comRegrasComuns } from "@/lib/agents/regras-comuns";
import { mapComLimite } from "@/lib/concorrencia";
import {
  chaveDoAnexo,
  dividirEmAnexos,
  fidelidadeAoEdital,
  pareceModeloPreenchivel,
  sanearParagrafos,
  type AnexoDoTexto,
} from "@/lib/agents/anexos-edital";

type AnexoGerado = {
  nome: string;
  paragrafos: string[];
  /** Lacunas que ficaram em aberto por falta de dado no cadastro da empresa. */
  camposNaoPreenchidos: string[];
  /** Fração do texto que existe no edital/dados da empresa (baixa = a IA pode ter reescrito). */
  fidelidade: number;
};

type RespostaAnexo = {
  declaracoes?: { nome?: unknown; paragrafos?: unknown; camposNaoPreenchidos?: unknown }[];
  avisos?: unknown;
};

// Anexos com modelo de declaração costumam vir no fim de editais longos — o Advogado lê o edital INTEIRO (não só o
// começo) e separa os anexos pelo cabeçalho "ANEXO ...", um por um. Estas palavras-chave só ajudam o corte quando o
// documento é maior que o teto.
const PALAVRAS_CHAVE_ANEXOS = ["anexo", "declaro", "declaração", "modelo", "a empresa", "responsável legal", "assinatura"];
const TETO_TEXTO_ADVOGADO = 250_000;
const FIDELIDADE_MINIMA = 0.85;

/** Dados da empresa que podem preencher lacunas dos modelos (tudo o que o cadastro tem de útil para declarações). */
function dadosDaEmpresaParaPreencher(company: Company & { user?: { email: string } | null }): string {
  const complemento = company.complemento ? `, ${company.complemento}` : "";
  const endereco = `${company.logradouro}, ${company.numero}${complemento}, ${company.bairro}, ${company.cidade}/${company.uf}, CEP ${company.cep}`;
  const telefone = company.whatsapp ? `+${company.whatsapp}` : "não informado";
  return [
    `Razão social: ${company.razaoSocial}`,
    `CNPJ: ${company.cnpj}`,
    `Endereço completo (sede): ${endereco}`,
    `Cidade/UF: ${company.cidade}/${company.uf}`,
    `Representante legal (sócio): ${company.socioNome}`,
    `CPF do representante legal: ${company.socioCpf}`,
    `Qualidade do declarante: sócio / representante legal da empresa`,
    `Telefone/WhatsApp: ${telefone}`,
    `E-mail: ${company.user?.email ?? "não informado"}`,
  ].join("\n");
}

export function promptAdvogado(): string {
  return comRegrasComuns(`FUNÇÃO
Você é o Advogado de documentos do Bidd.IA. Você recebe UM anexo de um edital de licitação e, se ele for um MODELO que a
empresa precisa preencher e assinar (declaração, carta, termo, requerimento), reproduz o modelo FIELMENTE e preenche TODAS
as lacunas com os dados da empresa que foram fornecidos. Você não cria declarações novas e não altera o texto do edital.

PASSO A PASSO
1. Leia o anexo inteiro. Se ele NÃO for um modelo para a empresa preencher (é planilha, termo de referência, minuta de contrato,
   regras do certame...), devolva "declaracoes": [] e explique em "avisos". Nunca invente uma declaração "padrão".
2. Se for um modelo, reproduza o texto LITERALMENTE: mesma ordem de frases, pontuação, numeração e estilo, sem corrigir
   português, sem resumir, sem reformular. A única mudança permitida é preencher as lacunas do próprio modelo.
3. Preencha TODAS as lacunas ("________", "........", "[razão social]", "(nome da empresa)", "CNPJ n.º ____", "sediada em ____",
   local e data, nome e CPF do declarante) usando os DADOS DA EMPRESA fornecidos:
   - razão social / nome da empresa → razão social;
   - CNPJ → CNPJ como está nos dados;
   - sede, endereço, domicílio → endereço completo fornecido;
   - nome do declarante / representante legal / responsável → representante legal; CPF → CPF do representante;
   - cargo / qualidade / função do declarante → "sócio / representante legal";
   - local e data → "<cidade>/<UF>, <data de hoje por extenso>" (a data de hoje vem no contexto);
   - número ou identificação do edital / pregão / processo e nome do órgão → copie do próprio edital (o contexto traz esses dados).
4. Só deixe uma lacuna em branco quando NENHUM dado fornecido a preenche (por exemplo: número de empregados, faturamento, número
   de registro em conselho, número de contrato anterior). Nesse caso deixe a lacuna exatamente como está no modelo e descreva-a em
   "camposNaoPreenchidos". NUNCA invente um valor.
5. Assinatura: mantenha a linha de assinatura do modelo em branco; preencha normalmente o nome, o CPF e o cargo escritos abaixo
   dela.
6. O resultado precisa parecer um documento comum, pronto para assinar: nada de markdown (asteriscos, #, crases), nada de
   comentários, observações, notas ou texto que não esteja no modelo do edital.
7. Divida em "paragrafos" seguindo os próprios parágrafos/itens do modelo, na mesma ordem — não junte nem quebre diferente.
8. Se vier uma CORREÇÃO do usuário, aplique apenas o que ela pedir e apenas nos campos de preenchimento; se pedir para alterar
   o texto do modelo, recuse e diga em "avisos" que o texto do modelo é do edital.

FORMATO DE SAÍDA (JSON)
{
  "declaracoes": [
    { "nome": string (nome do anexo como no edital, ex: "Anexo III – Declaração de Inexistência de Fato Impeditivo"),
      "paragrafos": string[] (parágrafos do modelo já preenchidos),
      "camposNaoPreenchidos": string[] }
  ],
  "avisos": string[]
}

CONFERÊNCIA FINAL
- O texto fora das lacunas está idêntico ao do edital?
- Toda lacuna que os dados da empresa preenchem foi preenchida?
- Toda lacuna que ficou aberta está em "camposNaoPreenchidos"?
- Não há marcação de markdown nem comentário meu no texto?
- O JSON é válido e sem texto em volta?`);
}

async function lerAnexo(args: {
  anexo: AnexoDoTexto;
  contextoBase: string;
  dadosEmpresa: string;
  notaCorrecao?: string;
  modelo: string;
}): Promise<AnexoGerado[]> {
  const { anexo, contextoBase, dadosEmpresa, notaCorrecao, modelo } = args;
  const r = await askJSON<RespostaAnexo>(
    promptAdvogado(),
    `${contextoBase}\n\n=== DADOS DA EMPRESA (use para preencher as lacunas) ===\n${dadosEmpresa}\n${
      notaCorrecao ? `\n=== CORREÇÃO PEDIDA PELO USUÁRIO ===\n${notaCorrecao}\n` : ""
    }\n=== ANEXO DO EDITAL: ${anexo.titulo || `ANEXO ${anexo.id}`} ===\n${anexo.texto}`,
    { model: modelo, maxTokens: 4_500 }
  );

  const geradas: AnexoGerado[] = [];
  for (const d of r.declaracoes ?? []) {
    const nome = typeof d?.nome === "string" ? d.nome.trim() : "";
    const paragrafos = sanearParagrafos(d?.paragrafos);
    if (!nome || paragrafos.length === 0) continue;
    const campos = Array.isArray(d?.camposNaoPreenchidos) ? d.camposNaoPreenchidos.filter((c): c is string => typeof c === "string") : [];
    geradas.push({
      nome,
      paragrafos,
      camposNaoPreenchidos: campos,
      fidelidade: fidelidadeAoEdital(paragrafos, anexo.texto, dadosEmpresa),
    });
  }
  return geradas;
}

export async function executarAgente4(editalId: string, opts?: { notaCorrecao?: string }) {
  return withAgentRun(editalId, "agente4-advogado", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({
      where: { id: editalId },
      include: { company: { include: { user: { select: { email: true } } } }, analysis: true },
    });

    const { textoEdital, textoTermoReferencia, textoAnexosPrecos, temTextoCompleto } = await obterTextoCompletoEdital(editalId, {
      palavrasChave: PALAVRAS_CHAVE_ANEXOS,
      tamanhoMax: TETO_TEXTO_ADVOGADO,
    });

    const identificacaoEdital =
      edital.fonte === "PNCP"
        ? `Número de controle PNCP: ${edital.numeroControlePNCP}`
        : `Este edital foi enviado manualmente pelo usuário (sem número de controle do PNCP) — identifique o número do edital/pregão pelo próprio texto, se ele aparecer lá.`;
    const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    const contextoBase = `Edital: ${edital.titulo}
${identificacaoEdital}
Órgão licitante: ${edital.orgaoNome} (CNPJ ${edital.orgaoCnpj})
Modalidade: ${edital.modalidade ?? "não informado"}
Objeto (resumo do analista): ${edital.analysis?.resumoObjeto ?? edital.descricao}
Data de hoje (para as lacunas de local e data): ${hoje}`;
    const dadosEmpresa = dadosDaEmpresaParaPreencher(edital.company);

    const todosAnexos: AnexoGerado[] = [];
    const semResultado: string[] = [];

    if (temTextoCompleto) {
      const textoTodo = [textoEdital, textoTermoReferencia, textoAnexosPrecos].filter(Boolean).join("\n\n");

      // 1) Inventário pelo código: cada anexo "ANEXO ..." que parece um modelo é lido SOZINHO pela IA — assim nenhum
      //    é esquecido por falta de espaço ou de atenção. Anexo de modelo que a IA devolver vazio tenta de novo com o
      //    modelo mais forte; se mesmo assim não sair, vai para o aviso (nunca some em silêncio).
      const candidatos = dividirEmAnexos(textoTodo).filter(pareceModeloPreenchivel).slice(0, 30);
      const resultados = await mapComLimite(candidatos, 5, async (anexo) => {
        try {
          let r = await lerAnexo({ anexo, contextoBase, dadosEmpresa, notaCorrecao: opts?.notaCorrecao, modelo: MODELO_HAIKU });
          if (r.length === 0) r = await lerAnexo({ anexo, contextoBase, dadosEmpresa, notaCorrecao: opts?.notaCorrecao, modelo: MODELO_SONNET });
          return { anexo, r };
        } catch (err) {
          console.error(`Agente Advogado: falha ao ler o anexo "${anexo.titulo}" do edital ${editalId}:`, err);
          return { anexo, r: [] as AnexoGerado[] };
        }
      });
      const vistos = new Set<string>();
      for (const { anexo, r } of resultados) {
        if (r.length === 0) {
          semResultado.push(anexo.titulo || `Anexo ${anexo.id}`);
          continue;
        }
        for (const g of r) {
          const chave = chaveDoAnexo(g.nome);
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          todosAnexos.push(g);
        }
      }

      // 2) Modelos que ficam no corpo do edital (sem cabeçalho "ANEXO"): uma passada sobre o texto do edital, só para
      //    o que o inventário não achou.
      const jaTem = (nome: string) => vistos.has(chaveDoAnexo(nome));
      try {
        const corpo = [textoEdital, textoTermoReferencia].filter(Boolean).join("\n\n").slice(0, 60_000);
        if (corpo.trim() !== "") {
          const r = await lerAnexo({
            anexo: { id: "-", titulo: "EDITAL (corpo do texto) — procure modelos de declaração fora dos anexos", texto: corpo },
            contextoBase,
            dadosEmpresa,
            notaCorrecao: opts?.notaCorrecao,
            modelo: MODELO_HAIKU,
          });
          for (const g of r) {
            if (jaTem(g.nome)) continue;
            vistos.add(chaveDoAnexo(g.nome));
            todosAnexos.push(g);
          }
        }
      } catch (err) {
        console.error(`Agente Advogado: falha na passada pelo corpo do edital ${editalId}:`, err);
      }
    }

    // Gera todos os PDFs ANTES de tocar no banco — se a geração de algum anexo falhar,
    // o Promise.all rejeita aqui, antes de apagar os anexos antigos (ver correção via
    // chat abaixo), deixando o edital com o conjunto anterior intacto em vez de um
    // conjunto pela metade (alguns novos, os demais simplesmente sumidos).
    // Sem rodapé: o documento sai limpo, igual a um documento comum da empresa, sem nenhuma marca de IA.
    const gerados = await Promise.all(
      todosAnexos.map(async (anexo) => ({
        nome: anexo.nome,
        bytes: await gerarPdfTimbrado({ company: edital.company, titulo: anexo.nome, paragrafos: anexo.paragrafos }),
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

    const lacunasAbertas = todosAnexos.flatMap((a) => a.camposNaoPreenchidos.map((c) => `${a.nome}: ${c}`));
    const pocoFieis = todosAnexos.filter((a) => a.fidelidade < FIDELIDADE_MINIMA).map((a) => a.nome);
    const alertas: string[] = [];
    if (semResultado.length > 0) {
      alertas.push(`Estes anexos pareciam modelos, mas não consegui reproduzi-los: ${semResultado.join("; ")}. Confira no edital e use o chat do Advogado para pedir de novo.`);
    }
    if (lacunasAbertas.length > 0) {
      alertas.push(`${lacunasAbertas.length} lacuna(s) ficaram em branco porque o cadastro da empresa não tem esse dado: ${lacunasAbertas.slice(0, 6).join("; ")}${lacunasAbertas.length > 6 ? "…" : ""}.`);
    }
    if (pocoFieis.length > 0) {
      alertas.push(`Confira o texto destes modelos contra o edital (pode ter diferença): ${pocoFieis.join("; ")}.`);
    }

    await logAudit(
      editalId,
      "Agente Advogado",
      opts?.notaCorrecao ? "Correção via chat" : "Geração de anexos",
      alertas.length > 0 ? "ALERTA" : "OK",
      (criados.length > 0
        ? `${criados.length} modelo(s) de declaração encontrado(s) no texto do edital e preenchido(s) com os dados da empresa${opts?.notaCorrecao ? " (regerado a pedido do usuário)" : ""}.`
        : temTextoCompleto
          ? "Nenhum modelo de declaração foi encontrado no texto do edital — nenhum anexo foi gerado, para não inventar um documento que o edital não forneceu."
          : "O texto do edital não estava disponível — nenhum anexo foi gerado.") + (alertas.length > 0 ? ` ${alertas.join(" ")}` : "")
    );

    return criados;
  });
}
