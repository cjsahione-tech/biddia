# Bidd.IA — Identidade visual do sistema

Pacote com a identidade visual da plataforma Bidd.IA (GrupoBidd). É **uma identidade única para qualquer tela**: celular, tablet e computador usam as mesmas cores, fontes, peças e regras. Muda só a organização do espaço (veja a seção Responsivo). O site comercial pode ser mais decorativo; o sistema precisa ser limpo, porque o analista lê números, prazos e status durante horas.

Arquivos deste pacote:

- `IDENTIDADE-VISUAL.md`: este guia.
- `tokens.css`: cores (tema claro e escuro), espaços, cantos e sombras prontos para usar.
- `tokens.json`: os mesmos valores em formato de dados.
- `logos/marca-b-branca.png` e `logos/marca-b-indigo.png`: o símbolo "b".
- `INSTRUCOES-APLICAR.md`: o pedido pronto para o Claude Code aplicar tudo.

## Conceito

**Precisão com movimento.** O índigo passa confiança, o âmbar chama a ação e a esteira dos 6 agentes mostra o trabalho andando. O elemento que assina o sistema é a **esteira**: uma linha ligando as etapas Oportunidade, Qualificação, Análise e Proposta.

## Marca

- O símbolo é o "b" do GrupoBidd. Use `marca-b-branca.png` sobre fundos `brand-900` e `brand-600`, e `marca-b-indigo.png` sobre `page` e `surface`. Nunca redesenhe o "b" nem mude as proporções (400:537).
- O nome escreve-se **Bidd.IA**, em Rubik 600. O ".IA" fica em `accent` (âmbar) sobre fundo escuro e em `brand-600` sobre fundo claro.
- O "b" sozinho é o ícone do app, o favicon e o avatar do assistente Bidd.IA no chat (círculo `brand-900` com o "b" branco, a cerca de 55% da altura do círculo).
- Deixe ao redor da marca um espaço livre igual à largura do "b". Sem sombra, contorno ou gradiente.

## Cores

Todas as cores estão em `tokens.css` como variáveis (`var(--brand-600)`). **Nunca escreva um hex solto nos componentes.**

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `page` | `#F1F2FB` | `#0E0D2B` | Fundo da página e das telas do sistema. Cartões ficam em surface. |
| `surface` | `#FFFFFF` | `#1B1950` | Cartões, listas, barra de navegação e campos. Texto ink ou ink-muted por cima. |
| `ink` | `#1E1B4B` | `#F4F5FF` | Texto principal e títulos sobre page e surface. |
| `ink-muted` | `#4B4A7A` | `#B9BBE8` | Texto de apoio (órgão, datas, legendas) sobre page e surface. |
| `border` | `#D5D8F5` | `#34327E` | Divisores e contornos de cartões e campos. |
| `brand-900` | `#312E81` | `#3D3A92` | Cor da marca em superfícies grandes: menu lateral, cartão de destaque, avatar do Bidd.IA. Texto on-brand por cima. |
| `brand-600` | `#4338CA` | `#5B52E8` | Ação principal: botões, aba ativa, links, foco. Texto on-brand por cima. |
| `on-brand` | `#FFFFFF` | `#FFFFFF` | Texto e ícones sobre brand-900 e brand-600. |
| `accent` | `#FBBF24` | `#FBBF24` | Âmbar: um único destaque por tela (Captar agora, número principal). Texto on-accent por cima. |
| `on-accent` | `#1E1B4B` | `#1E1B4B` | Texto sobre accent. |
| `tint` | `#E0E7FF` | `#2A2870` | Fundo de chips e de áreas suaves. Texto tint-ink por cima. |
| `tint-ink` | `#312E81` | `#E0E7FF` | Texto sobre tint. |
| `neutral-bg` | `#E8E9F3` | `#26255E` | Fundo de chips neutros, trilhas de barras e abas inativas. |
| `success-bg` | `#DDF3E7` | `#123B27` | Fundo de status positivo (Habilitada, Leitura completa). |
| `success-ink` | `#14532D` | `#BDEBD0` | Texto sobre success-bg. Sempre acompanhado de palavra ou ícone. |
| `warning-bg` | `#FEF3C7` | `#3F2F08` | Fundo de atenção (Leitura parcial, prazo curto). |
| `warning-ink` | `#92400E` | `#FDE68A` | Texto sobre warning-bg. |
| `danger-bg` | `#FDE4E4` | `#4A1616` | Fundo de erro (Leitura incompleta, Não habilitada). |
| `danger-ink` | `#7F1D1D` | `#FECACA` | Texto sobre danger-bg. |
| `focus-ring` | `#4338CA` | `#A5B4FC` | Anel de foco do teclado, sólido de 2px, 3:1 sobre page e surface. |

