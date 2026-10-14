import type { FormaDocumento } from "@/lib/types";

// Envio de UM arquivo para a documentação da empresa — usado pelo formulário de um item e pelo envio
// em lote. Arquivo pequeno vai embutido (base64) no corpo da requisição; maior, direto para o Storage
// por URL assinada. O corpo na Vercel não passa de ~4,5MB e o base64 incha o arquivo em ~33%: até 2,9MB
// de arquivo é seguro (a API recusa acima de 3MB já em base64).
export const TAMANHO_MAXIMO_BASE64 = 2.9 * 1024 * 1024;
export const TAMANHO_MAXIMO_ANEXO = 25 * 1024 * 1024;

export type MetadadosEnvio = {
  /** Item do catálogo; sem ele, é um documento personalizado e `tipo` (nome livre) é obrigatório. */
  catalogoChave?: string;
  tipo?: string;
  /** Pasta do documento personalizado (id do catálogo); ignorada quando há catalogoChave. */
  pasta?: string | null;
  forma: FormaDocumento;
  dataEmissao: string | null;
  validade: string | null;
  /** Item que aceita vários arquivos: guarda mais um em vez de substituir. */
  adicionar?: boolean;
  /** Envio em lote: a conferência dos editais é pedida uma vez no fim. */
  semReavaliar?: boolean;
};

export function lerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function enviarParaStorage(signedUrl: string, file: File) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`Falha no upload para o armazenamento (${res.status}).`);
}

export type ResultadoEnvio = { ok: true } | { ok: false; erro: string };

export async function enviarDocumento(arquivo: File, meta: MetadadosEnvio): Promise<ResultadoEnvio> {
  if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
    return { ok: false, erro: `Arquivo muito grande (máx. ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(0)}MB).` };
  }
  const metadados = { ...meta, nome: arquivo.name };
  try {
    if (arquivo.size <= TAMANHO_MAXIMO_BASE64) {
      const conteudoBase64 = await lerComoBase64(arquivo);
      const res = await fetch("/api/company/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...metadados, conteudoBase64 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { ok: false, erro: data?.error ?? "Não foi possível salvar o documento." };
      }
      return { ok: true };
    }

    const criarRes = await fetch("/api/company/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadados),
    });
    const criado = await criarRes.json().catch(() => null);
    if (!criarRes.ok) return { ok: false, erro: criado?.error ?? "Não foi possível salvar o documento." };

    const urlRes = await fetch(`/api/company/documents/${criado.documento.id}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nomeArquivo: arquivo.name, tamanhoBytes: arquivo.size }),
    });
    const urlData = await urlRes.json().catch(() => null);
    if (!urlRes.ok) return { ok: false, erro: urlData?.error ?? "Não foi possível preparar o upload." };

    await enviarParaStorage(urlData.signedUrl, arquivo);
    await fetch(`/api/company/documents/${criado.documento.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath: urlData.path }),
    });
    return { ok: true };
  } catch {
    return { ok: false, erro: "Não foi possível salvar o documento. Tente novamente." };
  }
}

export type AnaliseArquivo = {
  sugestao: { chave: string; confianca: "alta" | "media"; motivo: string } | null;
  validade: string | null;
  dataEmissao: string | null;
  avisoCnpj: string | null;
  leuOTexto: boolean;
};

/** Pede ao servidor o reconhecimento automático do arquivo (sem IA). Falha = sem sugestão, nunca erro. */
export async function analisarArquivo(arquivo: File): Promise<AnaliseArquivo | null> {
  try {
    const corpo: { nome: string; conteudoBase64?: string } = { nome: arquivo.name };
    if (arquivo.size <= TAMANHO_MAXIMO_BASE64 && /\.pdf$/i.test(arquivo.name)) corpo.conteudoBase64 = await lerComoBase64(arquivo);
    const res = await fetch("/api/company/documents/analisar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    return res.ok ? ((await res.json()) as AnaliseArquivo) : null;
  } catch {
    return null;
  }
}
