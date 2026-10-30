import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { logAudit, tocarEdital } from "@/lib/agents/run-tracker";
import { formatBRL } from "@/lib/format";
import { round2 } from "@/lib/proposal";
import {
  MAX_ITENS_RESULTADO,
  parseItensResultado,
  somaDosItens,
  type ItemResultado,
  type ResultadoEditalDados,
} from "@/lib/planilha-resultado";

// Corpo em base64 (~33% maior que o arquivo) contra o limite fixo de ~4,5MB da Vercel.
const TAMANHO_MAXIMO_ARQUIVO = 3 * 1024 * 1024;

const itemSchema = z.object({
  numero: z.number().int().nullable().optional(),
  descricao: z.string().trim().min(1).max(500),
  unidade: z.string().trim().max(40).optional(),
  quantidade: z.number().positive().max(1e9),
  valorUnitario: z.number().min(0).max(1e12),
});

const schema = z.object({
  valorHomologado: z.number().positive().max(1e12),
  // Itens já conferidos pelo usuário na tela (vazio = resultado sem planilha). O total de cada
  // item é sempre recalculado aqui — nunca confiamos no total vindo do navegador.
  itens: z.array(itemSchema).max(MAX_ITENS_RESULTADO),
  arquivo: z.object({ nome: z.string().trim().min(1).max(200), base64: z.string().min(1) }).optional(),
});

type LinhaResultado = {
  valorHomologado: number;
  itensJson: string;
  nomeArquivo: string | null;
  documentoId: string | null;
  updatedAt: Date;
};

/**
 * A aba Documentos guarda o arquivo como "data:<tipo>;base64,<conteúdo>" e o download depende desse formato —
 * então a planilha é guardada do mesmo jeito (o navegador desta tela manda só o conteúdo, sem o prefixo).
 */
function comoDataUrl(nome: string, base64: string): string {
  if (base64.startsWith("data:")) return base64;
  const tipo = /\.csv$/i.test(nome) ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return `data:${tipo};base64,${base64}`;
}

function paraDados(r: LinhaResultado): ResultadoEditalDados {
  return {
    valorHomologado: r.valorHomologado,
    itens: parseItensResultado(r.itensJson),
    nomeArquivo: r.nomeArquivo,
    documentoId: r.documentoId,
    atualizadoEm: r.updatedAt.toISOString(),
  };
}

/** Resultado registrado de um edital ganho (valor homologado + itens da planilha final). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({
    where: { id, companyId: company!.id },
    select: { id: true, titulo: true, orgaoNome: true, valorGlobal: true, proposal: { select: { valorGlobalReferencia: true } } },
  });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const resultado = (await prisma.resultadoEdital.findUnique({ where: { editalId: id } })) as LinhaResultado | null;

  return NextResponse.json({
    edital: {
      titulo: edital.titulo as string,
      orgaoNome: edital.orgaoNome as string,
      valorReferencia: (edital.valorGlobal ?? edital.proposal?.valorGlobalReferencia ?? null) as number | null,
    },
    resultado: resultado ? paraDados(resultado) : null,
  });
}

/**
 * Registra (ou corrige) o resultado de um edital ganho. Não move o card de coluna — isso o
 * quadro faz em seguida, pela rota de sempre (PATCH /api/editais/[id]/kanban), para manter
 * todos os efeitos que já existem ao mover um card.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id }, select: { id: true } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Confira o valor homologado e os itens da planilha." }, { status: 400 });

  const { valorHomologado, arquivo } = parsed.data;
  if (arquivo && arquivo.base64.length * 0.75 > TAMANHO_MAXIMO_ARQUIVO) {
    return NextResponse.json({ error: `Arquivo muito grande. O limite é de ${TAMANHO_MAXIMO_ARQUIVO / 1024 / 1024}MB.` }, { status: 400 });
  }

  const itens: ItemResultado[] = parsed.data.itens.map((i) => ({
    numero: i.numero ?? null,
    descricao: i.descricao,
    unidade: i.unidade || "un",
    quantidade: i.quantidade,
    valorUnitario: i.valorUnitario,
    valorTotal: round2(i.quantidade * i.valorUnitario),
  }));

  const anterior = (await prisma.resultadoEdital.findUnique({ where: { editalId: id } })) as LinhaResultado | null;

  let documentoId = anterior?.documentoId ?? null;
  let nomeArquivo = anterior?.nomeArquivo ?? null;
  if (arquivo) {
    // Anexo avulso: fica na aba Documentos do edital, fora do pipeline de agentes (mesmo caminho do
    // POST /api/editais/[id]/documents). A planilha anterior, se houver, continua guardada lá.
    const doc = await prisma.document.create({
      data: { editalId: id, nome: arquivo.nome, tipo: "DOCUMENTO_USUARIO", status: "DISPONIVEL", conteudoBase64: comoDataUrl(arquivo.nome, arquivo.base64) },
      select: { id: true },
    });
    documentoId = doc.id as string;
    nomeArquivo = arquivo.nome;
  }

  const dados = { valorHomologado, itensJson: JSON.stringify(itens), nomeArquivo, documentoId };
  const salvo = (await prisma.resultadoEdital.upsert({
    where: { editalId: id },
    create: { editalId: id, ...dados },
    update: dados,
  })) as LinhaResultado;

  await logAudit(
    id,
    "Usuário",
    anterior ? "Resultado corrigido" : "Resultado registrado",
    "OK",
    `Valor homologado de ${formatBRL(valorHomologado)}` +
      (itens.length > 0 ? `, com ${itens.length} item(ns) somando ${formatBRL(somaDosItens(itens))}.` : ", sem planilha de itens.")
  );
  await tocarEdital(id);

  return NextResponse.json({ resultado: paraDados(salvo) });
}
