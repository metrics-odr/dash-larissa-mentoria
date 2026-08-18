# AGENTS.md — Template de dashboard de captura de leads

> Contexto completo em **`CLAUDE.md`** (mesma pasta) — leia-o antes de mexer no
> projeto. Este arquivo é um resumo para agentes/ferramentas que seguem a
> convenção `AGENTS.md`.

## ✅ CHECKLIST DE NOVO CLIENTE (resumo — detalhes em CLAUDE.md)

1. `build/build.py`: `SPREADSHEET_ID`, `GID_LEADS`, `GID_META`, `CLIENT_NAME`,
   `MAIN_PRODUCT`, `MAIN_PRODUCT_PREFIX`, aliases de coluna em `header_index()`,
   `is_qualified()`/`MQL_FATURAMENTO_MIN` (critério de MQL), `TAX_FACTOR`.
   `GID_SALES` só quando houver aba de vendas (ainda não usado em nenhum lugar).
2. `build/app.js`: revisar os rótulos `'MQLs (<<PREENCHER...>>)'` (2 ocorrências)
   e a lista `order` de faixas de faturamento/qualificação — o critério de
   `build.py` não propaga sozinho para esses textos fixos da UI.
3. `build/template.html`: substituir o nome do cliente no `<title>` e no logo
   (2 marcadores `<<PREENCHER>>`).
4. `README.md` / `CLAUDE.md` / `SETUP-CRON.md`: owner/repo do GitHub, URL do
   GitHub Pages, nome do cliente.
5. GitHub Pages + Actions: confirmar que `build/` + `.github/workflows/deploy.yml`
   estão na `main` (ativa `workflow_dispatch`); rodar o workflow uma vez.
6. cron-job.org: seguir `SETUP-CRON.md` — token fine-grained novo (Actions:
   read/write, só neste repo), nunca reaproveitar um token exposto em chat.
7. Aba Relatório / Insights de Tráfego (`build/GUIA-RELATORIOS.md`): ajustar o
   contexto do funil (marcadores `<<PREENCHER>>`); `build/relatorios.json` e
   `build/relatorios_dados.json` começam vazios — preencher manual
   (`gerar_relatorios.py`) ou recriar a Routine do Claude (`create_trigger`)
   apontando para este repo (não vem pronta neste template).
8. Testar local com CSVs de amostra antes de publicar (3 páginas, tema
   claro/escuro, multi-seleção).
9. **Automação de vendas / Worker de IA — ainda não implementados.** Este
   template só cobre mídia paga × Leads (até MQL) e a Routine agendada do
   Claude para os Insights; não há Cloudflare Worker nem chamada paga à API
   Anthropic no pipeline. Se o cliente precisar disso, é desenvolvimento novo.

## Engine (não muda entre clientes)
`build/template.html`, `build/app.js`, `build/estilos.css`,
`.github/workflows/deploy.yml`, `.github/workflows/briefing.yml`,
`build/relatorio_lib.py`, `build/coletar_dados_relatorio.py`,
`build/gerar_relatorios.py`, `GUIA-REPLICACAO.md` — tabelas, filtros,
gráficos, heatmap, tema claro/escuro, coleta/redação dos Insights. Ver
`GUIA-REPLICACAO.md` para os detalhes de implementação (filtro cruzado,
engine de tabela, gráficos Chart.js).

## Específico do cliente (troca a cada replicação)
`build/build.py`, `build/identidade-visual.css` (cores, se o cliente tiver
identidade própria), `build/relatorios.json` + `build/relatorios_dados.json`
(conteúdo — começam vazios), `build/GUIA-RELATORIOS.md` (contexto do funil),
`README.md`, `CLAUDE.md`, `SETUP-CRON.md`.
