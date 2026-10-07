"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { TextInput } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

// Palavras-chave de pesquisa do PNCP: campo + tags com "x" para remover. Não sabe de onde
// vêm nem para onde vão — quem usa decide: a tela Empresa grava na hora pela API
// (/api/keywords); o formulário de novo cliente da carteira só guarda numa lista local até
// salvar. `onAdd` pode devolver false para recusar (ex.: já existe) e manter o texto.
export type PalavraChave = { key: string; term: string };

export function KeywordsInput({
  items,
  onAdd,
  onRemove,
}: {
  items: PalavraChave[];
  onAdd: (term: string) => boolean | void | Promise<boolean | void>;
  onRemove: (key: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");

  async function adicionar() {
    const term = draft.trim();
    if (!term) return;
    const ok = await onAdd(term);
    if (ok !== false) setDraft("");
  }

  return (
    <div>
      <div className="mt-3 flex gap-2">
        <TextInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionar();
            }
          }}
          placeholder="Nova palavra-chave"
          className="mt-0"
        />
        <Button type="button" variant="secondary" onClick={adicionar}>
          Adicionar
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((k) => (
          <span
            key={k.key}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand"
          >
            {k.term}
            <button type="button" onClick={() => onRemove(k.key)} className="text-brand/60 hover:text-brand">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {items.length === 0 && <p className="text-xs text-muted">Nenhuma palavra-chave cadastrada ainda.</p>}
      </div>
    </div>
  );
}
