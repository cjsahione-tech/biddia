import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { apagarAnexo } from "@/lib/storage";
import { reavaliarEditaisDaEmpresa } from "@/lib/agents/auditoria-habilitacao";
import { itemPorChave, chaveEfetivaDoDocumento } from "@/lib/catalogo-documentos";

const CATEGORIAS = [
  "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "QUALIFICACAO_TECNICA_EMPRESA",
  "QUALIFICACAO_EQUIPE_TECNICA",
  "GARANTIA_CONTRATO",
] as const;
const FORMAS = ["COPIA_SIMPLES", "AUTENTICADO", "ASSINATURA_DIGITAL"] as const;

const schema = z.object({
  categoria: z.enum(CATEGORIAS).nullable().optional(),
  // Classificar um documento já enviado ("Outros") como um item do catálogo.
  catalogoChave: z.string().max(100).optional(),
  forma: z.enum(FORMAS).optional(),
  dataEmissao: z.string().optional().nullable(),
  validade: z.string().optional().nullable(),
  // Consumido depois que o navegador já enviou o arquivo direto pro Storage via URL
  // assinada (ver [docId]/upload-url/route.ts) — mesmo fluxo do checklist.
  storagePath: z.string().min(1).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { docId } = await params;

  const documento = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company!.id } });
  if (!documento) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { categoria, forma, dataEmissao, validade, storagePath, catalogoChave } = parsed.data;

  let classificacao: { catalogoChave: string; tipo: string; categoria: typeof categoria } | null = null;
  if (catalogoChave !== undefined) {
    const item = itemPorChave(catalogoChave);
    if (!item) return NextResponse.json({ error: "Item de documento desconhecido" }, { status: 400 });
    // Cada item do catálogo guarda UM documento — se já houver outro, não sobrescreve.
    const outros = await prisma.companyDocument.findMany({
      where: { companyId: company!.id, id: { not: docId } },
      select: { tipo: true, catalogoChave: true },
    });
    if (outros.some((d) => chaveEfetivaDoDocumento(d) === item.chave)) {
      return NextResponse.json(
        { error: "Este item já tem um documento enviado. Remova ou substitua o existente antes." },
        { status: 409 }
      );
    }
    classificacao = { catalogoChave: item.chave, tipo: item.tipoLegado ?? item.nome, categoria: item.categoriaLegada ?? null };
  }

  const atualizado = await prisma.companyDocument.update({
    where: { id: docId },
    data: {
      ...(classificacao
        ? { catalogoChave: classificacao.catalogoChave, tipo: classificacao.tipo, categoria: classificacao.categoria }
        : categoria !== undefined
          ? { categoria }
          : {}),
      ...(forma !== undefined ? { forma } : {}),
      ...(dataEmissao !== undefined ? { dataEmissao: dataEmissao ? new Date(dataEmissao) : null } : {}),
      ...(validade !== undefined ? { validade: validade ? new Date(validade) : null } : {}),
      ...(storagePath !== undefined ? { storagePath } : {}),
    },
  });


  // A documentação mudou: refaz a conferência de habilitação dos editais abertos (em segundo plano).
  const origem = new URL(req.url).origin;
  after(async () => {
    await reavaliarEditaisDaEmpresa(company!.id, origem);
  });

  const { conteudoBase64: _conteudo, ...semConteudo } = atualizado;
  void _conteudo;
  return NextResponse.json({ documento: semConteudo });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { docId } = await params;

  const documento = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company!.id } });
  if (!documento) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  await prisma.companyDocument.delete({ where: { id: docId } });
  if (documento.storagePath) await apagarAnexo(documento.storagePath).catch(() => null);

  // A documentação mudou: refaz a conferência de habilitação dos editais abertos (em segundo plano).
  const origem = new URL(req.url).origin;
  after(async () => {
    await reavaliarEditaisDaEmpresa(company!.id, origem);
  });

  return NextResponse.json({ ok: true });
}
