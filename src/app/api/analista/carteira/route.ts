import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAnalista } from "@/lib/analista";
import { companySchemaCliente } from "@/app/api/company/route";
import { nomeSegmentoLicitaNet } from "@/lib/licitanet-segmentos";
import { camposPendentes } from "@/lib/empresa-pendencias";
import { resumoCobranca } from "@/lib/cobranca-carteira";
import { iniciarCaptacao } from "@/lib/captacao";

// Cadastrar o cliente já dispara a primeira busca de editais em segundo plano.
export const maxDuration = 60;

/** Planos que o Analista pode escolher para um cliente: só os do público "Empresas do analista
 * de licitação" e ativos, criados em /admin/planos. */
async function planosParaClientes() {
  return prisma.plan.findMany({
    where: { publicoAlvo: "EMPRESA_ANALISTA", ativo: true },
    orderBy: [{ ordemExibicao: "asc" }, { precoMensal: "asc" }],
    select: { id: true, nome: true, precoMensal: true },
  });
}

export async function GET() {
  const { user, error } = await requireAnalista();
  if (error) return error;

  const [vinculos, plano, planosDisponiveis] = await Promise.all([
    prisma.analistaCliente.findMany({
      where: { analistaId: user!.id },
      include: {
        periodosCobranca: { select: { inicio: true, fim: true } },
        company: {
          select: {
            id: true,
            razaoSocial: true,
            cnpj: true,
            cidade: true,
            uf: true,
            objetoSocial: true,
            logradouro: true,
            numero: true,
            bairro: true,
            cep: true,
            banco: true,
            agencia: true,
            conta: true,
            socioNome: true,
            socioCpf: true,
            licitanetSegmentoId: true,
            plan: { select: { id: true, nome: true, precoMensal: true } },
            // Só pra saber se tem logo — o conteúdo (data URL) é grande e não precisa viajar.
            logoUrl: true,
            _count: { select: { keywords: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    user!.planId ? prisma.plan.findUnique({ where: { id: user!.planId } }) : null,
    planosParaClientes(),
  ]);

  const carteira = vinculos.map((v) => {
    const { logoUrl, _count, ...resto } = v.company;
    return {
      id: v.id,
      companyId: v.companyId,
      ativo: v.ativo,
      desativadoEm: v.desativadoEm,
      createdAt: v.createdAt,
      company: {
        id: resto.id,
        razaoSocial: resto.razaoSocial,
        cnpj: resto.cnpj,
        cidade: resto.cidade,
        uf: resto.uf,
      },
      pendencias: camposPendentes({ ...resto, logoUrl, totalKeywords: _count.keywords }),
      plano: v.company.plan,
    };
  });

  // "Plano mensal" de cada cliente: o valor do plano (criado no Admin, público "Empresas do
  // analista de licitação") é cobrado mensalmente direto do cliente. Cliente sem plano = 0.
  const cobranca = resumoCobranca(
    vinculos.map((v) => ({ id: v.id, valorMensal: v.company.plan?.precoMensal ?? 0, periodos: v.periodosCobranca }))
  );

  return NextResponse.json({
    carteira,
    plano: plano ? { nome: plano.nome, maxEmpresas: plano.maxEmpresas, precoMensal: plano.precoMensal } : null,
    planosDisponiveis,
    cobranca: {
      clientesAtivos: cobranca.clientesAtivos,
      totalMensalCheio: cobranca.totalMensalCheio,
      faturaPrevistaDoMes: cobranca.faturaPrevistaDoMes,
      mes: cobranca.mesCorrente.mes,
      ano: cobranca.mesCorrente.ano,
    },
  });
}

// Só razão social, CNPJ, e-mail e senha do cliente são obrigatórios — o resto (endereço,
// dados bancários, responsável legal, objeto social, logo, busca) pode ser completado depois.
// Os campos de busca (keywords, segmento LicitaNet) valem já, para o Agente Comercial começar.
const criarClienteSchema = companySchemaCliente.extend({
  emailCliente: z.string().email("E-mail do cliente inválido"),
  senhaCliente: z.string().min(8, "A senha do cliente deve ter ao menos 8 caracteres"),
  // "Plano mensal" do cliente (substitui o antigo campo livre de tarifa, que o analista
  // preenchia com qualquer valor). Obrigatório quando já existe algum plano para escolher.
  planId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const { user, error } = await requireAnalista();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = criarClienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  // Teto de carteira do plano do Analista — conta só clientes ATIVOS. Nunca bloqueia
  // silenciosamente: mensagem clara oferecendo upgrade.
  const plano = user!.planId ? await prisma.plan.findUnique({ where: { id: user!.planId } }) : null;
  if (plano?.maxEmpresas != null) {
    const atual = await prisma.analistaCliente.count({ where: { analistaId: user!.id, ativo: true } });
    if (atual >= plano.maxEmpresas) {
      return NextResponse.json(
        { error: `Sua carteira já está no limite de ${plano.maxEmpresas} cliente(s) do plano ${plano.nome}. Faça upgrade para adicionar mais.` },
        { status: 409 }
      );
    }
  }

  const { emailCliente, senhaCliente, keywords, licitanetSegmentoId, planId, ...d } = parsed.data;

  // O plano precisa ser um dos planos "Empresas do analista de licitação" ativos — nunca um
  // plano qualquer informado pelo navegador.
  const disponiveis = await planosParaClientes();
  if (disponiveis.length > 0 && !planId) {
    return NextResponse.json({ error: "Escolha o plano mensal do cliente" }, { status: 400 });
  }
  if (planId && !disponiveis.some((p) => p.id === planId)) {
    return NextResponse.json({ error: "Plano mensal inválido ou indisponível" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: emailCliente } });
  if (existing) {
    return NextResponse.json({ error: "Já existe uma conta com este e-mail" }, { status: 409 });
  }

  let segmento: { licitanetSegmentoId: number | null; licitanetSegmentoNome: string | null } | undefined;
  if (licitanetSegmentoId != null) {
    const nome = nomeSegmentoLicitaNet(licitanetSegmentoId);
    if (!nome) return NextResponse.json({ error: "Segmento LicitaNet inválido" }, { status: 400 });
    segmento = { licitanetSegmentoId, licitanetSegmentoNome: nome };
  }

  const termos = Array.from(new Set((keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean)));
  const passwordHash = await bcrypt.hash(senhaCliente, 10);

  const { company } = await prisma.$transaction(async (tx) => {
    const clienteUser = await tx.user.create({
      data: { name: d.razaoSocial, email: emailCliente, passwordHash, tipoConta: "EMPRESA" },
    });
    const company = await tx.company.create({
      data: {
        ...d,
        // Colunas obrigatórias do banco: o que o Analista deixou em branco fica "" e aparece
        // como pendente na carteira e na tela Empresa do cliente.
        objetoSocial: d.objetoSocial ?? "",
        logradouro: d.logradouro ?? "",
        numero: d.numero ?? "",
        bairro: d.bairro ?? "",
        cidade: d.cidade ?? "",
        uf: (d.uf ?? "").toUpperCase(),
        cep: d.cep ?? "",
        banco: d.banco ?? "",
        agencia: d.agencia ?? "",
        conta: d.conta ?? "",
        socioNome: d.socioNome ?? "",
        socioCpf: d.socioCpf ?? "",
        ...segmento,
        ...(planId ? { planId } : {}),
        atendeServico: d.atendeServico ?? true,
        atendeBem: d.atendeBem ?? true,
        userId: clienteUser.id,
        keywords: { create: termos.map((term) => ({ term })) },
      },
    });
    const vinculo = await tx.analistaCliente.create({
      data: { analistaId: user!.id, companyId: company.id },
    });
    // Começa a contar a cobrança adicional deste cliente hoje.
    await tx.periodoCobrancaCliente.create({ data: { analistaClienteId: vinculo.id, inicio: new Date() } });
    return { company };
  });

  // Com palavra-chave ou segmento informados, o Agente Comercial já começa a buscar editais
  // agora, sem nenhuma configuração extra. Falha aqui não desfaz o cadastro — a busca
  // agendada pega o cliente de qualquer forma.
  let buscaIniciada = false;
  if (termos.length > 0 || segmento) {
    try {
      await iniciarCaptacao(company.id, new URL(req.url).origin);
      buscaIniciada = true;
    } catch (err) {
      console.error(`Não foi possível iniciar a busca inicial do cliente ${company.id}:`, err);
    }
  }

  return NextResponse.json({ company: { id: company.id, razaoSocial: company.razaoSocial }, buscaIniciada });
}
