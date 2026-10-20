"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { CabecalhoMobile } from "@/components/shell/CabecalhoMobile";
import { ListaEditaisMobile } from "@/components/dashboard/ListaEditaisMobile";
import type { EditalListItem, EtapaKanban } from "@/lib/types";

export function EditaisMobileClient({ etapaInicial }: { etapaInicial?: EtapaKanban }) {
  const [editais, setEditais] = useState<EditalListItem[] | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/editais");
      if (!res.ok) throw new Error();
      setEditais((await res.json()).editais ?? []);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    carregar();
  }, [carregar]);

  return (
    <>
      <div className="px-4 pt-5 md:hidden">
        <CabecalhoMobile titulo="Editais" subtitulo={editais ? `${editais.filter((e) => e.etapaKanban !== "RASCUNHO").length} no quadro` : "Carregando…"} />
        {erro && <p className="mt-4 text-sm text-danger">Não foi possível carregar os editais.</p>}
        {!editais && !erro && (
          <div className="flex justify-center py-16 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {editais && <ListaEditaisMobile editais={editais} onMovido={carregar} comBusca etapaInicial={etapaInicial} />}
      </div>
      {/* No computador o quadro de arrastar já cuida disto. */}
      <div className="hidden p-8 md:block">
        <p className="text-sm text-muted">
          Esta lista é a versão de celular. No computador, use o quadro em{" "}
          <Link href="/dashboard" className="font-medium text-brand hover:underline">
            Editais
          </Link>
          .
        </p>
      </div>
    </>
  );
}
