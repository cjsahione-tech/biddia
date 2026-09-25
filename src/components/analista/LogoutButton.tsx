"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-danger">
      <LogOut className="h-3.5 w-3.5" /> Sair
    </button>
  );
}
