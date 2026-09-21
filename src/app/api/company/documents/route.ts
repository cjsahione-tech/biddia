import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { apagarAnexo } from "@/lib/storage";

const CATEGORIAS = [
  "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "QUALIFICACAO_TECNICA_EMPRESA",
  "QUALIFICACAO_EQUIPE_TECNICA",
  "GARANTIA_CONTRATO",
] as const;
const FORMAS = ["COPIA_SIMPLES", "AUTENTICADO", "ASSINATURA_DIGITAL"] as const;

// Mesmo teto do caminho pequeno (base64) do checklist — arquivos maiores usam o fluxo de
// URL assinada (ver [docId]/upload-url/route.ts).
const TAMANHO_MAXIMO_ANEXO_BASE64 = 3.5 * 1024 * 1024;

const schema = z.object({
  tipo: z.string().trim().min(1).max(200),
  categoria: z.enum(CATEGORIAS).nullable().optional(),
  forma: z.enum(FORMAS).optional(),
  dataEmissao: z.string().optional().nullable(),
  validade: z.string().optional().nullable(),
  nome: z.string().trim().min(1).max(200),
  conteudoBase64: z.string().min(1).optional(),
});

export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  const documentos = await prisma.companyDocument.findMany({
    where: { companyId: company!.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ documentos });
}

/**
 * Cria um documento no dossiê da empresa. O dossiê guarda o documento ATUAL por "tipo",
 * não um histórico — se já existir um documento com o mesmo tipo, o anterior (registro +
 * arquivo no Storage) é substituído, igual à troca de anexo de um item de checklist.
 */
export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { tipo, categoria, forma, dataEmissao, validade, nome, conteudoBase64 } = parsed.data;

  if (conteudoBase64) {
    const tamanhoBase64 = conteudoBase64.length * 0.75;
    if (tamanhoBase64 > TAMANHO_MAXIMO_ANEXO_BASE64) {
      return NextResponse.json(
        { error: `Arquivo muito grande para esse caminho. O limite é de ${(TAMANHO_MAXIMO_ANEXO_BASE64 / 1024 / 1024).toFixed(1)}MB.` },
        { status: 400 }
      );
    }
  }

  const anterior = await prisma.companyDocument.findFirst({ where: { companyId: company!.id, tipo } });
  if (anterior) {
    await prisma.companyDocument.delete({ where: { id: anterior.id } });
    if (anterior.storagePath) await apagarAnexo(anterior.storagePath).catch(() => null);
  }

  const documento = await prisma.companyDocument.create({
    data: {
      companyId: company!.id,
      tipo,
      categoria: categoria ?? null,
      forma: forma ?? "COPIA_SIMPLES",
      dataEmissao: dataEmissao ? new Date(dataEmissao) : null,
      validade: validade ? new Date(validade) : null,
      nome,
      conteudoBase64: conteudoBase64 ?? null,
    },
  });

  return NextResponse.json({ documento });
}
