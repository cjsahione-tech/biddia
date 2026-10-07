"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SEGMENTOS_LICITANET } from "@/lib/licitanet-segmentos";

// Campo único de "Segmento no LicitaNet" — usado na tela Empresa (qualquer perfil), no
// cadastro inicial (onboarding) e no formulário de novo cliente da carteira. Combobox com
// busca: digitar parte do nome filtra a lista na hora, ignorando acentos e maiúsculas.

/** Minúsculas e sem acento: "Hospitalar" e "hospitalár" casam com "HOSPITALAR". */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

type Props = {
  id: string;
  value: number | null;
  onChange: (id: number | null) => void;
};

export function SegmentoLicitaNetSelect({ id, value, onChange }: Props) {
  const listaId = useId();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);

  const selecionado = SEGMENTOS_LICITANET.find((s) => s.id === value) ?? null;

  const opcoes = useMemo(() => {
    // Cada palavra digitada precisa aparecer no nome (em qualquer ordem): "manutencao odonto"
    // acha "Manutenção de Equipamentos Odontológicos/Hospitalares".
    const palavras = normalizarBusca(busca).split(/\s+/).filter(Boolean);
    const filtrados = palavras.length
      ? SEGMENTOS_LICITANET.filter((s) => {
          const nome = normalizarBusca(s.nome);
          return palavras.every((p) => nome.includes(p));
        })
      : SEGMENTOS_LICITANET;
    // "Não buscar" sempre primeiro (some só quando a busca digitada não tem nada a ver com ele).
    return [{ id: null as number | null, nome: "Não buscar no LicitaNet" }, ...filtrados];
  }, [busca]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (raiz.current && !raiz.current.contains(e.target as Node)) fechar();
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function fechar() {
    setAberto(false);
    setBusca("");
    setAtivo(0);
  }

  function escolher(segmentoId: number | null) {
    onChange(segmentoId);
    fechar();
  }

  function aoDigitar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAberto(true);
      setAtivo((i) => Math.min(i + 1, opcoes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && aberto) {
      e.preventDefault();
      const op = opcoes[ativo];
      if (op) escolher(op.id);
    } else if (e.key === "Escape") {
      fechar();
    }
  }

  return (
    <div ref={raiz} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={listaId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Digite para buscar (ex.: hospitalar)"
          value={aberto ? busca : (selecionado?.nome ?? "")}
          onFocus={() => setAberto(true)}
          onChange={(e) => {
            setBusca(e.target.value);
            setAberto(true);
            setAtivo(0);
          }}
          onKeyDown={aoDigitar}
          className="mt-1.5 block w-full rounded-lg border border-border bg-background py-2 pl-3 pr-9 text-sm text-foreground placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-muted" />
      </div>

      {aberto && (
        <ul
          id={listaId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-background py-1 shadow-lg"
        >
          {opcoes.map((op, i) => (
            <li
              key={op.id ?? "nenhum"}
              role="option"
              aria-selected={op.id === value}
              // onMouseDown (não onClick) para escolher antes do campo perder o foco.
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(op.id);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === ativo ? "bg-brand-light text-brand" : "text-foreground"
              } ${op.id === value ? "font-medium" : ""} ${op.id === null ? "italic text-muted" : ""}`}
            >
              {op.nome}
            </li>
          ))}
          {opcoes.length === 1 && busca.trim() !== "" && (
            <li className="px-3 py-2 text-sm text-muted">Nenhum segmento encontrado para &ldquo;{busca}&rdquo;.</li>
          )}
        </ul>
      )}
    </div>
  );
}
