"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Select } from "@/components/ui/Field";
import type { CompanyDocumentItem, FormaDocumento } from "@/lib/types";

// Mesmos tetos usados no checklist: arquivo pequeno vai embutido em base64 no corpo da
// requisição; acima disso, vai direto pro Storage via URL assinada (ver upload-url).
const TAMANHO_MAXIMO_BASE64 = 3.5 * 1024 * 1024;
const TAMANHO_MAXIMO_ANEXO = 25 * 1024 * 1024;

export const FORMA_LABEL: Record<FormaDocumento, string> = {
  COPIA_SIMPLES: "Cópia simples",
  AUTENTICADO: "Autenticado em cartório",
  ASSINATURA_DIGITAL: "Assinatura digital (ICP-Brasil)",
};

function lerComoBase64(file: File): Promise<string> {
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

function paraInputData(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

type Props = {
  /** Item do catálogo a que o arquivo pertence — o servidor define tipo e categoria a partir dele. */
  catalogoChave?: string;
  /** true = documento personalizado: pede o nome/tipo livre (grupo "Outros"). */
  personalizado?: boolean;
  /** Documento já enviado: com `soValidade`, só altera validade/forma, sem novo arquivo. */
  documentoAtual?: CompanyDocumentItem;
  soValidade?: boolean;
  /** Sugestão: este tipo de documento costuma ter data de validade. */
  venceTipicamente?: boolean;
  titulo: string;
  onConcluido: () => void;
  onCancelar: () => void;
};

export function FormularioEnvioDocumento({
  catalogoChave,
  personalizado,
  documentoAtual,
  soValidade,
  venceTipicamente,
  titulo,
  onConcluido,
  onCancelar,
}: Props) {
  const [tipoLivre, setTipoLivre] = useState("");
  const [forma, setForma] = useState<FormaDocumento>(documentoAtual?.forma ?? "COPIA_SIMPLES");
  const [temValidade, setTemValidade] = useState(documentoAtual ? !!documentoAtual.validade : !!venceTipicamente);
  const [validade, setValidade] = useState(paraInputData(documentoAtual?.validade ?? null));
  const [dataEmissao, setDataEmissao] = useState(paraInputData(documentoAtual?.dataEmissao ?? null));
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (temValidade && !validade) {
      setErro("Informe a data de validade ou desmarque \"Tem data de validade\".");
      return;
    }

    setSalvando(true);
    try {
      // Só mudar validade/forma de um documento já enviado — sem novo arquivo.
      if (soValidade && documentoAtual) {
        const res = await fetch(`/api/company/documents/${documentoAtual.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            forma,
            dataEmissao: dataEmissao || null,
            validade: temValidade ? validade || null : null,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setErro(data?.error ?? "Não foi possível salvar.");
          return;
        }
        onConcluido();
        return;
      }

      if (personalizado && !tipoLivre.trim()) {
        setErro("Informe o nome do documento.");
        return;
      }
      if (!arquivo) {
        setErro("Selecione o arquivo.");
        return;
      }
      if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
        setErro(`Arquivo muito grande (máx. ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(0)}MB).`);
        return;
      }

      const metadados = {
        ...(catalogoChave ? { catalogoChave } : { tipo: tipoLivre.trim() }),
        forma,
        dataEmissao: dataEmissao || null,
        validade: temValidade ? validade || null : null,
        nome: arquivo.name,
      };

      if (arquivo.size <= TAMANHO_MAXIMO_BASE64) {
        const conteudoBase64 = await lerComoBase64(arquivo);
        const res = await fetch("/api/company/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...metadados, conteudoBase64 }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setErro(data?.error ?? "Não foi possível salvar o documento.");
          return;
        }
      } else {
        const criarRes = await fetch("/api/company/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadados),
        });
        const criado = await criarRes.json().catch(() => null);
        if (!criarRes.ok) {
          setErro(criado?.error ?? "Não foi possível salvar o documento.");
          return;
        }
        const urlRes = await fetch(`/api/company/documents/${criado.documento.id}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nomeArquivo: arquivo.name, tamanhoBytes: arquivo.size }),
        });
        const urlData = await urlRes.json().catch(() => null);
        if (!urlRes.ok) {
          setErro(urlData?.error ?? "Não foi possível preparar o upload.");
          return;
        }
        await enviarParaStorage(urlData.signedUrl, arquivo);
        await fetch(`/api/company/documents/${criado.documento.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath: urlData.path }),
        });
      }
      onConcluido();
    } catch {
      setErro("Não foi possível salvar o documento. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="my-2 rounded-xl border border-brand/30 bg-brand-light/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{titulo}</p>
        <button type="button" onClick={onCancelar} className="text-muted hover:text-foreground" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {personalizado && (
          <Field label="Nome do documento" htmlFor="tipoLivre">
            <TextInput
              id="tipoLivre"
              value={tipoLivre}
              onChange={(e) => setTipoLivre(e.target.value)}
              placeholder="Ex: Alvará de funcionamento"
            />
          </Field>
        )}

        {!soValidade && (
          <Field label="Arquivo" htmlFor="arquivoDoc">
            <input
              id="arquivoDoc"
              type="file"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
            />
          </Field>
        )}

        <Field label="Validade" htmlFor="validadeDoc">
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={temValidade}
              onChange={(e) => setTemValidade(e.target.checked)}
              className="accent-brand"
            />
            Tem data de validade
          </label>
          {temValidade && (
            <TextInput
              id="validadeDoc"
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              className="mt-1.5"
            />
          )}
        </Field>

        <Field label="Forma do documento" htmlFor="formaDoc">
          <Select id="formaDoc" value={forma} onChange={(e) => setForma(e.target.value as FormaDocumento)}>
            {(Object.keys(FORMA_LABEL) as FormaDocumento[]).map((f) => (
              <option key={f} value={f}>
                {FORMA_LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Data de emissão" htmlFor="emissaoDoc" hint="Opcional.">
          <TextInput id="emissaoDoc" type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} />
        </Field>
      </div>

      {erro && <p className="mt-3 text-xs text-danger">{erro}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" loading={salvando}>
          {soValidade ? "Salvar validade" : "Salvar documento"}
        </Button>
      </div>
    </form>
  );
}
