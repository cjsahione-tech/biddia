import { NextResponse } from "next/server";
import { emailsAdmin, requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { custoPorModeloUsd } from "@/lib/habilitacao";
import { calcularFinanceiro, inicioDoMesBrasilia, somarTotais, type StatusAssinatura } from "@/lib/admin-usuarios";

// Aba "Usuários" do /admin: todas as contas da plataforma, com plano, valor, custo de IA do mês, lucro e status.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const inicioMes = inicioDoMesBrasilia();
  // Desde quando o consumo é medido por chamada; antes disso, o custo de IA só existe dentro de cada auditoria.
  const inicioDaMedicao = (await prisma.consumoIA.aggregate({ _min: { createdAt: true } }))._min.createdAt ?? new Date();

  const [usuarios, consumo, auditoriasAntigas] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        tipoConta: true,
        createdAt: true,
        statusAssinatura: true,
        statusAssinaturaAtualizadoEm: true,
        valorMensalPersonalizado: true,
        emTesteAte: true,
        plan: { select: { id: true, nome: true, precoMensal: true } },
        _count: { select: { carteiraClientes: true } },
        company: {
          select: {
            id: true,
            razaoSocial: true,
            cnpj: true,
            plan: { select: { id: true, nome: true, precoMensal: true } },
            analistaCliente: { select: { ativo: true, analista: { select: { name: true, email: true } } } },
            _count: { select: { editais: true, documentos: true } },
          },
        },
      },
    }),
    prisma.consumoIA.groupBy({
      by: ["companyId", "modelo"],
      where: { createdAt: { gte: inicioMes }, companyId: { not: null } },
      _sum: { entrada: true, saida: true },
    }),
    // Auditorias de antes de a medição por chamada existir: o custo delas ficou só na própria auditoria.
    // (Depois disso o gasto delas já entra no consumo por chamada — não somar de novo.)
    prisma.$queryRaw<{ companyId: string; usd: number }[]>`
      SELECT e."companyId" AS "companyId", COALESCE(SUM(a."custoUsd"), 0)::float AS usd
      FROM "AuditoriaHabilitacao" a JOIN "Edital" e ON e.id = a."editalId"
      WHERE a."iniciadaEm" >= ${inicioMes}
        AND a."iniciadaEm" < ${inicioDaMedicao}
      GROUP BY e."companyId"`,
  ]);

  const custoUsdPorEmpresa = new Map<string, number>();
  for (const c of consumo) {
    if (!c.companyId) continue;
    custoUsdPorEmpresa.set(c.companyId, (custoUsdPorEmpresa.get(c.companyId) ?? 0) + custoPorModeloUsd(c.modelo, c._sum.entrada ?? 0, c._sum.saida ?? 0));
  }
  for (const a of auditoriasAntigas) custoUsdPorEmpresa.set(a.companyId, (custoUsdPorEmpresa.get(a.companyId) ?? 0) + a.usd);

  const admins = emailsAdmin();
  const linhas = usuarios.map((u) => {
    // Empresa usa o plano da Company; Analista (sem empresa) usa o plano do próprio usuário.
    const plano = u.company?.plan ?? u.plan ?? null;
    const status = u.statusAssinatura as StatusAssinatura;
    const fin = calcularFinanceiro({
      precoPlano: plano?.precoMensal ?? null,
      valorPersonalizado: u.valorMensalPersonalizado,
      status,
      custoUsd: u.company ? (custoUsdPorEmpresa.get(u.company.id) ?? 0) : 0,
    });
    return {
      id: u.id,
      nome: u.name,
      email: u.email,
      tipoConta: u.tipoConta,
      criadoEm: u.createdAt.toISOString(),
      ehAdmin: admins.includes(u.email.trim().toLowerCase()),
      empresa: u.company ? { razaoSocial: u.company.razaoSocial, cnpj: u.company.cnpj, editais: u.company._count.editais, documentos: u.company._count.documentos } : null,
      clienteDe: u.company?.analistaCliente ? { nome: u.company.analistaCliente.analista.name, email: u.company.analistaCliente.analista.email, ativo: u.company.analistaCliente.ativo } : null,
      clientesNaCarteira: u._count.carteiraClientes,
      plano: plano ? { id: plano.id, nome: plano.nome, precoMensal: plano.precoMensal } : null,
      status,
      statusAtualizadoEm: u.statusAssinaturaAtualizadoEm?.toISOString() ?? null,
      emTesteAte: u.emTesteAte?.toISOString() ?? null,
      valorPersonalizado: u.valorMensalPersonalizado,
      valorMensal: fin.valorMensal,
      receitaMes: fin.receita,
      custoMesBrl: fin.custoBrl,
      lucroMes: fin.lucro,
    };
  });

  const totais = somarTotais(linhas.map((l) => ({ status: l.status, valorMensal: l.valorMensal, receita: l.receitaMes, custoBrl: l.custoMesBrl, lucro: l.lucroMes })));
  return NextResponse.json({ usuarios: linhas, totais });
}
