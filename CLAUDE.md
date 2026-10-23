@AGENTS.md

## Identidade visual (valem para QUALQUER tela: celular, tablet e computador)

Uma identidade única e responsiva. Guia completo: `docs/identidade-visual/IDENTIDADE-VISUAL.md`. Valores: `src/styles/tokens.css`
(fonte única), ligados ao Tailwind em `src/app/globals.css`. Peças prontas: `src/components/ui/`.

**Regras**
- Nunca escrever um hex solto nem uma cor "de catálogo" do Tailwind (`blue-500`) em componente. Use as variáveis/classes da
  identidade: `bg-page`, `bg-surface`, `text-ink`, `text-ink-muted`, `border-border`, `bg-brand-600`, `bg-brand-900`,
  `text-on-brand`, `bg-accent`/`text-on-accent`, `bg-tint`/`text-tint-ink`, `bg-neutral-bg`, e os pares de status
  `bg-success-bg text-success-ink`, `bg-warning-bg text-warning-ink`, `bg-danger-bg text-danger-ink`.
  (Nomes antigos ainda valem: `foreground`=ink, `muted`=ink-muted, `background`=page, `brand`=brand-600, `brand-light`=tint.)
  Única exceção: cores de CATEGORIA que o usuário escolhe nos cards do Kanban e a paleta de categorias dos gráficos.
- O âmbar (`accent`) aparece **uma vez por tela** (a ação ou o número mais importante); nunca como cor de status.
- Status sempre com **palavra ou ícone**, nunca só cor. Com leitura incompleta, nunca mostrar "Habilitada".
- Os 6 agentes não têm cor própria: número, ícone e nome, no mesmo círculo `tint`.
- Cartão = `rounded-card bg-surface shadow-card` (sem borda, sem gradiente, sem vidro fosco, sem faixa colorida na borda).
  Cantos: `rounded-chip` (10), `rounded-tile` (16), `rounded-card` (20), `rounded-pill` (botões, abas, barra).
- Fontes: Rubik nos títulos (`font-display`, `h1`–`h4` já usam) e DM Sans no texto. Estilos: `tipo-titulo-pagina`, `tipo-titulo-1/2/3`,
  `tipo-numero`, `tipo-corpo`, `tipo-corpo-forte`, `tipo-pequeno`, `tipo-legenda`. Valores e números em coluna: `tabular-nums`.
- Responsivo, projetando primeiro para o celular: celular até 767px, tablet 768–1099px (`md:`), computador a partir de 1100px (`lg:`).
  Testar em 390, 820 e 1440px. Sem rolagem horizontal na página (só tabelas largas, dentro do próprio bloco).
- Áreas de toque de pelo menos 44px (`min-h-11`). `hover` só em telas com mouse (`@media (hover: hover)` / `hover-hover:`).
  Foco de teclado sempre visível (já global: anel `focus-ring`).
- Texto nunca menor que 11px; 15px no corpo de leitura. Tom de voz: direto, "você", diz o que aconteceu e o que fazer.
- Navegação: barra inferior flutuante no celular, menu lateral `brand-900` (248px) a partir de 768px, com os mesmos 5 destinos
  (Início, Editais, Bidd.IA, Resultados, Mais). Estrutura da página: componente `PaginaConteudo`/`AppShell`.
- Tema escuro: pronto em `tokens.css` mas **desligado** (só com `data-theme="dark"` no `<html>`). Antes de ligar, revisar as telas.
- Selo de leitura (`SeloLeitura`): componente visual com 3 estados (completa, parcial, incompleta), **sem ligação** com as regras de
  auditoria nem com o banco — quem liga é o dono do projeto.

**Cuidado ao mudar só o visual:** não mexer em banco, Prisma, agentes de IA, captação, regras de negócio, segurança ou RLS. Mantenha
funções e textos; se algo exigir mudar além do visual, pare e pergunte.

**Ao ajustar os tokens:** `--radius-*` e `--shadow-*` do guia se chamam aqui `--r-*` e `--sh-*` (colidiam com o Tailwind); as fontes
vêm do `next/font` (`layout.tsx`), não do `tokens.css`.
