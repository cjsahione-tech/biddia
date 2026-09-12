"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, TextArea, TextInput } from "@/components/ui/Field";
import { FonteBadge } from "@/components/ui/FonteBadge";
import type { EstudoViabilidadeDetail, RequisitosEstudo } from "@/lib/types";

const REQUISITOS_VAZIOS: RequisitosEstudo = {
  objeto: "",
  criterioJulgamento: "",
  prazoExecucao: "",
  localEntrega: "",
  formaPagamento: "",
  garantiasExigidas: "",
  equipeMinima: [],
  certificacoesExigidas: [],
  especificacaoTecnica: "",
  prazoEntrega: "",
  baseadoEmTextoCompleto: false,
};

function parseRequisitos(json: string | null): RequisitosEstudo {
  if (!json) return REQUISITOS_VAZIOS;
  try {
    return { ...REQUISITOS_VAZIOS, ...JSON.parse(json) };
  } catch {
    return REQUISITOS_VAZIOS;
  }
}

/** Etapa 2: extração de requisitos via IA, com revisão editável obrigatória antes de
 * prosseguir — a extração nunca confirma sozinha. */
export function EtapaRequisitos({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [extraindo, setExtraindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  async function extrair() {
    setExtraindo(true);
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudo.id}/requisitos`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível extrair os requisitos.");
        return;
      }
      onUpdated(data.estudo);
    } finally {
      setExtraindo(false);
    }
  }

  if (!estudo.requisitosJson) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted">
          Vamos ler o texto do edital e identificar objeto, critério de julgamento, exigências técnicas, prazos,
          local de entrega, forma de pagamento e garantias.
        </p>
        {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
        <Button onClick={extrair} loading={extraindo} className="mt-4">
          {!extraindo && <Sparkles className="h-4 w-4" />}
          Extrair requisitos com IA
        </Button>
      </div>
    );
  }

  const confirmado = !!estudo.requisitosConfirmadoEm;

  if (confirmado && !editando) {
    return (
      <ResumoRequisitos
        requisitos={parseRequisitos(estudo.requisitosJson)}
        ramo={estudo.ramo}
        onEditar={() => setEditando(true)}
      />
    );
  }

  return (
    <FormularioRequisitos
      estudoId={estudo.id}
      ramo={estudo.ramo}
      requisitos={parseRequisitos(estudo.requisitosJson)}
      onSalvo={(novoEstudo) => {
        onUpdated(novoEstudo);
        setEditando(false);
      }}
      onReextrair={extrair}
      reextraindo={extraindo}
    />
  );
}

function ResumoRequisitos({
  requisitos,
  ramo,
  onEditar,
}: {
  requisitos: RequisitosEstudo;
  ramo: "SERVICO" | "PRODUTO";
  onEditar: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> Requisitos revisados e confirmados
        </span>
        <button onClick={onEditar} className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
          <Pencil className="h-3 w-3" /> Editar novamente
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">Objeto</h4>
          <FonteBadge baseadoEmTextoCompleto={requisitos.baseadoEmTextoCompleto} />
        </div>
        <p className="mt-2 text-sm text-foreground/80">{requisitos.objeto}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Campo label="Critério de julgamento" valor={requisitos.criterioJulgamento} />
        <Campo label="Prazo de execução" valor={requisitos.prazoExecucao} />
        <Campo label="Local de entrega" valor={requisitos.localEntrega} />
        <Campo label="Forma de pagamento" valor={requisitos.formaPagamento} />
        <Campo label="Garantias exigidas" valor={requisitos.garantiasExigidas} />
        {ramo === "PRODUTO" && <Campo label="Prazo de entrega" valor={requisitos.prazoEntrega} />}
      </div>

      {ramo === "SERVICO" ? (
        <div className="grid grid-cols-2 gap-4">
          <ListaCampo label="Equipe mínima" itens={requisitos.equipeMinima} />
          <ListaCampo label="Certificações exigidas" itens={requisitos.certificacoesExigidas} />
        </div>
      ) : (
        <Campo label="Especificação técnica" valor={requisitos.especificacaoTecnica} />
      )}

      <div className="flex justify-end">
        <Button disabled title="Etapa 3 ainda não implementada">
          Continuar para Tributos
        </Button>
      </div>
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{valor || "—"}</p>
    </div>
  );
}

function ListaCampo({ label, itens }: { label: string; itens: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      {itens.length === 0 ? (
        <p className="mt-0.5 text-sm text-foreground">—</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {itens.map((item, i) => (
            <li key={i} className="flex gap-1.5 text-sm text-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormularioRequisitos({
  estudoId,
  ramo,
  requisitos,
  onSalvo,
  onReextrair,
  reextraindo,
}: {
  estudoId: string;
  ramo: "SERVICO" | "PRODUTO";
  requisitos: RequisitosEstudo;
  onSalvo: (estudo: EstudoViabilidadeDetail) => void;
  onReextrair: () => void;
  reextraindo: boolean;
}) {
  const [form, setForm] = useState(requisitos);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function set<K extends keyof RequisitosEstudo>(campo: K, valor: RequisitosEstudo[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  }

  function setLista(campo: "equipeMinima" | "certificacoesExigidas", texto: string) {
    set(
      campo,
      texto
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    );
  }

  async function confirmar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudoId}/requisitos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar os requisitos.");
        return;
      }
      onSalvo(data.estudo);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-warning/10 px-4 py-2.5 text-sm text-warning">
        <span className="font-medium">Revise os dados extraídos pela IA antes de confirmar.</span>
        <button
          onClick={onReextrair}
          disabled={reextraindo}
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline disabled:opacity-60"
        >
          {reextraindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Extrair de novo
        </button>
      </div>

      <Field label="Objeto" htmlFor="objeto">
        <TextArea id="objeto" rows={2} value={form.objeto} onChange={(e) => set("objeto", e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Critério de julgamento" htmlFor="criterioJulgamento">
          <TextInput
            id="criterioJulgamento"
            value={form.criterioJulgamento}
            onChange={(e) => set("criterioJulgamento", e.target.value)}
          />
        </Field>
        <Field label="Prazo de execução" htmlFor="prazoExecucao">
          <TextInput
            id="prazoExecucao"
            value={form.prazoExecucao}
            onChange={(e) => set("prazoExecucao", e.target.value)}
          />
        </Field>
        <Field label="Local de entrega" htmlFor="localEntrega">
          <TextInput id="localEntrega" value={form.localEntrega} onChange={(e) => set("localEntrega", e.target.value)} />
        </Field>
        <Field label="Forma de pagamento" htmlFor="formaPagamento">
          <TextInput
            id="formaPagamento"
            value={form.formaPagamento}
            onChange={(e) => set("formaPagamento", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Garantias exigidas" htmlFor="garantiasExigidas">
        <TextArea
          id="garantiasExigidas"
          rows={2}
          value={form.garantiasExigidas}
          onChange={(e) => set("garantiasExigidas", e.target.value)}
        />
      </Field>

      {ramo === "SERVICO" ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Equipe mínima" htmlFor="equipeMinima" hint="Um item por linha">
            <TextArea
              id="equipeMinima"
              rows={4}
              value={form.equipeMinima.join("\n")}
              onChange={(e) => setLista("equipeMinima", e.target.value)}
            />
          </Field>
          <Field label="Certificações exigidas" htmlFor="certificacoesExigidas" hint="Um item por linha">
            <TextArea
              id="certificacoesExigidas"
              rows={4}
              value={form.certificacoesExigidas.join("\n")}
              onChange={(e) => setLista("certificacoesExigidas", e.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Especificação técnica" htmlFor="especificacaoTecnica">
            <TextArea
              id="especificacaoTecnica"
              rows={3}
              value={form.especificacaoTecnica}
              onChange={(e) => set("especificacaoTecnica", e.target.value)}
            />
          </Field>
          <Field label="Prazo de entrega" htmlFor="prazoEntrega">
            <TextInput id="prazoEntrega" value={form.prazoEntrega} onChange={(e) => set("prazoEntrega", e.target.value)} />
          </Field>
        </div>
      )}

      {erro && <p className="text-xs text-danger">{erro}</p>}

      <div className="flex justify-end">
        <Button onClick={confirmar} loading={salvando}>
          Confirmar e continuar
        </Button>
      </div>
    </div>
  );
}
