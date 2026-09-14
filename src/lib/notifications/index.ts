import { enviarEmail } from "@/lib/notifications/email";
import { enviarWhatsapp } from "@/lib/notifications/whatsapp";

// Nomes dos templates aprovados no WhatsApp Manager — configuráveis por env var porque a
// Meta pode exigir renomear/recriar um template durante o processo de aprovação.
const TEMPLATE_NOVOS_EDITAIS = process.env.WHATSAPP_TEMPLATE_NOVOS_EDITAIS ?? "bidd_novos_editais";
const TEMPLATE_PRAZO_VENCENDO = process.env.WHATSAPP_TEMPLATE_PRAZO_VENCENDO ?? "bidd_prazo_vencendo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://licitax.vercel.app";

type Destinatario = { email: string; whatsapp: string | null; razaoSocial: string };

export async function notificarNovosEditais(destinatario: Destinatario, quantidade: number) {
  const { email, whatsapp, razaoSocial } = destinatario;
  await Promise.all([
    enviarEmail({
      to: email,
      subject: `${quantidade} novo(s) edital(is) encontrado(s) para ${razaoSocial}`,
      html: `
        <p>Olá,</p>
        <p>O Agente Comercial encontrou <strong>${quantidade} novo(s) edital(is)</strong> compatível(is) com o perfil da ${razaoSocial}.</p>
        <p><a href="${APP_URL}/dashboard">Acessar o painel</a></p>
      `,
    }),
    whatsapp
      ? enviarWhatsapp({ to: whatsapp, templateName: TEMPLATE_NOVOS_EDITAIS, params: [String(quantidade), razaoSocial] })
      : Promise.resolve(),
  ]);
}

export async function notificarPrazosVencendo(
  destinatario: Destinatario,
  itens: { documentoNome: string; editalTitulo: string; diasRestantes: number }[]
) {
  const { email, whatsapp, razaoSocial } = destinatario;
  const linhas = itens
    .map(
      (i) =>
        `<li>${i.documentoNome} (${i.editalTitulo}) — ${
          i.diasRestantes < 0 ? "vencido" : `vence em ${i.diasRestantes} dia(s)`
        }</li>`
    )
    .join("");
  await Promise.all([
    enviarEmail({
      to: email,
      subject: `${itens.length} documento(s) com prazo próximo — ${razaoSocial}`,
      html: `
        <p>Olá,</p>
        <p>Os documentos abaixo estão com prazo de validade próximo ou já vencido:</p>
        <ul>${linhas}</ul>
        <p><a href="${APP_URL}/notificacoes">Ver detalhes</a></p>
      `,
    }),
    whatsapp
      ? enviarWhatsapp({
          to: whatsapp,
          templateName: TEMPLATE_PRAZO_VENCENDO,
          params: [String(itens.length), razaoSocial],
        })
      : Promise.resolve(),
  ]);
}
