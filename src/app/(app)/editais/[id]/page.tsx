import { EditalDetailClient } from "@/components/editais/EditalDetailClient";

export default async function EditalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditalDetailClient editalId={id} />;
}
