# CLAUDE.md — Contexto do projeto (template)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o repositório.
> Ele carrega TODO o contexto necessário para continuar o trabalho sem depender
> de mensagens anteriores. Mantenha-o atualizado.

## ✅ CHECKLIST DE NOVO CLIENTE

Marque cada item ao configurar este template para um cliente novo. Ordem sugerida:

1. **Planilha de dados** (`build/build.py`):
   - [ ] `SPREADSHEET_ID` — ID da planilha Google Sheets (só leitura, export CSV público).
   - [ ] `GID_LEADS` / `GID_META` — gids das abas de Leads e de mídia paga.
   - [ ] `CLIENT_NAME` / `MAIN_PRODUCT` / `MAIN_PRODUCT_PREFIX` — identificação do
     cliente/oferta (hoje só usados em textos/relatórios).
   - [ ] `GID_SALES` — só quando houver aba de vendas/compradores (ver "Lacunas de
     dados" abaixo); enquanto não houver, deixe o marcador — não é lido em nenhum lugar.
   - [ ] Conferir/ajustar os **aliases de coluna** em `header_index()` (nomes de
     cabeçalho podem variar entre clientes) e o **fallback posicional**.
   - [ ] `is_qualified()` / `MQL_FATURAMENTO_MIN` — critério de MQL do cliente
     (ex.: faturamento ≥ X; pode ser outro critério, não precisa ser faixa de faturamento).
   - [ ] `TAX_FACTOR` — imposto/taxa da conta de mídia (1.0 se não houver).
2. **Regra de qualificação em `app.js`** (o critério em `build.py` **não** propaga
   sozinho para textos fixos da UI): revise os rótulos `'MQLs (<<PREENCHER...>>)'`
   (2 ocorrências, função `renderGeralCore`) e a lista `order` de faixas de
   faturamento/qualificação (mesma função) — ajuste ao critério real do cliente novo.
3. **Branding**: `build/template.html` — troque o nome do cliente no `<title>`
   e no logo da sidebar (2 ocorrências, `<<PREENCHER: nome do cliente>>` /
   `<<PREENCHER: nome do negócio/produto>>`).
4. **Cores** (opcional): `build/identidade-visual.css` — a paleta atual é neutra/
   genérica; troque só se o cliente tiver identidade visual própria.
5. **Nome do projeto/URL** em `README.md`, `CLAUDE.md` (esta seção "O que é",
   abaixo), `AGENTS.md` e `SETUP-CRON.md` — owner/repo do GitHub e URL do GitHub Pages.
6. **GitHub Pages + Actions**:
   - [ ] Confirmar que `build/` + `.github/workflows/deploy.yml` estão na branch `main`
     (o `workflow_dispatch` só existe na branch padrão).
   - [ ] Rodar o workflow uma vez (aba Actions → Run workflow) para o Pages
     habilitar sozinho, ou deixar o cron-job.org disparar a 1ª execução.
7. **cron-job.org** (dispara o build a cada 30 min): siga `SETUP-CRON.md` —
   gerar token fine-grained novo (Actions: read/write, só neste repo), criar o
   job com URL/headers/body do guia (preencha os marcadores com o repo real).
   **Nunca** reutilize um token que já apareceu em texto puro em algum chat/
   documento — revogue e gere outro.
8. **Aba Relatório / Insights de Tráfego** (`build/GUIA-RELATORIOS.md` +
   `build/GUIA-INTERPRETACAO-METRICAS.md`):
   - [ ] Ajustar o contexto do funil (produto/oferta/etapas) no topo do
     `GUIA-RELATORIOS.md` (marcadores `<<PREENCHER>>`).
   - [ ] `build/relatorios.json` e `build/relatorios_dados.json` começam vazios
     (`"periodos": {}`) — preenchidos automaticamente pelo "Briefing automático
     do gestor" (ver seção abaixo) assim que houver dados reais, ou manualmente
     com `build/gerar_relatorios.py`.
   - [ ] Se for usar a Routine do Claude para redigir os Insights: recrie a
     Routine (`create_trigger`, Claude Code Remote) apontando para o **novo
     repo** — não é algo que o `git push` sozinho reativa (ela precisa ser
     criada uma vez por cliente).
9. **Teste local** antes de publicar: `python build/build.py --leads-file
   leads.csv --meta-file meta.csv --out dist/index.html` com CSVs de
   amostra; confira as 3 páginas, tema claro/escuro e a multi-seleção.
10. **Automação de vendas / Worker de IA — ainda não implementados neste
    template.** Este template cobre mídia paga × Leads até MQL (ver "Lacunas de
    dados" abaixo) e a redação dos Insights via Routine do Claude (sem custo de
    API). Não existe, hoje, nenhum Cloudflare Worker nem chamada paga à API da
    Anthropic no pipeline — se o cliente precisar disso (ex.: aba de vendas,
    geração de insights via API em vez de Routine agendada), é **desenvolvimento
    novo**, não um passo de configuração deste checklist.

> Depois de fechar o checklist, apague esta seção ou deixe como referência —
> tanto faz, ela não afeta o build.

---

## O que é

Dashboard de **Captura de Leads** — um app de BI estático (HTML/CSS/JS
puro + Chart.js via CDN) publicado no **GitHub Pages**, que cruza a lista de
**Leads** com o gerenciador de mídia paga e se atualiza sozinho a cada ~30 min
(build 100% na nuvem via GitHub Actions, disparado externamente pelo cron-job.org).

- **URL pública:** `<<PREENCHER: https://<org>.github.io/<repo>/>>`
- **Somente leitura** das planilhas. Nunca escrever de volta.

## Fontes de dados (Google Sheets)

Spreadsheet ID: `<<PREENCHER: ID da planilha>>` (público — leitura via export CSV).

| Aba | gid | Colunas usadas |
|-----|-----|----------------|
| **Leads** (formulário/typeform) | `<<PREENCHER: gid>>` | `<<PREENCHER: nomes reais das colunas da planilha do cliente e o que cada uma mapeia — created/ad_name/adset_name/campaign/platform/profession/faturamento/name/email/phone>>` |
| **Meta Ads** | `<<PREENCHER: gid>>` | `Day` · `Campaign Name` · `Ad Set Name` · `Ad Name` · `Amount Spent` · `Impressions` · `Link Clicks` · `Leads` · `Creative Instagram Permalink`(link do criativo, opcional) |

URL de export CSV: `https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>`

### Regra de Lead Qualificado (MQL)
`<<PREENCHER: critério de qualificação do cliente novo — ex. faturamento médio
mensal ≥ R$ X, coluna "..." da aba Leads, faixas no formato "Entre R$X e R$Y" /
"Menos de R$X" / "Mais de R$X">>`. Lógica em `build.py` → `is_qualified`
(limiar `MQL_FATURAMENTO_MIN`); rótulos/ordem de faixas espelhados em `app.js`
(`order` em `renderGeralCore`).

### Imposto da mídia paga
`TAX_FACTOR` em `build.py` — `<<PREENCHER: imposto/taxa real da conta de mídia
do cliente, ou deixe 1.0 se não houver>>`. O toggle "Imposto Meta" fica
**ativo por padrão** (`STATE.tax=true` em `app.js`) e aplica o fator em todo
o gasto/derivados (CPL, CPMQL, CAC etc.); desativar o toggle volta ao gasto
sem imposto.

### Convenções de campanha (do cliente)
`<<PREENCHER: sigla/nome do funil e padrão de nomenclatura das campanhas do
cliente novo, ex. "SIGLA | <etapa> | <público> | <objetivo> | <estratégia> |
<data> | <teste>">>`. `utm_content` = nome do anúncio (deve bater com `Ad Name`
do Meta Ads). `utm_campaign` = `Campaign Name` do Meta Ads. `utm_medium` é
usado como conjunto (adset) — confira se a nomenclatura do cliente bate com
`Ad Set Name` do Meta; se não bater 100%, o cruzamento por Conjunto pode ficar
levemente impreciso até o cliente padronizar.

## Arquitetura / arquivos

```
build/build.py            # lê os 2 CSVs (read-only), emite REGISTROS BRUTOS (leads[]/meta[]/ad_links); render() COSTURA os 4 arquivos abaixo
build/template.html       # esqueleto HTML. Placeholders __STYLES__, __APP_JS__, __DATA_JSON__, __BUILD_ID__, __GENERATED_BRT__
build/identidade-visual.css  # TODAS as cores (tema claro=padrão / escuro). Mexa AQUI p/ trocar só cor
build/estilos.css         # layout/componentes (sidebar, topbar, period-picker, funil, tabelas, gráficos, aba Relatório)
build/app.js              # lógica + renderização (KPIs, funil, tabelas, filtro cruzado, period-picker, heatmap, Relatório)
build/relatorios.json     # Insights de Tráfego por período (aba Relatório) — VERSIONADO; lido no build, sem API. Vazio no template.
build/relatorios_dados.json      # números brutos por período (insumo p/ a Routine escrever relatorios.json) — não lido pelo site. Vazio no template.
build/relatorio_lib.py           # datas/agregação compartilhadas (gerar_relatorios.py + coletar_dados_relatorio.py)
build/coletar_dados_relatorio.py # gera relatorios_dados.json (só números, sem texto) — roda no briefing.yml, 1x/dia
build/gerar_relatorios.py        # gera relatorios.json determinístico (sem IA) — fallback MANUAL, não roda mais sozinho
build/GUIA-RELATORIOS.md            # formato/estrutura dos Insights da aba Relatório (os 7 blocos) — contexto do funil com marcadores <<PREENCHER>>
build/GUIA-INTERPRETACAO-METRICAS.md # regras de diagnóstico por métrica (High Ticket) — leitura obrigatória p/ redigir
.github/workflows/deploy.yml    # roda build.py e publica no Pages (workflow_dispatch + schedule + push)
.github/workflows/briefing.yml  # roda coletar_dados_relatorio.py e commita relatorios_dados.json na main (cron 1x/dia, 23h50 BRT)
dist/index.html           # saída gerada (gitignored; o Actions reconstrói)
GUIA-REPLICACAO.md        # como replicar este modelo para outros relatórios/clientes
SETUP-CRON.md             # valores exatos do cron-job.org (com marcadores a preencher)
```

### Aba Relatório
Terceira página (sidebar, entre a de mídia paga e o rodapé). **Espelha a Visão
Geral** (mesmo funil/KPIs/gráficos/tabela diária, via `renderGeralCore(REL_IDS)`)
e, abaixo, acrescenta 3 blocos novos + um painel de metas editável:
- **Metas & parâmetros (painel editável)** — no topo da aba: Meta CPMQL, Meta CAC, Volume
  mínimo amostral (MQLs), N dias p/ corte. Persiste em `localStorage['dm_metas']`, default de
  `build.py` (`META_CPMQL`/`META_CAC`=None → "não definida"; `VOLUME_MIN_AMOSTRAL`/`N_DIAS_CORTE`).
  Editar recolore **CPMQL/CAC** nas tabelas de anúncio (verde ≤ meta · amarelo até +30% ·
  vermelho acima) e ajusta o badge Em observação/Avaliável (usa o volume mínimo), **tudo ao vivo**
  (`METAS` + `renderRelAds()` em `app.js`, sem re-render dos gráficos).
- **Top Anúncios** e **Piores Anúncios** — 23 colunas + coluna **Status** (Anúncio · Status ·
  Campanha · Conjunto · Gasto · Impr · CPM · CTR · Leads · CPL · MQLs · Tx‑MQL · CPMQL · Agendamentos ·
  Tx‑Agend. · CPAG · Reuniões · No‑Show · CPRR · Vendas · CAC · Faturamento · ROAS · **Link**). Anúncio,
  Status e Link ficam **sticky** (visíveis sem rolar). Ranking pelo **resultado mais profundo
  disponível** (Venda→Reunião Realizada→Agendamento→MQL), amostra relevante primeiro; sem amostra → badge
  **"Em observação"** (nunca "vencedor"/"ruim" por 1 resultado ou por CTR/CPM/CPL isolados).
  Limiares em `build.py`: `SAMPLE_MIN_SPEND`, `SAMPLE_MIN_MQLS`, `TOP_ADS_N`. Scroll lateral
  **contido na tabela** (`.rel-adt` → `table-layout:auto`).
- **Insights de Tráfego** — texto por período redigido pelo **Claude** (linguagem de
  gestor de tráfego, profundo mas sem enrolação), lido de `build/relatorios.json`
  (sem API no build/navegador — o site só exibe o texto já pronto). Formato em **4
  quadrantes** por período: 1) Resumo executivo + **nota de saúde do funil (0–10)**
  + bloco pronto para copiar no WhatsApp; 2) Diagnóstico do funil (comparação com
  período anterior, gargalos, hipóteses); 3) Campanhas/estruturas/anúncios campeões
  (estrutura completa campanha→conjunto→anúncio, criativos em múltiplas estruturas
  analisados por ocorrência); 4) Ações priorizadas (Fazer hoje/Escalar/Manter/
  Observar/Otimizar/Cortar/Produzir/Evitar/Próxima revisão). Cada período compara
  com o período anterior **correto para aquela janela** (regra em
  `relatorio_lib.previous_period` — ex.: "mês" vs. mesmo intervalo de dias do mês
  anterior, "máximo" vs. metade antiga do histórico, nunca período inventado).
  Chaves de período fixas (`hoje/ontem/3d/7d/14d/30d/mes/mespass/todo`), tags
  `Escalar/Otimizar/Cortar/Observar`. Toda a aritmética (totais, variações %/pp,
  nota de saúde, ranking, formatação do bloco WhatsApp) é pré-calculada em
  `build/relatorios_dados.json` — a Routine só interpreta, nunca recalcula (economia
  de tokens). Regras completas em `build/GUIA-RELATORIOS.md` (formato/schema) +
  `build/GUIA-INTERPRETACAO-METRICAS.md` (diagnóstico por métrica + ABO/CBO + unidade
  de análise do anúncio). Ver "Briefing automático do gestor" abaixo. `app.js` ainda
  reconhece o formato antigo (`{"html": "…"}`) como fallback até a próxima geração real.

