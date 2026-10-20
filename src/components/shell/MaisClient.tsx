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
  Loader2,
  LogOut,
  Radar,
  ShieldCheck,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { CabecalhoMobile } from "@/components/shell/CabecalhoMobile";
import { useShell } from "@/components/shell/ShellContext";
import { iniciais, primeiroNome } from "@/lib/mobile-util";

type Atalho = { href: string; titulo: string; descricao: string; icon: LucideIcon; selo?: number };

/** Tela "Mais" do celular: tudo o que não cabe na barra inferior. */
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
    <div className="px-4 pt-5 md:px-8 md:pt-8">
      <CabecalhoMobile titulo="Mais" subtitulo="Tudo o que a plataforma oferece" />
      <h1 className="hidden text-2xl font-semibold text-foreground md:block">Mais</h1>

      <div className="mt-4 flex items-center gap-3 rounded-[22px] bg-white p-4">
        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand text-lg font-bold text-white">{iniciais(userName)}</div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-foreground">{primeiroNome(userName)}</p>
          <p className="truncate text-xs text-muted">{operandoComoAnalista ? `Analista · operando como ${companyName}` : companyName}</p>
        </div>
      </div>

      {operandoComoAnalista && (
        <button
          onClick={voltarParaCarteira}
          disabled={voltando}
          className="mt-2.5 flex w-full items-center gap-3 rounded-[22px] bg-[#312e81] p-4 text-left text-white"
        >
          <Users className="h-5 w-5 flex-none text-[#fbbf24]" />
          <span className="flex-1">
            <span className="block text-sm font-bold">Carteira de clientes</span>
            <span className="block text-xs text-[#c7d2fe]">Voltar para a minha carteira de empresas</span>
          </span>
          {voltando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
        </button>
      )}

      <div className="mt-2.5 overflow-hidden rounded-[22px] bg-white">
        {atalhos.map((a, i) => (
          <Link key={a.href} href={a.href} className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-[#ecedf8]" : ""}`}>
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-brand-light text-[#312e81]">
              <a.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-foreground">{a.titulo}</span>
              <span className="block truncate text-xs text-muted">{a.descricao}</span>
            </span>
            {!!a.selo && <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{a.selo}</span>}
            <ChevronRight className="h-4 w-4 flex-none text-[#8f8fb5]" />
          </Link>
        ))}
      </div>

      <button
        onClick={sair}
        disabled={saindo}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[22px] bg-white py-3.5 text-sm font-bold text-danger"
      >
        {saindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        Sair
      </button>
    </div>
  );
}
