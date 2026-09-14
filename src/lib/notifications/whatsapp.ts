const WHATSAPP_API_VERSION = "v21.0";

// Mensagens iniciadas pela plataforma (fora da janela de 24h de conversa) só podem usar
// um template de mensagem pré-aprovado pela Meta — texto livre é rejeitado pela API.
export async function enviarWhatsapp({
  to,
  templateName,
  params,
}: {
  to: string;
  templateName: string;
  params: string[];
}) {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.warn(`[whatsapp] WhatsApp Cloud API não configurada — mensagem não enviada (${to}): ${templateName}`);
    return;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "pt_BR" },
          components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }],
        },
      }),
    });
    if (!res.ok) console.error("[whatsapp] Falha ao enviar:", await res.text());
  } catch (err) {
    console.error("[whatsapp] Falha ao enviar:", err);
  }
}