Regras de uso:

- `accent` (âmbar) aparece **uma vez por tela**, para a ação ou o número mais importante. Nunca como cor de status.
- Status usam só os pares `success`, `warning` e `danger`, sempre com **palavra ou ícone**. Nunca diferencie verde e vermelho só pela cor.
- Os 6 agentes **não** têm cores próprias: cada um é reconhecido por número, ícone e nome, no mesmo círculo `tint`.

## Tipografia

- Títulos: **Rubik** (500 e 600). Texto: **DM Sans** (400, 500 e 700). Ambas no Google Fonts.
- Estilos: `titulo-1` 32/38 (página no computador), `titulo-2` 24/30 (tela no celular), `titulo-3` 18/24 (cartão), `numero` 30/32 (indicador), `corpo` 15/22, `corpo-forte` 15/22 em 700, `pequeno` 12.5/18, `legenda` 11/16 em 700 com 0,02em de espaçamento.
- Valores em reais e números em coluna usam `font-variant-numeric: tabular-nums`.

## Espaço, forma e profundidade

- Espaços: 4, 8, 12, 16, 18, 24 e 32 px (`space-1` a `space-8`). Margem lateral das telas no celular: 18px. Padding de cartão: 16px. Entre cartões: 12px.
- Cantos: `radius-sm` 10px (chips e selos), `radius-md` 16px (tiles e campos), `radius-lg` 20px (cartões), `radius-pill` 999px (botões, abas e barra de navegação).
- Cartões: `surface` com `shadow-card`. A barra de navegação do celular usa `shadow-nav`.
- Sem vidro fosco, sem gradientes e sem faixa colorida na borda do cartão. A hierarquia vem de tamanho, peso e do âmbar.
- Foco do teclado: anel sólido de 2px em `focus-ring`.

## Componentes

**Botões** (pílula, 44px; 34px no compacto, texto 14px em negrito):

- Principal: fundo `brand-600`, texto `on-brand`. A ação que avança o trabalho (Exportar PDF, Gerar declarações).
- Destaque: fundo `accent`, texto `on-accent`. No máximo um por tela (Captar agora).
- Secundário: fundo `surface`, contorno de 1,5px e texto `brand-600` (Exportar DOCX, Tentar de novo).
- Texto: sem fundo, `brand-600` (Ver relatório →).
- Desativado: fundo `neutral-bg`, texto `ink-muted`; diga o motivo ao lado.

**Selos e chips** (11px, `radius-sm`, ícone + palavra):

- Selos de leitura do Auditor: **Leitura completa** (`success`), **Leitura parcial** (`warning`) e **Leitura incompleta** (`danger`). Com leitura incompleta, nunca mostrar "Habilitada".
- Status da habilitação: **Habilitada**, **Atenção**, **Não habilitada**.
- Informação (UF, tipo, prazo): `tint` com `tint-ink`, ou `neutral-bg` com `ink-muted`. Prazo curto usa `warning`.
- Etapas do funil: pílulas com contagem ("Oportunidade · 12"). A ativa em `brand-600`; as outras em `surface` com `ink-muted`.

**Cartão de edital** (`surface`, `radius-lg`, `shadow-card`, padding 16px), de cima para baixo: chips (UF, tipo e selo de leitura); título em `titulo-3` (até 2 linhas); órgão em `pequeno`, caixa alta, `ink-muted`; linha com valor em `corpo-forte` e prazo em `pequeno` (ambos `tabular-nums`, separados por divisor `border`); anexos; ação em `brand-600`. A ação muda com o selo: leitura incompleta pede "Enviar edital em texto"; os demais pedem "Qualificar".

**Agentes**: número em `legenda` (AGENTE 1 a 6), avatar circular de 44px em `tint` com ícone `tint-ink` de 22px (traço de 2px), nome em `titulo-3` e função em `pequeno`. Ordem: 1 Comercial, 2 Analista, 3 Financeiro, 4 Advogado, 5 Secretário, 6 Auditor.

**Esteira**: etapas Oportunidade (Comercial), Qualificação (Auditor), Análise (Analista e Financeiro) e Proposta (Advogado e Secretário). Concluída: círculo `brand-600` com conector `brand-600`. Atual: círculo `accent`. Futura: `neutral-bg` com conector `border`. Abaixo de cada etapa, a contagem em `numero`.

