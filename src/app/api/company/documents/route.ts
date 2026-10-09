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

// Mesmo teto do caminho pequeno (base64) do checklist — arquivos maiores usam o fluxo de
// URL assinada (ver [docId]/upload-url/route.ts).
const TAMANHO_MAXIMO_ANEXO_BASE64 = 3.5 * 1024 * 1024;

const schema = z.object({
  // Item do catálogo fixo (ver src/lib/catalogo-documentos.ts). Quando informado, o tipo e a
  // categoria vêm do catálogo no servidor — nunca do que o navegador mandar.
  catalogoChave: z.string().max(100).optional().nullable(),
  tipo: z.string().trim().min(1).max(200).optional(),
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

  // Sem conteudoBase64: arquivos podem ter vários MB e a lista só precisa dos metadados
  // (o conteúdo vem pela rota de download).
  const documentos = await prisma.companyDocument.findMany({
    where: { companyId: company!.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tipo: true,
      categoria: true,
      catalogoChave: true,
      nome: true,
      forma: true,
      dataEmissao: true,
      validade: true,
      createdAt: true,
    },
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
  const { catalogoChave, categoria: categoriaInformada, forma, dataEmissao, validade, nome, conteudoBase64 } = parsed.data;

  const item = catalogoChave ? itemPorChave(catalogoChave) : undefined;
  if (catalogoChave && !item) return NextResponse.json({ error: "Item de documento desconhecido" }, { status: 400 });
  const tipo = item ? (item.tipoLegado ?? item.nome) : parsed.data.tipo;
  if (!tipo) return NextResponse.json({ error: "Informe o tipo do documento" }, { status: 400 });
  const categoria = item ? (item.categoriaLegada ?? null) : categoriaInformada;

  if (conteudoBase64) {
    const tamanhoBase64 = conteudoBase64.length * 0.75;
    if (tamanhoBase64 > TAMANHO_MAXIMO_ANEXO_BASE64) {
      return NextResponse.json(
        { error: `Arquivo muito grande para esse caminho. O limite é de ${(TAMANHO_MAXIMO_ANEXO_BASE64 / 1024 / 1024).toFixed(1)}MB.` },
        { status: 400 }
      );
    }
  }

  // Um documento por item do catálogo (ou por tipo, nos personalizados): enviar de novo
  // SUBSTITUI o anterior. Documentos antigos (sem chave) que o catálogo reconhece pelo nome
  // do tipo também são substituídos, para não ficar duplicado.
  const candidatos = await prisma.companyDocument.findMany({
    where: { companyId: company!.id },
    select: { id: true, tipo: true, catalogoChave: true, storagePath: true },
  });
  const anteriores = candidatos.filter((d) =>
    item ? chaveEfetivaDoDocumento(d) === item.chave : d.tipo === tipo && !d.catalogoChave
  );
  for (const anterior of anteriores) {
    await prisma.companyDocument.delete({ where: { id: anterior.id } });
    if (anterior.storagePath) await apagarAnexo(anterior.storagePath).catch(() => null);
  }

  const documento = await prisma.companyDocument.create({
    data: {
      companyId: company!.id,
      tipo,
      categoria: categoria ?? null,
      catalogoChave: item?.chave ?? null,
      forma: forma ?? "COPIA_SIMPLES",
      dataEmissao: dataEmissao ? new Date(dataEmissao) : null,
      validade: validade ? new Date(validade) : null,
      nome,
      conteudoBase64: conteudoBase64 ?? null,
    },
  });


  // A documentação mudou: refaz a conferência de habilitação dos editais abertos (em segundo plano).
  const origem = new URL(req.url).origin;
  after(async () => {
    await reavaliarEditaisDaEmpresa(company!.id, origem);
  });

  // Não devolve o conteúdo do arquivo de volta (pode ter vários MB).
  const { conteudoBase64: _conteudo, ...documentoSemConteudo } = documento;
  void _conteudo;
  return NextResponse.json({ documento: documentoSemConteudo });
}
