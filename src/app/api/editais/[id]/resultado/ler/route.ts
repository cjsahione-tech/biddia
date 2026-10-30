import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { base64ParaBytes } from "@/lib/agents/pdf-extract";
import { MAX_ITENS_RESULTADO } from "@/lib/planilha-resultado";
import { ErroLeituraPlanilha, lerArquivoPlanilha } from "@/lib/planilha-resultado-leitura";

// Corpo em base64 (~33% maior que o arquivo) contra o limite fixo de ~4,5MB da Vercel.
const TAMANHO_MAXIMO = 3 * 1024 * 1024;

const coluna = z.number().int().min(0).max(100).nullable().optional();

const schema = z.object({
  arquivoBase64: z.string().min(1),
  nomeArquivo: z.string().trim().min(1).max(200),
  // Colunas que o usuário trocou na tela de conferência (índice da coluna, 0 = primeira).
  ajuste: z
    .object({
      numero: coluna,
      descricao: coluna,
      unidade: coluna,
      quantidade: coluna,
      valorUnitario: coluna,
      valorTotal: coluna,
    })
    .optional(),
});

/**
 * Só LÊ a planilha e devolve o que entendeu (itens, colunas e avisos) para o usuário conferir.
 * Não salva nada e não mexe no edital — quem salva é PUT /api/editais/[id]/resultado.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id }, select: { id: true } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Envie uma planilha válida." }, { status: 400 });

  const { arquivoBase64, nomeArquivo, ajuste } = parsed.data;
  if (arquivoBase64.length * 0.75 > TAMANHO_MAXIMO) {
    return NextResponse.json({ error: `Arquivo muito grande. O limite é de ${TAMANHO_MAXIMO / 1024 / 1024}MB.` }, { status: 400 });
  }

  try {
    const leitura = await lerArquivoPlanilha(base64ParaBytes(arquivoBase64), nomeArquivo, ajuste);
    if (leitura.itens.length > MAX_ITENS_RESULTADO) {
      return NextResponse.json(
        { error: `A planilha tem mais de ${MAX_ITENS_RESULTADO} itens. Envie só a lista de itens da proposta final.` },
        { status: 400 }
      );
    }
    return NextResponse.json({ leitura });
  } catch (err) {
    if (err instanceof ErroLeituraPlanilha) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error(`Falha ao ler planilha de resultado (edital ${id}):`, err);
    return NextResponse.json({ error: "Não foi possível ler essa planilha. Confira se é um arquivo .xlsx ou .csv válido." }, { status: 400 });
  }
}