### Briefing automático do gestor (Routine do Claude, sem chamada à API Anthropic)
`build/relatorios.json` é escrito 1×/dia às **23:59 BRT** por uma **Routine do
Claude** (Claude Code Remote — mesma infraestrutura de sessão/agente deste
repo, agendada; não é uma chamada paga à API Anthropic). Fluxo em 2 etapas,
porque o ambiente da Routine não alcança `docs.google.com` (só o runner do
GitHub Actions alcança — ver item 4 de "Publicação" abaixo):
1. `build/coletar_dados_relatorio.py` (GitHub Actions, `.github/workflows/briefing.yml`,
   1×/dia 23h50 BRT) agrega **só números** (totais, comparativos 7/14/30d + período
   anterior, quebra por campanha/conjunto/anúncio com série diária) em
   `build/relatorios_dados.json` e commita na `main`.
2. A Routine do Claude (23h59 BRT) lê esse JSON + `build/GUIA-RELATORIOS.md` +
   `build/GUIA-INTERPRETACAO-METRICAS.md`, redige `build/relatorios.json` (os 7
   blocos, aplicando diagnóstico probabilístico — nunca métrica isolada) e faz
   commit/push direto na `main`, disparando o `deploy.yml` (reage a `build/**`)
   e republicando o dashboard. **Precisa ser recriada por cliente**
   (`create_trigger` apontando para o repo novo) — não vem pronta neste template.