**Navegação**:

- Celular (até 767px): barra inferior flutuante (`surface`, `radius-pill`, `shadow-nav`, 56px, a 14px das bordas) com 5 itens: Início, Editais, Bidd.IA, Resultados, Mais. O ativo vira pílula `brand-600` com ícone de 18px e rótulo; os demais mostram só o ícone de 22px em `ink-muted`, em `<button>` com `aria-label`. Captação, Documentações, Agenda, Carteira e Plano ficam dentro de **Mais**.
- Tablet e computador (a partir de 768px): menu lateral `brand-900` com os mesmos 5 destinos; o ativo ganha pílula `brand-600`.
- Dentro de um edital, as abas são: Análise, Viabilidade, Financeiro, Advogado, Checklist e Auditoria (pílulas com rolagem horizontal no celular).

**Ícones**: de traço, 2px, pontas arredondadas, na cor do texto (`currentColor`). Sem emoji. Em estado crítico, o ícone sempre vem com uma palavra.

## Responsivo: uma identidade, qualquer tela

Os componentes são os mesmos em todos os tamanhos. O que muda é o encaixe, nunca a cor, a fonte, os cantos ou o tom de voz. Projete primeiro para o celular e amplie.

Pontos de quebra: **celular** até 767px, **tablet** de 768px a 1099px e **computador** a partir de 1100px. Teste sempre em 390px, 820px e 1440px.

| Item | Celular | Tablet | Computador |
|---|---|---|---|
| Navegação | Barra inferior flutuante, 5 itens | Menu lateral `brand-900` de 248px | Menu lateral `brand-900` de 248px |
| Margem lateral (`--gutter`) | 18px | 24px | 32px |
| Largura do conteúdo | 100% | 100% | Até 1200px, centralizado ao lado do menu |
| Cartões de edital | 1 coluna | 2 colunas | 3 colunas (ou 2, se houver painel lateral) |
| Título da tela | `titulo-2` (24px) | `titulo-1` (32px) | `titulo-1` (32px) |
| Abas do edital | Pílulas com rolagem horizontal | Pílulas em linha | Pílulas em linha |
| Tabelas (itens, exigências) | Viram cartões empilhados, um por linha | Tabela | Tabela com cabeçalho fixo |
| Janelas de confirmação e formulários | Painel que sobe da base (bottom sheet) | Janela centralizada de 560px | Janela centralizada de 560px |
| Indicadores do painel | 3 tiles em linha, rolando se faltar espaço | 4 tiles | 4 a 6 tiles |
| Esteira de etapas | Fila de pílulas com contagem no topo | Esteira completa | Esteira completa |

Regras que valem em qualquer tela:

- Áreas de toque de pelo menos 44px (`--touch-min`) em botões, abas e itens de lista. No computador, o mesmo tamanho é mantido; não encolha.
- Efeito de passar o mouse (`hover`) só em telas com mouse (`@media (hover: hover)`). Ele escurece o fundo em um tom, nunca muda de cor.
- Estado de foco do teclado visível em todas as telas (anel `focus-ring`).
- Sem rolagem horizontal na página. Só tabelas largas podem rolar, dentro do próprio bloco.
- Texto nunca menor que 11px, e 15px no corpo de leitura.
- O menu lateral do computador usa os mesmos 5 destinos da barra do celular (Início, Editais, Bidd.IA, Resultados, Mais), com o ativo em pílula `brand-600`. Em Mais ficam Agenda, Documentações, Captação, Carteira, Plano e Conta.

## Tom de voz

Direto, no "você", frases curtas. Diga o que aconteceu e o que fazer.

- Bom: "Não consegui ler o edital (PDF escaneado). Envie uma versão em texto ou clique em Tentar de novo."
- Evitar: "Erro SEM_EXIGENCIAS", "Falha no processamento".
- Botões dizem a ação: "Captar agora", "Gerar declarações", "Exportar PDF".
- Valores: "R$ 41.750,00". Prazos: "7d · 28/10/2026". Agentes sempre com inicial maiúscula.

## Acessibilidade

- Texto com contraste mínimo de 4,5:1 em ambos os temas (os pares deste pacote já cumprem).
- Cores de status sempre com palavra ou ícone.
- Foco de teclado visível, alvos de toque de pelo menos 40px no celular.
