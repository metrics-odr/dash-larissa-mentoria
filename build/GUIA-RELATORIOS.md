# GUIA — Insights de Tráfego da aba Relatório

> Texto lido de `build/relatorios.json` pela aba **Relatório** (seção "Insights
> de Tráfego"). **Não faz nenhuma chamada de API no build nem no navegador** —
> a página só exibe o texto já pronto. Os números vêm dos mesmos dados do site
> (mídia paga × Leads); quem escreve o texto (hoje, uma Routine do Claude —
> ver seção abaixo) apenas **interpreta e redige**.
> A aba Relatório espelha a Visão Geral e, abaixo, mostra **Top Anúncios ·
> Piores Anúncios · Insights de Tráfego**.
>
> **Este guia define o FORMATO/estrutura do texto.** As regras de
> **diagnóstico** (como interpretar cada métrica, quando um número ruim não é
> problema, o que analisar junto do quê) estão em
> `build/GUIA-INTERPRETACAO-METRICAS.md` — leitura obrigatória antes de
> redigir qualquer período.

## Como `build/relatorios.json` é gerado (pipeline atual: Routine do Claude)

`build/relatorios.json` é escrito 1×/dia às **23:59 BRT** por uma **Routine
do Claude** (Claude Code Remote), não por uma chamada à API da Anthropic —
é a mesma infraestrutura de sessão/agente usada neste repositório, só
agendada. O fluxo tem 2 etapas, porque o ambiente onde a Routine roda não
alcança `docs.google.com` (só o runner do GitHub Actions alcança):

1. **Coleta de números (determinística, GitHub Actions)** —
   `build/coletar_dados_relatorio.py` lê os CSVs (mídia paga × Leads) e
   agrega **só aritmética** em `build/relatorios_dados.json`, por período:
   totais, **nota de saúde do funil já calculada** (`nota_saude`, mesma
   metodologia de `relatorio_lib.funnel_health`), **comparação com o período
   anterior correto para cada janela** (`comparativos.periodo_anterior` — ver
   §7), variação métrica a métrica já filtrada por relevância
   (`comparativos.periodo_anterior.variacao`, só marca `material:true` acima
   dos limiares), quebra por campanha/conjunto/**ocorrência de anúncio**
   (`por_anuncio`, chave campanha+conjunto+anúncio) com série diária, visão
   **consolidada por criativo** (`criativos_consolidado` — mesmo anúncio em
   várias estruturas) e os **números já formatados do bloco WhatsApp**
   (`whatsapp_numeros`). Roda via `.github/workflows/briefing.yml` (1×/dia,
   23:50 BRT, + `workflow_dispatch` manual) e commita direto na `main`.
   **Não é lido pelo site** — é só insumo intermediário, mas faz TODA a
   aritmética pesada para a Routine não precisar recalcular nada (ver §
   "Economia de tokens" abaixo).
2. **Redação dos Insights (Claude, Routine agendada)** — 9 minutos depois,
   uma sessão do Claude lê `build/relatorios_dados.json` (números e nota de
   saúde JÁ CALCULADOS — a sessão não deve recalcular soma/média/variação,
   só interpretar) + `build/GUIA-RELATORIOS.md` (este arquivo, formato) +
   `build/GUIA-INTERPRETACAO-METRICAS.md` (diagnóstico por métrica) e escreve
   `build/relatorios.json` no **formato de 4 quadrantes** descrito abaixo,
   fazendo commit/push direto na `main` — o que dispara o `deploy.yml` e
   republica o dashboard. **Uma única leitura dos 3 documentos cobre os 9
   períodos** (não releia os guias por período — a estrutura de
   `relatorios_dados.json` já separa tudo por `periodos.<chave>`).

Testar a coleta de números manualmente:

```bash
python build/coletar_dados_relatorio.py --leads-file leads.csv --meta-file meta.csv --out build/relatorios_dados.json
```

`build/gerar_relatorios.py` (o gerador **determinístico**, sem IA, mais raso)
continua no repo como **fallback manual** — não roda mais automaticamente.
Se a Routine falhar num dia, rode-o pra garantir que a aba não fique vazia:

```bash
python build/gerar_relatorios.py --leads-file leads.csv --meta-file meta.csv --out build/relatorios.json
```

`build/relatorios.json` também pode ser editado à mão seguindo o mesmo
formato — o build só lê o arquivo, não importa como foi gerado. Se o arquivo
não existir ou vier vazio, a aba mostra tudo (cards/tabelas/gráficos) menos
os Insights.

## Contexto do funil

**Funil de High Ticket** — Mentoria Versalhes (Larissa Topper). Três funis de
captura cruzados no mesmo dashboard (filtro por dropdown): **APD-BR**
(Aplicação Direta nacional), **APD-MUNDO** (Aplicação Direta internacional) e
**DIAG** (Diagnóstico). Venda 1:1 por reunião: o anúncio no Meta Ads leva a um
formulário de aplicação (Typeform) que pergunta renda/momento profissional/
disposição a investir; o formulário calcula um `score` e a equipe marca
"Qualificação" = QLF/DSQ. Lead qualificado agenda uma call com o comercial;
se fechar, a venda é registrada na aba Compradores (cruzada por e-mail).

```
Impressões → Cliques/abertura do formulário → Leads → MQLs (Score 10 ou QLF) → Agendamentos → Vendas → Faturamento
```

- **MQL** = coluna "Qualificação" == "QLF" **ou** coluna "score" == 10 (aba
  Leads) — ver `build.py` → `is_qualified`.
- **Agendamento** = coluna "Status da resposta" == "scheduled" (aba Leads).
- **Reunião Realizada** = ainda não tem fonte própria na planilha (aparece
  como "-"); "Venda" já é o resultado mais profundo disponível hoje.
- **Venda/Faturamento/Receita (Caixa)** = aba Compradores, cruzada por e-mail
  (fallback telefone) com o lead mais antigo daquele contato (primeiro
  toque) — ver `build.py` → `join_sales`. "Faturamento" = valor total do
  contrato ("faturamentoVenda"); "Receita (Caixa)" = valor efetivamente
  recebido ("caixaVenda") — cada um com seu próprio ROAS/Ticket Médio.

> **Campanhas fora dos 3 funis** (aquecimento, vendas, engajamento — ex. C1,
> C2, CDR, YAY) são descartadas do dashboard inteiro (não entram nem no
> Acumulado Total). Ver `build.py` → `classify_funil`.

## Fórmulas fundamentais

- **Tx MQL** = MQLs ÷ Leads · **CPMQL** = Investimento ÷ MQLs
- **Tx Agendamento** = Agendamentos ÷ MQLs · **CPAG** = Investimento ÷ Agendamentos
- **Tx NS** = No-Shows÷ Agendamentos · **CPNS** = Investimento ÷ No-Shows
- **No‑Show** = 1 − (Reuniões Realizadas ÷ Agendamentos) · **CPRR** = Investimento ÷ Reuniões Realizadas
- **Tx Venda** = Vendas ÷ Reuniões Realizadas · **CAC** = Investimento ÷ Vendas
- **ROAS** = Faturamento ÷ Investimento · **Ticket** = Faturamento ÷ Vendas
- Conversões acumuladas úteis: Lead→Agendamento, Lead→Reunião Realizada, Lead→Venda,
  MQL→Reunião Realizada, MQL→Venda, Agendamento→Venda.

Regra de ouro: **acumulativas somam** (impressões, cliques, leads, MQLs, gasto);
**derivadas recalculam dos totais** (nunca some percentuais).

## Princípio de interpretação

Trate cada métrica como **diagnóstico probabilístico**, nunca regra absoluta.
Uma métrica ruim raramente identifica sozinha a causa. Leia **sempre** com a etapa
anterior e a posterior, o histórico, o **volume da amostra** e o **tempo de
maturação**. O objetivo não é o menor CPL nem o maior volume de leads — é gerar
leads qualificados que avancem no funil até a venda.

**CPMQL, CPAG, CPRR, CAC e ROAS são resultados acumulados (efeito), não causas.**
Ao ver um deles ruim, aponte a **etapa** que perdeu eficiência — não recomende
"reduzir o CAC/CPRR/ROAS" de forma abstrata.

### Leitura por etapa (resumo)
- **CTR** (Cliques/Impressões): interesse do criativo. CTR baixo **pode ser bom**
  se qualifica melhor (CPMQL/CPRR/CAC saudáveis). Só é problema junto de custo ruim.
- **CPL**: custo do cadastro. CPL alto pode ser saudável se gera mais MQL/reunião.
  CPL baixo pode ser ruim se atrai gente fora do ICP.
- **Tx MQL / CPMQL**: mídia+criativo+form atraindo o perfil certo (passou pelas
  perguntas qualificatórias de renda). Tx alta com pouco volume pode ser
  segmentação estreita ou critério permissivo — o MQL só vale se avançar para
  agendamento, reunião realizada e venda.
- **Tx Agendamento / CPAG**: qualidade do MQL + atratividade da oferta de
  reunião + eficiência do comercial (tempo até 1º contato, taxa de contato,
  tentativas, script de agendamento).
- **No‑Show / CPRR**: compromisso do lead após agendar (lembrete, remarcação,
  horário, valor percebido da reunião). **No‑Show é uma das principais métricas
  operacionais** — reunião marcada e não realizada é dinheiro parado no meio do funil.
- **Tx Venda / CAC / Ticket / ROAS**: qualidade real da oferta + pitch da reunião +
  follow-up + maturação (venda high-ticket costuma fechar dias depois da reunião).

### Heurísticas obrigatórias
- CTR baixo + CPMQL/CPRR/CAC saudáveis → o anúncio qualifica melhor (não mexer).
- CPL baixo + Tx MQL baixa → mídia atraindo fora do ICP.
- Tx MQL boa + Tx Agendamento baixa → investigar **comercial**/disponibilidade/script
  de agendamento, não o tráfego automaticamente.
- Tx Agendamento boa + No‑Show alto → lembrete/confirmação/horário/remarcação —
  o problema é entre marcar e comparecer, não a qualificação do lead.
- Reunião Realizada boa (No‑Show baixo) + Tx Venda baixa → oferta/pitch/follow-up
  da reunião (agenda cheia ≠ agenda qualificada).
- CPMQL bom + CPAG ruim → perda entre qualificação e agendamento.
- CPAG bom + No‑Show alto (CPRR ruim) → perda entre agendamento e comparecimento.
- CPRR bom + CAC ruim → perda entre reunião realizada e venda.
- Reunião/lançamento recente + ROAS baixo → verificar **maturação** antes de julgar.
- Só uma campanha piorou → investigar a própria (segmentação/criativo), não geral.

## Top Anúncios e Piores Anúncios (o que a tabela já faz)

A aba calcula sozinha, por **estrutura** (campanha × conjunto × anúncio, com
gasto no período) — o mesmo nome de anúncio reaproveitado em várias
campanhas/conjuntos aparece **uma linha por estrutura**, cada uma com seu
próprio gasto/resultado (nunca somado nem escondido atrás da estrutura de
maior gasto):
- **Top**: ranqueado pelo **resultado mais profundo disponível** (Venda → Reunião
  Realizada → Agendamento → MQL), maior volume + menor custo, **amostra relevante primeiro**.
- A coluna **Status** mostra a recomendação **Escalar / Manter / Observar / Cortar**
  (`adRecommendation` em `app.js`), não mais "Avaliável/Em observação": meta principal é
  **CAC** vs. a meta do painel, mas só vira **Escalar** com Faturamento provado (venda com
  valor) **e** CPAG dentro da meta — CAC bom sozinho não escala. CAC acima do teto (+30%
  da meta) → **Cortar**; CAC na faixa intermediária, ou CAC bom sem faturamento/com CPAG
  estourado → **Manter**. Sem venda ainda, julga só pelo CPAG (verde → Manter, vermelho →
  Cortar). **Sem amostra mínima** (`SAMPLE_MIN_SPEND`/volume mínimo do painel) ou sem meta
  definida pra julgar → **Observar**, nunca "vencedor"/"ruim" no escuro.
- **Piores**: mesma tabela, ordenada — só anúncios com **investimento relevante** e
  resultado profundo fraco / custo pior que a média aparecem como candidatos a Cortar;
  **nunca** por CTR/CPM/CPL isolados.
- Limiares em `build.py`: `SAMPLE_MIN_SPEND`, `SAMPLE_MIN_MQLS`, `TOP_ADS_N`; metas de
  CAC/CPAG vêm do painel editável da aba Relatório (`METAS` em `app.js`).
- **Link** abre o criativo (coluna opcional de permalink na aba de mídia →
  `ad_links`).

O texto deve **explicar** o ranking (por quê), não repeti-lo.

## Nota de saúde do funil (0–10)

`relatorios_dados.json` já traz `nota_saude` calculada por período
(`relatorio_lib.funnel_health`, mesma metodologia sempre — nunca recalcule
esse número na redação, só reporte/explique). Subnotas: **aquisição** (CPM/CTR
vs. baseline de 30d), **conversão da página** (hoje sempre `null` — sem fonte
de Page Views/ConvLP), **qualificação** (Tx‑MQL/CPMQL vs. meta ou baseline),
**vendas** (hoje sempre `null` — sem fonte comercial), **consistência**
(variação da Tx‑MQL entre janelas 7/14/30d) e **confiabilidade dos dados**
(volume de MQLs vs. volume mínimo amostral). A nota geral é a média das
subnotas disponíveis; quando alguma subnota é `null`, `provisoria=true` e
`motivo` explica qual dado falta — **nunca trate a subnota ausente como 0**.
Use a classificação textual já calculada (`classificacao`): Excelente (≥8) ·
Saudável, com atenção (≥6,5) · Atenção (≥5) · Crítico (≥3) · Crítico grave
(<3). Redija 1–2 frases explicando a nota citando as subnotas mais baixas —
não reinvente a metodologia.

## Formato "Insights de Tráfego" — 4 quadrantes + bloco WhatsApp

> O tom é de **gestor de tráfego experiente falando com outro gestor**:
> profundo na análise, mas direto — escaneável, não narrativo. Cada quadrante
> termina em decisão, não em descrição. Antes de redigir, leia por inteiro
> `build/GUIA-INTERPRETACAO-METRICAS.md` e aplique suas heurísticas: **nunca
> julgue uma métrica isolada** — sempre com a etapa anterior/posterior, o
> histórico da conta e o volume da amostra. Use os números JÁ CALCULADOS de
> `relatorios_dados.json` (`totais`, `comparativos.periodo_anterior.variacao`,
> `nota_saude`, `criativos_consolidado`, `whatsapp_numeros`) — não recalcule
> soma/média/variação/ranking, só interprete e redija.

Cada período em `relatorios.json` tem 6 campos: `nota_saude` (objeto, copiado
de `relatorios_dados.json`), `whatsapp` (string, bloco pronto pra copiar) e 4
quadrantes em HTML (`quadro1_resumo`, `quadro2_diagnostico`,
`quadro3_campeoes`, `quadro4_acoes`).

### Bloco WhatsApp (`whatsapp`, string com quebras de linha `\n`)

Monte a partir de `whatsapp_numeros` (já formatado em R$/%) — **copie os
valores literalmente**, nunca invente/recalcule. Formato fixo:

```
📊 RESUMO DO PERÍODO
Período: {periodo_range}
Gasto: {gasto}
CPM: {cpm}
CTR: {ctr}
Connect Rate: {connect_rate}
Conversão da LP: {conv_lp}
Leads: {leads}
CPL: {cpl}
MQLs: {mqls}
CPA/CPMQL: {cpa_cpmql}
Vendas: {vendas}
Faturamento: {faturamento}
CAC: {cac}
ROAS: {roas}
Ticket médio: {ticket_medio}
Saúde do funil: {saude_funil}
Principais destaques:
• …
• …
Principais ações:
• …
• …
```

`CPA/CPMQL` é a nomenclatura oficial única (custo por MQL) — não crie um
"CPA" separado. Campos sem fonte conectada (Connect Rate, Conversão da LP,
Vendas, Faturamento, CAC, ROAS, Ticket médio) já chegam como **"Não
disponível"** — mantenha assim, nunca escreva "R$ 0" nem um valor inventado.
Em "Principais destaques"/"Principais ações" escreva 2–3 itens curtos (uma
linha cada, sem explicação técnica) — é a única parte deste bloco que você
redige; o resto é só template preenchido.

### Quadrante 1 — Resumo executivo e saúde do funil (`quadro1_resumo`)

- Nota de saúde (`<b>` + classificação + `provisoria`/`motivo` se houver).
- Status das metas (CPMQL/CAC — meta ou "não definida").
- Números do período (gasto, leads, MQLs, Tx‑MQL, CPL, CPA/CPMQL).
- **Mudanças vs. período anterior** — liste só variações com
  `material:true` em `comparativos.periodo_anterior.variacao` (evita ruído:
  oscilação abaixo do limiar não é notícia). Diferencie `delta_pp` (métricas
  de taxa — CTR/ConvForm/Tx‑MQL) de `delta_pct` (as demais) — nunca confunda
  os dois no texto (ex.: "CTR caiu 0,5 **ponto percentual**", não "caiu 0,5%").
- Principais destaques positivos / principais alertas (a partir das mesmas
  variações materiais).
- **Decisão mais importante do período** — 1 frase, aponta para o item mais
  crítico do Quadrante 4.

### Quadrante 2 — Diagnóstico do funil (`quadro2_diagnostico`)

- Suficiência de amostra (compare `totais.mqls` com `volume_min_amostral`).
- Melhoras relevantes / pioras relevantes / métricas estáveis (mesma lista de
  `variacao`, mas aqui você **explica o porquê provável**, não só lista).
- Gargalos + hipóteses, no formato de `GUIA-INTERPRETACAO-METRICAS.md`: o que
  mudou → quanto → onde → hipóteses prováveis → evidência a favor → evidência
  contra → ação recomendada → prazo/condição de reavaliação. Trate como
  diagnóstico probabilístico, nunca certeza.
- **Gargalo de dado (prioridade alta)** — enquanto Agendamentos/Reuniões/
  Vendas/Faturamento não tiverem fonte conectada, este item aparece sempre,
  separado dos gargalos de campanha.

### Quadrante 3 — Campanhas, estruturas e anúncios campeões (`quadro3_campeoes`)

- Campanha campeã de **volume** e campanha campeã de **eficiência** (podem
  ser diferentes — diga qual é qual, nunca funda os dois conceitos).
- **Estrutura completa campeã** sempre pelos 3 níveis: `Campanha: [nome
  completo] · Conjunto: [nome completo] · Anúncio: [nome completo]` — nomes
  **nunca abreviados** (proibido usar reticências ou cortar nome).
- Ranking das estruturas (`por_anuncio`, unidade = campanha+conjunto+anúncio)
  por CPA/CPMQL, com volume ao lado (nunca declarar campeão com 1 MQL isolado
  sem citar a amostra).
- **Cada criativo em `criativos_consolidado` com `n_estruturas > 1`** recebe
  as DUAS análises exigidas: (a) consolidada — resultado total, quantas
  estruturas, eficiência geral; (b) por ocorrência — `melhor_estrutura` e
  `pior_estrutura` nomeadas, com a régua explícita: **decisão é por
  ocorrência** ("cortar esta ocorrência nesta estrutura" ≠ "cortar o
  criativo"). Nunca recomende corte global de um criativo vencedor por causa
  de 1 estrutura fraca.

### Quadrante 4 — Ações priorizadas (`quadro4_acoes`)

Listas separadas, cada uma um `<h4>` + `<ul>` (ou `<p>` se vazia): **Fazer
hoje** · **Escalar** · **Manter** · **Observar** · **Otimizar/investigar** ·
**Cortar** · **Produzir/testar** · **Evitar** · **Próxima revisão**. Regras:

- Toda entrada de Escalar/Manter/Otimizar/Cortar cita a **campanha e o
  conjunto completos**, e o **nível certo de orçamento**: em **ABO** o ajuste
  é no **conjunto**; em **CBO**, na **campanha**. Como a fonte de dados atual
  não informa o tipo de orçamento por estrutura, **nunca assuma ABO/CBO** —
  escreva "orçamento no nível do conjunto/campanha, conforme configuração
  real (confirmar no Gerenciador de Anúncios)" quando o tipo não estiver
  documentado. No **anúncio**, as ações possíveis são ativar/pausar/duplicar/
  substituir/replicar — nunca "aumentar a verba do anúncio" como se ele
  tivesse orçamento próprio.
- **Fazer hoje**: só decisões com evidência suficiente (volume ≥ mínimo
  amostral) para execução imediata — não é uma lista de "seria bom".
- **Escalar**: percentual/valor do incremento (regra: +10–20% a cada 3–4
  dias; alertar sobre resetar aprendizado em saltos maiores).
- **Observar**: diga exatamente o que falta (dias, gasto, cliques, leads,
  MQLs) para virar decisão.
- **Otimizar/investigar**: relacione o gargalo a uma verificação prática
  (criativo, público, página, velocidade, rastreamento, API, formulário,
  comercial, oferta, distribuição de verba).
- **Cortar**: local exato do corte (estrutura) e o critério numérico
  ultrapassado. **Nunca corte sem meta/teto definido** — se `meta_cpmql` e
  `meta_cac` forem `null`, esta lista fica vazia e o texto explica por quê.
- **Produzir/testar**: anúncio de referência, o que variar, em qual
  estrutura, orçamento/limite do teste, critério de sucesso.
- **Evitar**: ações que parecem óbvias mas os dados não sustentam (ex.:
  escalar com base só em "hoje"; cortar por 1 oscilação de CTR/CPM).
- Cada item carrega, quando aplicável, **prioridade** (crítica/alta/média/
  baixa), **confiança** (alta/média/baixa) e a **janela** usada como
  evidência — não precisa de campo próprio no schema, escreva inline
  (ex.: "prioridade alta, confiança média, base: 14d").
- **Próxima revisão**: gatilho (o que muda a classificação) + prazo/gasto.

Ao citar um anúncio, **sempre** diga campanha e conjunto — o mesmo nome de
anúncio pode rodar em estruturas diferentes com resultados diferentes.

### Leitura cruzada das 9 janelas

Não trate os 9 relatórios como leituras isoladas. Use cada um para o que
serve (hoje/ontem = anomalia; 3d = direção recente; 7d = janela operacional
principal; 14d/30d = consistência e saturação; mês×mês passado = evolução
mensal; máximo = benchmark interno). Ao recomendar escala, cite se a
campanha também é campeã em 14d/30d (não só hoje); ao recomendar corte,
confirme que a queda persiste em mais de uma janela antes de classificar
como `Cortar`. Se duas janelas indicarem decisões opostas, explique o
conflito e diga qual janela pesa mais para aquela decisão específica —
nunca produza recomendações contraditórias sem justificar.

### Metas & parâmetros (painel editável da aba)
O gestor preenche no topo da aba: **Meta CPMQL**, **Meta CAC**, **Volume mínimo
amostral (MQLs)** e **N dias p/ corte**. Defaults em `build.py` (`META_CPMQL`,
`META_CAC` = None → "não definida"; `VOLUME_MIN_AMOSTRAL`, `N_DIAS_CORTE`). As
tabelas de anúncio **recoram CPMQL/CAC** vs meta (verde ≤ meta · amarelo até
+30% · vermelho acima) e o badge **Em observação/Avaliável** usa o volume
mínimo — tudo ao vivo. O texto dos Insights **cita a meta (ou "meta não
definida")** e usa o volume mínimo/N dias configurados como critério das
classificações.

## Comparações e segurança analítica

Cada uma das 9 janelas usa o período anterior CORRETO (já resolvido em
`comparativos.periodo_anterior`, campo `metodo` explica qual regra foi usada):
imediatamente anterior de mesma duração (hoje/ontem/3d/7d/14d/30d); mesmo
intervalo de dias do mês anterior (mês); mês retrasado completo (mês
passado); metade antiga vs. metade recente do histórico, só quando há ≥14
dias de dados (máximo — **nunca inventa** um período anterior inexistente;
com histórico curto, `periodo_anterior.totais` vem `null` e o texto deve
dizer que o histórico serve só como benchmark). **Não invente**
métricas/benchmarks; **não** trate ausência de dado como zero; **não** compare
janelas de maturação diferentes; **não** penalize leads recentes ainda não
trabalhados; **não** recomende cortar/escalar com amostra insuficiente; **não**
culpe o tráfego por perda que acontece depois do MQL, nem o comercial se o MQL
estiver ruim.

## Economia de tokens (leia antes de redigir)

Todo cálculo pesado já está feito em `relatorios_dados.json` (somas, médias,
variações %/pp, rankings, nota de saúde, formatação de moeda/percentual do
bloco WhatsApp). A Routine **não deve**: recalcular totais/variações,
reprocessar CSVs, gerar HTML decorativo além dos 4 quadrantes definidos, ou
repetir o mesmo número em blocos diferentes sem necessidade. Uma única leitura
de `relatorios_dados.json` + os 2 guias cobre os 9 períodos numa única
sessão/execução — não releia os documentos por período. Se os dados de origem
não mudaram desde a última execução (checar `generated_at`/hash do CSV
processado, quando disponível), não regenere o relatório do dia.

## Formato de `build/relatorios.json`

```json
{
  "generated_at": "DD/MM/AAAA HH:MM",
  "fonte": "Insights de Tráfego redigidos pelo Claude (Routine diária, 23h59 BRT) a partir dos números agregados em relatorios_dados.json (mídia paga × Leads).",
  "periodos": {
    "hoje": {
      "nota_saude": {"nota": 7.4, "provisoria": true, "classificacao": "Saudável, com atenção",
                      "motivo": "Nota provisória: sem dados suficientes para conversao_pagina, vendas.",
                      "subnotas": {"aquisicao": 7.8, "conversao_pagina": null, "qualificacao": 8.1,
                                    "vendas": null, "consistencia": 6.9, "confiabilidade_dados": 10.0}},
      "whatsapp": "📊 RESUMO DO PERÍODO\nPeríodo: 08/07/2026 a 08/08/2026\nGasto: R$ 2.400,00\n…",
      "quadro1_resumo": "<p>…</p>",
      "quadro2_diagnostico": "<p>…</p><ul>…</ul>",
      "quadro3_campeoes": "<p>Campanha: …</p>",
      "quadro4_acoes": "<h4>Fazer hoje</h4><ul>…</ul><h4>Escalar</h4>…"
    },
    "ontem": "…", "3d": "…", "7d": "…", "14d": "…", "30d": "…",
    "mes": "…", "mespass": "…", "todo": "…"
  }
}
```

- **Chaves de período fixas** (mesmos ids do seletor da topbar). O texto só
  aparece nos períodos predefinidos; em intervalo personalizado ou dias
  selecionados a aba mostra uma mensagem orientando a escolher um preset.
- HTML permitido nos quadrantes: `<p> <ul> <li> <b> <h4>` e
  `<span class="tag escala|otimiza|corte|observar">Escalar|Otimizar|Cortar|Observar</span>`
  (a classe de "Otimizar" é `otimiza`, não `otimizar`).
- Se um período não tiver dados, `nota_saude` vem com `nota:null`, `whatsapp`
  usa "Não disponível" nos campos numéricos, e os quadrantes trazem um texto
  curto dizendo que não houve investimento/atividade (o gerador determinístico
  `gerar_relatorios.py` já faz isso — ver `sem_dado_payload`).
- **Compatibilidade:** o site (`build/app.js` → `renderRelBrief`) ainda
  reconhece o formato antigo (`{"html": "…"}` por período), usado só como
  fallback enquanto o `relatorios.json` commitado não tiver passado pela
  primeira execução no novo formato — não é um formato válido para novas
  gerações.
- Se o arquivo não existir ou vier vazio (como no template), a aba mostra
  tudo menos os Insights (cards/tabelas seguem funcionando).
