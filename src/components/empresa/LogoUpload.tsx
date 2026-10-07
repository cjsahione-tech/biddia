"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

// Upload da logo da empresa — mesmo mecanismo da tela Empresa e do onboarding: o arquivo
// vira uma data URL gravada em Company.logoUrl, usada no timbrado dos documentos dos agentes.
const TAMANHO_MAX = 1_000_000; // ~1 MB — a logo vai no corpo da requisição

export function LogoUpload({ value, onChange }: { value: string | null; onChange: (dataUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);

  function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > TAMANHO_MAX) {
      setErro("A logo deve ter até 1 MB.");
      e.target.value = "";
      return;
    }
    setErro(null);
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface text-muted hover:border-brand hover:text-brand"
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Logo" className="h-full w-full object-contain" />
        ) : (
          <Upload className="h-5 w-5" />
        )}
      </button>
      <div>
        <p className="text-sm font-medium text-foreground">Logo da empresa</p>
        <p className="text-xs text-muted">Usada no timbrado dos documentos gerados.</p>
        {erro && <p className="mt-1 text-xs text-danger">{erro}</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={aoEscolher} />
    </div>
  );
}
