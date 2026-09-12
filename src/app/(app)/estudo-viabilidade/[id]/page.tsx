import { EstudoDetailClient } from "@/components/estudo-viabilidade/EstudoDetailClient";

export default async function EstudoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EstudoDetailClient estudoId={id} />;
}
