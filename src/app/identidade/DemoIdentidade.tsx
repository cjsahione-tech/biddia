"use client";

import { useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { Abas } from "@/components/ui/Abas";
import { AGENTES, AvatarAgente, CartaoAgente } from "@/components/ui/AvatarAgente";
import { Button } from "@/components/ui/Button";
import { Cartao } from "@/components/ui/Cartao";
import { Chip } from "@/components/ui/Chip";
import { Esteira } from "@/components/ui/Esteira";
import { Janela } from "@/components/ui/Janela";
import { Logo, AvatarBidd } from "@/components/ui/Marca";
import { PaginaConteudo } from "@/components/ui/PaginaConteudo";
import { SeloLeitura } from "@/components/ui/SeloLeitura";
import { TabelaResponsiva } from "@/components/ui/TabelaResponsiva";

const CORES = [
  ["page", "bg-page"], ["surface", "bg-surface"], ["ink", "bg-ink"], ["ink-muted", "bg-ink-muted"], ["border", "bg-border"],
  ["brand-900", "bg-brand-900"], ["brand-600", "bg-brand-600"], ["accent", "bg-accent"], ["tint", "bg-tint"], ["neutral-bg", "bg-neutral-bg"],
  ["success-bg", "bg-success-bg"], ["success-ink", "bg-success-ink"], ["warning-bg", "bg-warning-bg"], ["warning-ink", "bg-warning-ink"],
  ["danger-bg", "bg-danger-bg"], ["danger-ink", "bg-danger-ink"],
];

const ITENS = [
  { id: "1", descricao: "Caneta esferográfica azul, caixa com 50", unidade: "cx", quantidade: 120, valor: 41.5 },
  { id: "2", descricao: "Papel sulfite A4 75g, resma 500 folhas", unidade: "resma", quantidade: 800, valor: 24.9 },
  { id: "3", descricao: "Grampeador de mesa, capacidade 25 folhas", unidade: "un", quantidade: 35, valor: 63.75 },
];
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="tipo-titulo-2 text-ink">{titulo}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function DemoIdentidade() {
  const [aba, setAba] = useState("analise");
  const [etapa, setEtapa] = useState("OPORTUNIDADE");
  const [janela, setJanela] = useState(false);

  return (
    <PaginaConteudo
      titulo="Identidade visual Bidd.IA"
      subtitulo="Todas as peças, nos três tamanhos. Esta página existe só na prévia."
      acoes={<Button variant="destaque"><Search className="h-4 w-4" /> Captar agora</Button>}
    >
      <Secao titulo="Marca">
        <div className="grid gap-3 md:grid-cols-3">
          <Cartao className="flex items-center justify-center"><Logo sobre="claro" /></Cartao>
          <div className="flex items-center justify-center rounded-card bg-brand-900 p-4"><Logo sobre="escuro" /></div>
          <Cartao className="flex items-center justify-center gap-3"><AvatarBidd tamanho={44} /><span className="tipo-pequeno text-ink-muted">Avatar do assistente</span></Cartao>
        </div>
      </Secao>

      <Secao titulo="Cores">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {CORES.map(([nome, classe]) => (
            <div key={nome} className="rounded-tile bg-surface p-2 shadow-card">
              <div className={`h-10 rounded-chip border border-border ${classe}`} />
              <p className="tipo-pequeno mt-1.5 text-ink">{nome}</p>
            </div>
          ))}
        </div>
      </Secao>

      <Secao titulo="Tipografia">
        <Cartao className="space-y-1">
          <p className="tipo-titulo-1 text-ink">Título 1 — 32/38 Rubik 600</p>
          <p className="tipo-titulo-2 text-ink">Título 2 — 24/30 Rubik 600</p>
          <p className="tipo-titulo-3 text-ink">Título 3 — 18/24 Rubik 600</p>
          <p className="tipo-numero text-ink">R$ 41.750,00</p>
          <p className="tipo-corpo text-ink">Corpo — 15/22 DM Sans. O analista lê números, prazos e status durante horas.</p>
          <p className="tipo-corpo-forte text-ink">Corpo forte — 15/22 em 700</p>
          <p className="tipo-pequeno text-ink-muted">Pequeno — 12,5/18 (órgão, datas e apoio)</p>
          <p className="tipo-legenda text-ink-muted">LEGENDA — 11/16 EM 700</p>
        </Cartao>
      </Secao>

      <Secao titulo="Botões">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Exportar PDF</Button>
          <Button variant="destaque">Captar agora</Button>
          <Button variant="secondary">Exportar DOCX</Button>
          <Button variant="ghost">Ver relatório →</Button>
          <Button disabled>Desativado</Button>
          <Button variant="danger">Excluir</Button>
          <Button size="compacto">Compacto</Button>
          <Button loading>Carregando</Button>
        </div>
      </Secao>

      <Secao titulo="Chips e selos">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>SP</Chip>
          <Chip tom="neutro">Pregão eletrônico</Chip>
          <Chip tom="atencao" icone={AlertTriangle}>Encerra em 2 dias</Chip>
          <Chip tom="sucesso">Habilitada</Chip>
          <Chip tom="atencao">Atenção</Chip>
          <Chip tom="erro">Não habilitada</Chip>
          <SeloLeitura estado="completa" />
          <SeloLeitura estado="parcial" />
          <SeloLeitura estado="incompleta" />
        </div>
      </Secao>

      <Secao titulo="Cartão e abas">
        <Abas itens={[{ chave: "analise", rotulo: "Análise" }, { chave: "viabilidade", rotulo: "Viabilidade" }, { chave: "financeiro", rotulo: "Financeiro" }, { chave: "advogado", rotulo: "Advogado" }, { chave: "checklist", rotulo: "Checklist" }, { chave: "auditoria", rotulo: "Auditoria" }]} ativa={aba} onChange={setAba} rotuloAcessivel="Abas do edital" />
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Cartao key={i}>
              <div className="flex flex-wrap gap-2"><Chip>SP</Chip><Chip tom="neutro">Pregão</Chip><SeloLeitura estado={i === 1 ? "completa" : i === 2 ? "parcial" : "incompleta"} /></div>
              <p className="tipo-titulo-3 mt-2 line-clamp-2 text-ink">Aquisição de materiais de escritório para as secretarias municipais</p>
              <p className="tipo-pequeno mt-1 uppercase text-ink-muted">Prefeitura de Campinas</p>
              <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                <span className="tipo-corpo-forte tabular-nums text-ink">R$ 41.750,00</span>
                <span className="tipo-pequeno tabular-nums text-ink-muted">7d · 28/10/2026</span>
              </div>
              <div className="mt-3"><Button variant="ghost" size="compacto" className="-ml-3">{i === 3 ? "Enviar edital em texto" : "Qualificar"} →</Button></div>
            </Cartao>
          ))}
        </div>
      </Secao>

      <Secao titulo="Agentes">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTES.map((a) => <CartaoAgente key={a.numero} numero={a.numero} />)}
        </div>
        <div className="mt-3 flex gap-2">{AGENTES.map((a) => <AvatarAgente key={a.numero} numero={a.numero} />)}</div>
      </Secao>

      <Secao titulo="Esteira de etapas">
        <Abas
          variante="etapas"
          itens={[{ chave: "OPORTUNIDADE", rotulo: "Oportunidade", contagem: 12 }, { chave: "QUALIFICACAO", rotulo: "Qualificação", contagem: 4 }, { chave: "ANALISE", rotulo: "Análise", contagem: 3 }, { chave: "PROPOSTA", rotulo: "Proposta", contagem: 1 }]}
          ativa={etapa}
          onChange={setEtapa}
          className="mb-4"
        />
        <Cartao>
          <Esteira
            atual={1}
            etapas={[
              { chave: "o", rotulo: "Oportunidade", agentes: "Comercial", contagem: 12 },
              { chave: "q", rotulo: "Qualificação", agentes: "Auditor", contagem: 4 },
              { chave: "a", rotulo: "Análise", agentes: "Analista e Financeiro", contagem: 3 },
              { chave: "p", rotulo: "Proposta", agentes: "Advogado e Secretário", contagem: 1 },
            ]}
          />
        </Cartao>
      </Secao>

      <Secao titulo="Tabela (vira cartões no celular)">
        <TabelaResponsiva
          chaveDaLinha={(l) => l.id}
          linhas={ITENS}
          colunas={[
            { chave: "d", rotulo: "Descrição", titulo: true, render: (l) => l.descricao },
            { chave: "u", rotulo: "Unid.", render: (l) => l.unidade },
            { chave: "q", rotulo: "Quantidade", alinhar: "dir", render: (l) => l.quantidade },
            { chave: "v", rotulo: "Valor unitário", alinhar: "dir", render: (l) => brl(l.valor) },
            { chave: "t", rotulo: "Total", alinhar: "dir", render: (l) => brl(l.quantidade * l.valor) },
          ]}
        />
      </Secao>

      <Secao titulo="Janela (sobe da base no celular)">
        <Button variant="secondary" onClick={() => setJanela(true)}>Abrir janela</Button>
        <Janela
          aberta={janela}
          onFechar={() => setJanela(false)}
          titulo="Mover para Qualificação?"
          descricao="Os agentes vão analisar o edital e a auditoria começa em seguida — isso usa IA."
          rodape={
            <>
              <Button variant="secondary" onClick={() => setJanela(false)}>Cancelar</Button>
              <Button onClick={() => setJanela(false)}>Qualificar</Button>
            </>
          }
        >
          <p className="text-ink">Pregão Eletrônico nº 12/2026 — aquisição de materiais de escritório.</p>
        </Janela>
      </Secao>
    </PaginaConteudo>
  );
}