`build/gerar_relatorios.py` (gerador determinístico mais raso, sem IA) continua
no repo só como **fallback manual** — não roda mais automaticamente; rode-o à
mão se a Routine falhar num dia. Limitação conhecida (herdada por ambos os
scripts): usam `META_CPMQL`/`META_CAC`/`VOLUME_MIN_AMOSTRAL`/`N_DIAS_CORTE` de
`build.py` (defaults), não o que o gestor editou no painel da aba Relatório
(fica em `localStorage` do navegador — o build server-side não enxerga);
ajuste os defaults em `build.py` se quiser metas fixas refletidas no texto.

Funil completo (venda 1:1 por reunião, se for o caso do cliente): `Impressões → Cliques → Leads →
MQLs → Agendamentos → Reuniões Realizadas → Vendas → Faturamento`. Enquanto só houver mídia
paga × Leads, o funil vai até MQL; Agendamentos/Reuniões Realizadas/Vendas/Fat aparecem "-" até
chegar a lista do comercial — quando os campos `agendamentos`/`reunioes`/`vendas`/`fat` forem
somados em `buildAgg/daily/totals`, `salesOf()` acende tudo sozinho.

### Link do criativo (aba de mídia paga)
`build.py` lê uma coluna opcional de permalink do criativo na aba de mídia →
mapa `ad_links` (anúncio → 1 permalink). Usado no "Link" das tabelas Top/Piores
(abre em nova aba). Sem a coluna, o link vira "—".

