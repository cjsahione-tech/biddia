import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

// Só leitura — o catálogo de Feature é fixo no seed (prisma/seed.mjs), sem CRUD pela
// interface. Usado pra montar os checkboxes agrupados por categoria em /admin/planos.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const features = await prisma.feature.findMany({ orderBy: { ordemExibicao: "asc" } });
  return NextResponse.json({ features });
}
