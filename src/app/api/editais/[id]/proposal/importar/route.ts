import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { importarPlanilhaProposta } from "@/lib/proposal-import";
import { base64ParaBytes } from "@/lib/agents/pdf-extract";
import { logAudit, tocarEdital } from "@/lib/agents/run-tracker";

// Mesmo teto prático usado nos outros uploads pequenos da plataforma (corpo em base64,
// ~33% maior que o arquivo, contra o limite fixo de ~4,5MB da Vercel).
const TAMANHO_MAXIMO = 3.5 * 1024 * 1024;

const schema = z.object({
  arquivoBase64: z.string().min(1),
});

/**
 * Substitui a proposta financeira do edital pelos itens de uma planilha .xlsx enviada
 * pelo usuário — em vez do que o Agente Financeiro extraiu do texto do edital. Não
 * passa pela IA: os itens são lidos direto da planilha (ver src/lib/proposal-import.ts),
 * então o resultado é exatamente o que está nas células, sem risco de reinterpretação.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({
    where: { id, companyId: company!.id },
    include: { proposal: true },
  });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const { arquivoBase64 } = parsed.data;
  const tamanhoBase64 = arquivoBase64.length * 0.75;
  if (tamanhoBase64 > TAMANHO_MAXIMO) {
    return NextResponse.json(
      { error: `Arquivo muito grande. O limite é de ${(TAMANHO_MAXIMO / 1024 / 1024).toFixed(1)}MB.` },
      { status: 400 }
    );
  }

  let resultado;
  try {
    resultado = await importarPlanilhaProposta(base64ParaBytes(arquivoBase64));
  } catch (err) {
    console.error(`Falha ao importar planilha de proposta (edital ${id}):`, err);
    return NextResponse.json(
      { error: "Não foi possível ler essa planilha. Confira se é um arquivo .xlsx válido, no formato do modelo." },
      { status: 400 }
    );
  }

  if (resultado.itens.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum item válido foi encontrado na planilha. Confira o formato (Descrição, Unidade, Quantidade, Valor unitário) e tente de novo.",
      },
      { status: 400 }
    );
  }

  const somaItens = resultado.itens.reduce((acc, i) => acc + i.valorTotal, 0);
  const qtdItens = resultado.itens.length;
  const notaImportacao = `Planilha importada manualmente pelo usuário em ${new Date().toLocaleDateString("pt-BR")} (${qtdItens} ite${qtdItens === 1 ? "m" : "ns"}), substituindo a proposta gerada automaticamente.`;

  const proposal = await prisma.proposal.upsert({
    where: { editalId: id },
    create: {
      editalId: id,
      valorGlobalReferencia: edital.valorGlobal ?? somaItens,
      itensJson: JSON.stringify(resultado.itens),
      observacoes: notaImportacao,
      baseadoEmTextoCompleto: true,
    },
    update: {
      itensJson: JSON.stringify(resultado.itens),
      observacoes: [edital.proposal?.observacoes, notaImportacao].filter(Boolean).join("\n\n"),
      baseadoEmTextoCompleto: true,
    },
  });

  await logAudit(
    id,
    "Agente Financeiro",
    "Importação manual de planilha",
    resultado.avisos.length > 0 ? "ALERTA" : "OK",
    `O usuário importou uma planilha própria com ${qtdItens} item(ns), substituindo a proposta anterior, somando R$ ${somaItens.toFixed(2)}.` +
      (resultado.avisos.length > 0 ? ` Avisos: ${resultado.avisos.join(" ")}` : "")
  );

  await tocarEdital(id);

  return NextResponse.json({ proposal, avisos: resultado.avisos });
}