> **Layout modular:** o front-end é separado em `identidade-visual.css` + `estilos.css`
> + `app.js`, costurados por `render()` nos placeholders `__STYLES__`/`__APP_JS__`.
> Página 1 usa **funil vertical de leads** (Gasto → Impressões → Cliques → Leads →
> MQLs → Vendas/Faturamento "-") + KPIs secundários. Topbar tem **seletor de período
> em calendário** (period-picker). **Heatmap** das tabelas diárias = cor FIXA por
> métrica (só opacidade varia): **Gasto=vermelho · Leads=azul · MQLs=verde**
> (`--heat-gasto/leads/mqls`), aplicado só nessas 3 colunas.

O `build.py` **não agrega**: exporta as linhas cruas e TODA a lógica (filtros de
data, filtro cruzado, KPIs, tabelas, gráficos, heatmap, imposto) roda no navegador.
Isso permite interatividade total sem servidor.

## Rodar/testar local

```bash
python build/build.py --leads-file leads.csv --meta-file meta.csv --out dist/index.html
# (o sandbox do agente NÃO alcança docs.google.com; use CSVs locais para testar.
#  O runner do GitHub Actions tem internet e busca os CSVs ao vivo.)
```
Para conferir o visual sem depender do CDN: baixe `chart.js@4.4.1` do npm, troque a
`<script src=...>` por um caminho local e rode um screenshot com Chromium headless.

