import { FileText, Download, Landmark } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { DocumentItem } from "@/lib/types";

function labelDocumento(doc: DocumentItem) {
  if (doc.tipo === "DOCUMENTO_PNCP") return "Publicado pelo órgão no PNCP";
  if (doc.tipo === "ANEXO_GERADO") return "Gerado automaticamente";
  return "Enviado pelo usuário";
}

function DocumentRow({ editalId, doc }: { editalId: string; doc: DocumentItem }) {
  const oficial = doc.tipo === "DOCUMENTO_PNCP";
  return (
    <div className="flex items-center justify-between rounded-xl border border-border p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            oficial ? "bg-accent/10 text-accent" : "bg-brand-light text-brand"
          }`}
        >
          {oficial ? <Landmark className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{doc.nome}</p>
          <p className="text-xs text-muted">
            {labelDocumento(doc)} · {formatDate(doc.createdAt)}
          </p>
        </div>
      </div>
      <a
        href={`/api/editais/${editalId}/documents/${doc.id}/download`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
      >
        <Download className="h-3.5 w-3.5" /> Baixar PDF
      </a>
    </div>
  );
}

export function DocumentsTab({ editalId, documents }: { editalId: string; documents: DocumentItem[] }) {
  const oficiais = documents.filter((d) => d.tipo === "DOCUMENTO_PNCP");
  const preparados = documents.filter((d) => d.tipo !== "DOCUMENTO_PNCP");

  if (documents.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        Nenhum documento disponível ainda. O edital e o termo de referência aparecem aqui assim que o
        Agente Comercial os localizar no PNCP.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {oficiais.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Documentos oficiais (PNCP)</h4>
          <p className="mt-1 text-xs text-muted">
            Edital e termo de referência publicados pelo órgão, baixados direto da fonte oficial.
          </p>
          <div className="mt-3 space-y-3">
            {oficiais.map((doc) => (
              <DocumentRow key={doc.id} editalId={editalId} doc={doc} />
            ))}
          </div>
        </div>
      )}

      {preparados.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Anexos preparados pela Licitax</h4>
          <div className="mt-3 space-y-3">
            {preparados.map((doc) => (
              <DocumentRow key={doc.id} editalId={editalId} doc={doc} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
