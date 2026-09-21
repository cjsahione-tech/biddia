import { createClient } from "@supabase/supabase-js";

// Bucket privado dedicado a anexos do checklist (certidões, contrato social, alvarás
// etc.) — existe pra fugir do teto de ~4,5MB de corpo de requisição das funções
// serverless da Vercel: o navegador envia o arquivo direto pro Storage usando uma URL
// assinada, sem passar pelo corpo da nossa própria API.
const BUCKET = "documentos-habilitacao";

let client: ReturnType<typeof createClient> | null = null;

export function isStorageConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function getClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL/SUPABASE_ANON_KEY não configuradas — upload de anexo grande indisponível.");
  }
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return client;
}

function sanitizarNomeArquivo(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9-_.]/g, "_").slice(-150);
}

/** Monta um caminho único e já escopado por empresa/edital/item — nenhum outro dado
 * além disso entra na decisão de onde o arquivo fica; a autorização de quem pode pedir
 * essa URL já foi checada antes, na própria rota da API (requireCompany + dono do item). */
export function caminhoAnexo(companyId: string, editalId: string, itemId: string, nomeArquivo: string): string {
  return `${companyId}/${editalId}/${itemId}/${Date.now()}-${sanitizarNomeArquivo(nomeArquivo)}`;
}

/** Mesmo bucket do checklist — o dossiê da empresa (CompanyDocument) não pertence a
 * nenhum edital, então o caminho troca editalId/itemId por um segmento fixo "dossie". */
export function caminhoDocumentoEmpresa(companyId: string, docId: string, nomeArquivo: string): string {
  return `${companyId}/dossie/${docId}/${Date.now()}-${sanitizarNomeArquivo(nomeArquivo)}`;
}

/** Captação manual de edital: ainda não existe editalId nesse momento (o PDF sobe ANTES
 * de o registro do edital ser criado), então o caminho usa um id de sessão livre gerado
 * pelo cliente (ex: um cuid solto) em vez do editalId. */
export function caminhoEditalManual(companyId: string, sessaoId: string, nomeArquivo: string): string {
  return `${companyId}/captura-manual/${sessaoId}/${Date.now()}-${sanitizarNomeArquivo(nomeArquivo)}`;
}

/** Documento baixado do PNCP/LicitaNet grande demais pra guardar como base64 inline no
 * Postgres (ver agente1-comercial.ts) — mesmo bucket, escopado por edital/documento. */
export function caminhoDocumentoEdital(companyId: string, editalId: string, docId: string, nomeArquivo: string): string {
  return `${companyId}/${editalId}/documentos/${docId}/${Date.now()}-${sanitizarNomeArquivo(nomeArquivo)}`;
}

/** Gera uma URL assinada de upload — o navegador faz PUT direto nela, o arquivo nunca
 * passa pelo corpo da nossa função serverless. Token válido por tempo curto. */
export async function criarUrlUpload(path: string) {
  const { data, error } = await getClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return data; // { path, token, signedUrl }
}

/** URL assinada de download, válida por 5 minutos — gerada sob demanda a cada request
 * de download, não armazenada. */
export async function criarUrlDownload(path: string) {
  const { data, error } = await getClient().storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

/** Sobe bytes direto pro Storage a partir do servidor (sem URL assinada) — usado quando
 * o arquivo já está em memória no backend, ex: documento baixado do PNCP/LicitaNet
 * grande demais pra guardar como base64 inline no Postgres (ver agente1-comercial.ts). */
export async function subirAnexo(path: string, bytes: Uint8Array, contentType = "application/pdf") {
  const { error } = await getClient().storage.from(BUCKET).upload(path, bytes, { contentType });
  if (error) throw error;
}

export async function apagarAnexo(path: string) {
  await getClient().storage.from(BUCKET).remove([path]);
}

/** Baixa os bytes de um anexo direto (sem passar por URL assinada) — usado pelo ZIP da
 * pasta completa, que precisa do conteúdo de todos os anexos de uma vez no servidor. */
export async function baixarAnexo(path: string): Promise<Uint8Array> {
  const { data, error } = await getClient().storage.from(BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
