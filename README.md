# Dashboard de Captura de Leads · Mentoria Versalhes

Dashboard **100% na nuvem** que cruza a lista de **Leads** (Funil de High
Ticket — Aplicação Direta BR/Mundo e Diagnóstico) com o investimento de mídia
paga (**Meta Ads**) e as vendas (**Compradores**), calcula os **Leads
Qualificados** e é publicada no **GitHub Pages**. Reconstrói sozinha a cada
~30 min, disparada pelo **cron-job.org** — sem depender de nenhum PC ligado.

**URL pública:** `https://metrics-odr.github.io/dash-larissa-mentoria/`

---

## O que ela mostra

- **KPIs**: Gasto Total, Leads Totais, CPL, **MQLs** (critério do cliente), CPMQL, Tx-MQL, Impressões, Cliques, CTR, CPC, CPM.
- **Evolução diária**: gasto/dia, leads × MQLs/dia, CPL × CPMQL/dia.
- **Qualificação & origem**: leads por faixa/critério (qualificado destacado), por origem (mídia paga vs. orgânico), por profissão e por plataforma.
- **Cruzamento por campanha**: gasto (mídia paga) × leads/MQLs (lista) → CPL, CPMQL e Tx-MQL calculados.
- **Tabela de leads qualificados** (e-mail e telefone **mascarados**, pois a página é pública).
- **Toggle de imposto da mídia paga** (opcional) e **modo claro/escuro**.
- **Aba Relatório**: painel de metas editável + Top/Piores Anúncios + Insights de Tráfego (texto, preenchido manualmente ou por automação própria — ver `build/GUIA-RELATORIOS.md`).

## Critério de Lead Qualificado (MQL)

Coluna "Qualificação" == "QLF" **ou** coluna "score" == 10 (aba Leads). Lógica
em `build.py` → `is_qualified`.

## Fontes de dados (somente leitura)

Planilha central `Larissa | Planilha Central`
(`1P7c_7rutl0fdnqIc2DX5DuGl6H9E7WRU_gzDpOdphkw`):

| Aba | gid | Uso |
|-----|-----|-----|
| Leads | `258602723` | leads reais + Qualificação/score → MQL, funil/temperatura |
| Meta Ads | `0` | gasto, impressões, cliques |
| Compradores | `179764332` | vendas/faturamento/caixa, cruzadas com Leads por e-mail |

O build lê essas abas via **export CSV público** (`.../export?format=csv&gid=...`).
**Nada é escrito de volta** nas planilhas.

---

## Arquitetura

```
cron-job.org  ──(POST workflow_dispatch a cada 30 min)──▶  GitHub Actions
                                                              │
                          build/build.py  lê os 2 CSVs ◀──────┘
                                 │  cruza dados + calcula MQLs
                                 ▼
                          dist/index.html  ──▶  deploy  ──▶  GitHub Pages (URL pública)
```

- `build/build.py` — baixa os CSVs, cruza os dados, gera `dist/index.html`.
- `build/template.html` — layout/gráficos/tema (Chart.js via CDN).
- `.github/workflows/deploy.yml` — roda o build e publica no Pages.

**Cache-bust:** a página usa `Cache-Control: no-cache`, mostra o horário do último
build, tem botão **Atualizar** e se recarrega sozinha (`?t=timestamp`) ~30 min após
aberta — sempre pegando a versão mais nova.

## Rodar localmente (opcional)

```bash
python build/build.py --out dist/index.html            # busca os CSVs ao vivo
# ou, com arquivos locais para teste:
python build/build.py --leads-file leads.csv --meta-file meta.csv --sales-file compradores.csv --out dist/index.html
```

---

## Ativação (uma vez) e cron-job.org

O disparo por `workflow_dispatch` só funciona quando o workflow está na branch
**`main`**. Veja **`SETUP-CRON.md`** para o passo a passo e os valores exatos
(URL, headers e body, com marcadores a preencher) a colar no cron-job.org.

> ⚠️ **Segurança:** nunca comite tokens no repositório. Gere um token
> *fine-grained*, só com **Actions: read/write** neste repositório, e use-o
> apenas no cron-job.org (ou em GitHub Secrets, se aplicável).

## Como usar este template para um novo cliente

Veja o **checklist de novo cliente** no topo de `CLAUDE.md` (ou `AGENTS.md`) e
o passo a passo completo em `GUIA-REPLICACAO.md`.
