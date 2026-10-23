import { BarChart3, Home, Inbox, Menu, MessageSquare, ShieldCheck, type LucideIcon } from "lucide-react";

// Os 5 destinos da identidade, iguais no celular (barra inferior) e no tablet/computador (menu lateral):
// Início, Editais, Bidd.IA, Resultados e Mais. "Mais" fica ativo em tudo o que não é um dos quatro primeiros
// (Agenda, Documentos, Captação, Plano, Estudo de Viabilidade, Empresa, Notificações, Admin...).
export type ItemNavegacao = { href: string; label: string; icon: LucideIcon; ativo: (pathname: string) => boolean };

const PRINCIPAIS = ["/dashboard", "/editais", "/bidd-ia", "/resultados"];

export const ITENS_NAVEGACAO: ItemNavegacao[] = [
  { href: "/dashboard", label: "Início", icon: Home, ativo: (p) => p === "/dashboard" },
  { href: "/editais", label: "Editais", icon: Inbox, ativo: (p) => p === "/editais" || p.startsWith("/editais/") },
  { href: "/bidd-ia", label: "Bidd.IA", icon: MessageSquare, ativo: (p) => p === "/bidd-ia" },
  { href: "/resultados", label: "Resultados", icon: BarChart3, ativo: (p) => p === "/resultados" },
  { href: "/mais", label: "Mais", icon: Menu, ativo: (p) => !PRINCIPAIS.some((b) => p === b || p.startsWith(b + "/")) },
];

// Conta de administração sem empresa: nenhuma das telas comuns funciona, só o Admin.
export const ITENS_NAVEGACAO_ADMIN: ItemNavegacao[] = [{ href: "/admin/usuarios", label: "Admin", icon: ShieldCheck, ativo: () => true }];
