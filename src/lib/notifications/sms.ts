import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  if (!client) client = twilio(sid, token);
  return client;
}

/** Diferente do WhatsApp Cloud API (só template pré-aprovado), SMS aceita texto livre —
 * é o canal usado pro link de redefinição de senha. Número em E.164 sem "+". */
export async function enviarSms(to: string, mensagem: string) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  const c = getClient();
  if (!c || !from) {
    console.warn(`[sms] Twilio não configurado — SMS não enviado (${to}).`);
    return;
  }
  try {
    await c.messages.create({ body: mensagem, from, to: `+${to}` });
  } catch (err) {
    console.error("[sms] Falha ao enviar:", err);
  }
}