## Especificação funcional (resumo)

Três **páginas separadas** (sidebar, sem rolar entre elas):
1. **Visão Geral de Leads** — **funil vertical** (Gasto → Impressões → Cliques → Leads →
   MQLs → Vendas/Faturamento = "-", com CPM/CTR/CPC/CPL/ConvForm/Tx‑MQL/CPMQL inline) +
   **KPIs secundários**; gráfico combinado diário colado à **tabela diária com
   heatmap (todos os leads)**; barras por origem/faixa/plataforma/profissão.
2. **Captura mídia paga** — funil em etapas; combinado diário; barras por utm_content;
   **tabela diária com heatmap (só mídia paga)**; **3 tabelas hierárquicas** Campanha →
   Conjunto → Anúncio, cada uma com **gráfico de linha colado embaixo**.
3. **Relatório** — espelha a Visão Geral e acrescenta **painel de Metas editável** +
   **Top Anúncios · Piores Anúncios** (22 colunas + Status, com link do criativo) +
   **Insights de Tráfego** (texto de `relatorios.json`, foco em ação). Ver seção
   "Aba Relatório" acima e `build/GUIA-RELATORIOS.md`.

**Ordem das colunas nas tabelas de heatmap/hierarquia:**
`Data · Dia · Gasto · CPM · CTR · ConvForm(=Leads/Cliques) · Leads · CPL · Tx‑MQL · MQLs · CPMQL`
(nas hierárquicas a 1ª coluna é a dimensão em vez de Data/Dia).

**Regras obrigatórias das tabelas** (ver `GUIA-REPLICACAO.md`): cabeçalho sticky;
ordenação tri‑state (asc→desc→reset); colunas redimensionáveis (persist localStorage);
linha "Total Geral" fixa; dimensão nunca truncada (400/250/600px, wrap, ≥11px);
seleção com toggle + **Ctrl multi (Set/OR)**; **filtro cruzado bidirecional** com
âncora Anúncio>Conjunto>Campanha, reconstruindo tudo da fonte filtrada; tabela diária
com **último dia no topo**. **Heatmap de cor fixa por métrica** (só a opacidade varia,
maior valor = mais vibrante), aplicado apenas em **Gasto (vermelho) · Leads (azul) ·
MQLs (verde)** — cores em `--heat-gasto/leads/mqls`. As demais colunas ficam sem heatmap.

## Lacunas de dados (comuns até o cliente enviar mais fontes)
- **Vendas, Faturamento, ROAS, CAC** → precisam de uma aba de compradores (`GID_SALES`
  em `build.py`, ainda não usado), com utm_source/produto.
- **Page Views, CR, CPV, ConvLP** → precisam de uma fonte de page views.
- Enquanto não vierem, essas métricas aparecem como "-".

## Publicação — como resolver os problemas conhecidos

1. **Push:** se a integração GitHub da sessão for somente‑leitura (`git push` e as
   MCP tools derem 403 "Resource not accessible by integration"), o caminho que
   funciona é `git push` direto para `github.com` usando o **PAT do usuário** (o
   proxy permite o túnel git bruto; a API REST do Actions/Pages costuma ser
   bloqueada). Nunca gravar o token no `.git/config` (usar URL efêmera
   `https://x-access-token:<TOKEN>@github.com/...`).
2. **cron-job.org só funciona na `main`:** `workflow_dispatch` só existe quando o
   workflow está na branch padrão. Levar `build/` + `.github/workflows/deploy.yml` para
   a `main` para ativar.
3. **Pages liga sozinho:** `actions/configure-pages@v5` com `enablement: true`
   habilita o Pages na 1ª execução (precisa `permissions: pages: write, id-token: write`).
4. **Proxy do sandbox:** o ambiente do agente costuma NÃO alcançar `docs.google.com`,
   `*.github.io` nem a API REST de Actions/Pages — mas o runner do GitHub Actions
   alcança tudo. Testar dados via CSV local; confiar no Actions para o resto.
5. **Token exposto:** se um token/PAT foi colado no chat, avisar para **revogar e
   gerar um novo** (fine‑grained, só Actions: read/write neste repo).

## Branch / git
- `<<PREENCHER: branch de trabalho, se houver>>`; manter sincronizada com `main`.
