import { Resend } from "resend";

// Sem RESEND_API_KEY configurada (ainda não integrado), o e-mail só fica registrado no
// log em vez de falhar a execução do cron — assim a busca/alertas continuam funcionando
// mesmo antes da conta do Resend estar pronta.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function enviarEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY não configurada — e-mail não enviado (${to}): ${subject}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Bidd.IA <onboarding@resend.dev>",
      to,
      subject,
      html,
    });
    if (error) console.error("[email] Falha ao enviar via Resend:", error);
  } catch (err) {
    console.error("[email] Falha ao enviar via Resend:", err);
  }
}
