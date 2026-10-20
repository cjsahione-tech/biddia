"use client";

import { createContext, useContext } from "react";

// Dados do usuário que o AppShell já tem e as telas de celular reaproveitam (cumprimento, sino, avatar).
export type DadosShell = {
  userName: string;
  companyName: string;
  totalNotificacoes: number;
  isAdmin: boolean;
  operandoComoAnalista: boolean;
};

const ShellContext = createContext<DadosShell>({
  userName: "",
  companyName: "",
  totalNotificacoes: 0,
  isAdmin: false,
  operandoComoAnalista: false,
});

export const ShellProvider = ShellContext.Provider;

export function useShell(): DadosShell {
  return useContext(ShellContext);
}
