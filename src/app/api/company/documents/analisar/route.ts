import { NextResponse } from "next/server";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { requireCompany } from "@/lib/api-utils";
import { base64ParaBytes } from "@/lib/agents/pdf-extract";
import {
  avisoDeCnpj,
  extrairCnpjs,
  extrairEmissao,
  extrairValidade,
  sugerirItemDoDocumento,
} from "@/lib/documento-leitura";

// Reconhece um arquivo recém-escolhido na tela Documentos (item provável, validade, CNPJ) ANTES de salvar.
// Não usa IA: só o texto que já está dentro do PDF, então não custa token e é rápido. Arquivo sem
// texto (escaneado, imagem) é reconhecido só pelo nome e o usuário preenche o resto.
export const maxDuration = 30;

const PAGINAS_LIDAS = 3;
// O corpo da requisição na Vercel não passa de ~4,5MB (o base64 incha o arquivo em ~33%).
const TAMANHO_MAXIMO_BASE64 = 3 * 1024 * 1024;

const schema = z.object({
  nome: z.string().trim().min(1).max(250),
  conteudoBase64: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { nome, conteudoBase64 } = parsed.data;
  if (conteudoBase64 && conteudoBase64.length * 0.75 > TAMANHO_MAXIMO_BASE64) {
    return NextResponse.json({ error: "Arquivo grande demais para leitura automática." }, { status: 400 });
  }

  let texto: string | null = null;
  const pareceTexto = /\.pdf$/i.test(nome) || conteudoBase64?.startsWith("data:application/pdf");
  if (conteudoBase64 && pareceTexto) {
    try {
      const pdf = await getDocumentProxy(base64ParaBytes(conteudoBase64));
      const { text } = await extractText(pdf, { mergePages: false });
      const paginas = Array.isArray(text) ? text : [text];
      const lido = paginas.slice(0, PAGINAS_LIDAS).join("\n");
      // Escaneado: o pouco que vem é lixo de cabeçalho — melhor ignorar do que sugerir em cima disso.
      texto = lido.trim().length >= 80 ? lido : null;
    } catch {
      texto = null; // PDF protegido/corrompido: segue só pelo nome
    }
  }

  const sugestao = sugerirItemDoDocumento(nome, texto);
  const cnpjs = texto ? extrairCnpjs(texto) : [];
  return NextResponse.json({
    sugestao,
    validade: texto ? extrairValidade(texto) : null,
    dataEmissao: texto ? extrairEmissao(texto) : null,
    avisoCnpj: sugestao ? avisoDeCnpj(cnpjs, company!.cnpj, sugestao.chave) : null,
    leuOTexto: !!texto,
  });
}
