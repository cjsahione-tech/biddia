import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

// Mesmo teto prático usado no upload manual de edital — corpo da requisição em
// base64 (~33% maior que o arquivo) contra o limite fixo de ~4,5MB da Vercel.
const TAMANHO_MAXIMO_ANEXO = 3.5 * 1024 * 1024;

const schema = z.object({
  nome: z.string().trim().min(1).max(200),
  arquivoBase64: z.string().min(1),
});

/** Anexo avulso enviado pelo usuário direto no card (ex: contrato assinado, print de
 * e-mail, comprovante) — não passa pelo pipeline de agentes, é só arquivo guardado. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Envie um arquivo válido." }, { status: 400 });

  const tamanhoBase64 = parsed.data.arquivoBase64.length * 0.75;
  if (tamanhoBase64 > TAMANHO_MAXIMO_ANEXO) {
    return NextResponse.json(
      { error: `Arquivo muito grande. O limite é de ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(1)}MB.` },
      { status: 400 }
    );
  }

  const doc = await prisma.document.create({
    data: {
      editalId: id,
      nome: parsed.data.nome,
      tipo: "DOCUMENTO_USUARIO",
      status: "DISPONIVEL",
      conteudoBase64: parsed.data.arquivoBase64,
    },
    // Sem conteudoBase64 na resposta — o cliente já tem o arquivo, não precisa dele de
    // volta (evita duplicar potencialmente vários MB na resposta à toa).
    select: { id: true, nome: true, tipo: true, categoria: true, status: true, validade: true, createdAt: true },
  });

  return NextResponse.json({ document: doc });
}
