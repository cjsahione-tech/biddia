"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  Calculator,
  Calendar,
  ChevronRight,
  FileStack,
  Gauge,
  LogOut,
  Radar,
  ShieldCheck,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Cartao } from "@/components/ui/Cartao";
import { Chip } from "@/components/ui/Chip";
import { PaginaConteudo } from "@/components/ui/PaginaConteudo";
import { useShell } from "@/components/shell/ShellContext";
import { iniciais, primeiroNome } from "@/lib/mobile-util";

type Atalho = { href: string; titulo: string; descricao: string; icon: LucideIcon; selo?: number };

/** Tela "Mais": tudo o que não cabe nos 4 primeiros destinos do menu (celular, tablet e computador). */
export function MaisClient() {
  const router = useRouter();
  const { userName, companyName, isAdmin, operandoComoAnalista, totalNotificacoes } = useShell();
  const [saindo, setSaindo] = useState(false);
  const [voltando, setVoltando] = useState(false);

  const atalhos: Atalho[] = [
    { href: "/agenda", titulo: "Agenda", descricao: "Sessões e prazos da semana", icon: Calendar },
    { href: "/documentos", titulo: "Documentações", descricao: "Certidões, atestados e validades", icon: FileStack },
    { href: "/captacao", titulo: "Captação", descricao: "Fontes e palavras-chave", icon: Radar },
    { href: "/plano", titulo: "Plano e consumo", descricao: "Uso dos agentes no mês", icon: Gauge },
    { href: "/estudo-viabilidade", titulo: "Estudo de Viabilidade", descricao: "Custos, tributos e margem", icon: Calculator },
    { href: "/notificacoes", titulo: "Notificações", descricao: "Avisos e prazos", icon: Bell, selo: totalNotificacoes },
    { href: "/empresa", titulo: "Conta e perfil", descricao: "Dados da empresa e de acesso", icon: Building2 },
    ...(isAdmin ? [{ href: "/admin/usuarios", titulo: "Administração", descricao: "Usuários, planos e saúde", icon: ShieldCheck }] : []),
  ];

  async function sair() {
    setSaindo(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function voltarParaCarteira() {
    setVoltando(true);
    try {
      await fetch("/api/analista/voltar", { method: "POST" });
      router.push("/carteira");
      router.refresh();
    } finally {
      setVoltando(false);
    }
  }

  return (
    <PaginaConteudo titulo="Mais" subtitulo="Tudo o que a plataforma oferece">
      <Cartao className="flex items-center gap-3">
        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-on-brand">{iniciais(userName)}</div>
        <div className="min-w-0">
          <p className="tipo-corpo-forte truncate text-ink">{primeiroNome(userName)}</p>
          <p className="tipo-pequeno truncate text-ink-muted">{operandoComoAnalista ? `Analista · operando como ${companyName}` : companyName}</p>
        </div>
      </Cartao>

      {operandoComoAnalista && (
        <button
          onClick={voltarParaCarteira}
          disabled={voltando}
          className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-card bg-brand-900 p-4 text-left text-on-brand disabled:opacity-70"
        >
          <Users className="h-5 w-5 flex-none text-accent" />
          <span className="flex-1">
            <span className="tipo-corpo-forte block">Carteira de clientes</span>
            <span className="tipo-pequeno block text-on-brand/80">Voltar para a minha carteira de empresas</span>
          </span>
          <Undo2 className="h-4 w-4" />
        </button>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {atalhos.map((a) => (
          <Link key={a.href} href={a.href} className="flex min-h-[72px] items-center gap-3 rounded-card bg-surface p-4 shadow-card transition hover:bg-tint">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-tint text-tint-ink">
              <a.icon className="h-[22px] w-[22px]" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="tipo-corpo-forte block text-ink">{a.titulo}</span>
              <span className="tipo-pequeno block truncate text-ink-muted">{a.descricao}</span>
            </span>
            {!!a.selo && <Chip tom="erro">{a.selo}</Chip>}
            <ChevronRight className="h-4 w-4 flex-none text-ink-muted" />
          </Link>
        ))}
      </div>

      <div className="mt-4">
        <Button variant="secondary" onClick={sair} loading={saindo} className="w-full md:w-auto">
          {!saindo && <LogOut className="h-4 w-4" />}
          Sair
        </Button>
      </div>
    </PaginaConteudo>
  );
}
