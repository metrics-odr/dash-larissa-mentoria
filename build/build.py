#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a dashboard estatica (index.html) a partir de duas abas da planilha central:

  - "Leads" (gid <<PREENCHER: gid da aba de Leads>>): leads reais + coluna de faturamento => qualificacao
  - "Meta Ads" (gid <<PREENCHER: gid da aba de mídia paga>>): investimento/impressoes/cliques do gerenciador

Criterio de Lead Qualificado (MQL): <<PREENCHER: critério de qualificação do cliente
(ex.: faturamento medio mensal >= R$ X, coluna "..." da planilha)>>.

Este script apenas LE as planilhas (export CSV publico) e emite os REGISTROS BRUTOS
(leads[] e meta[]) dentro do HTML. Todos os filtros, agregacoes, KPIs, tabelas e
graficos sao calculados no navegador (client-side), permitindo filtro por data e
filtro cruzado bidirecional sem recarregar. Nunca escreve nada de volta.

Teste local: --leads-file / --meta-file apontando para CSVs baixados.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone, timedelta

SPREADSHEET_ID = "<<PREENCHER: ID da planilha Google Sheets (só leitura, export CSV público)>>"
GID_LEADS = "<<PREENCHER: gid da aba de Leads>>"
GID_META = "<<PREENCHER: gid da aba de mídia paga>>"
EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"

# Identificação do cliente/conta (usada só em textos/relatórios — não afeta o cruzamento de dados).
CLIENT_NAME = "<<PREENCHER: nome do cliente/negócio>>"
MAIN_PRODUCT = "<<PREENCHER: nome do produto/oferta principal>>"
MAIN_PRODUCT_PREFIX = "<<PREENCHER: sigla/prefixo do funil ou produto usado nos nomes de campanha>>"
# Reservado para quando houver uma aba de vendas/compradores (ver "Lacunas de dados"
# no CLAUDE.md) — ainda não usado em process()/build.py; ligar quando a fonte existir.
GID_SALES = "<<PREENCHER: gid da aba de vendas/compradores, quando existir>>"

BRT = timezone(timedelta(hours=-3))   # horario de Brasilia (exibicao)
TAX_FACTOR = 1.0                      # <<PREENCHER: imposto/taxa da conta de mídia (1.0 se não houver)>>

# --------------------------------------------------------------------------- #
# Regras da aba Relatório (Top/Piores anúncios)
# --------------------------------------------------------------------------- #
# Amostra mínima para julgar um anúncio como "vencedor" ou "ruim". Abaixo disso
# ele entra como "Em observação" (dado insuficiente) — nunca é classificado só
# porque teve 1 resultado com pouco investimento. Ajuste conforme o ticket/CAC.
SAMPLE_MIN_SPEND = 100.0   # gasto mínimo (R$) para amostra relevante
SAMPLE_MIN_MQLS = 3        # MQLs mínimos para julgar qualidade profunda
TOP_ADS_N = 10             # nº de linhas em Top / Piores anúncios

# Metas & parâmetros da conta (DEFAULTS do painel editável da aba Relatório).
# São só o valor inicial: o usuário edita no navegador (persistido em
# localStorage) e as tabelas de anúncios recoram CPMQL/CAC e reavaliam a
# amostra ao vivo. None = "meta não definida" (métrica aparece sem cor até o
# gestor preencher).
META_CPMQL = None          # meta de CPMQL (R$/MQL); None = não definida
META_CAC = None            # meta de CAC (R$/venda); None = não definida
VOLUME_MIN_AMOSTRAL = SAMPLE_MIN_MQLS  # conversões (MQLs) mínimas p/ amostra confiável
N_DIAS_CORTE = 5           # dias consecutivos acima do teto p/ considerar corte


# --------------------------------------------------------------------------- #
# Leitura
# --------------------------------------------------------------------------- #
def fetch_csv(url: str) -> list[list[str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "dash-template-bot/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return list(csv.reader(io.StringIO(raw)))


def read_csv_file(path: str) -> list[list[str]]:
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
        return list(csv.reader(f))


def load_rows(url: str, local: str | None) -> list[list[str]]:
    return read_csv_file(local) if local else fetch_csv(url)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str | None) -> str:
    return strip_accents((s or "").strip().lower())


def to_float(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v).strip())
    if not s:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date(v: str) -> str | None:
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    for fmt in ("%d/%m/%Y", "%m/%d/%Y", "%d/%m/%y", "%b %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def is_test_lead(rowtext: str) -> bool:
    return "<test lead" in rowtext.lower()


_MONEY_RE = re.compile(r"\d[\d.]*(?:,\d+)?")
MQL_FATURAMENTO_MIN = 0.0  # <<PREENCHER: limiar de faturamento (R$) que define o MQL do cliente novo>>


def _money_values(s: str) -> list[float]:
    out = []
    for tok in _MONEY_RE.findall(s):
        t = tok.replace(".", "").replace(",", ".")
        try:
            out.append(float(t))
        except ValueError:
            pass
    return out


def is_qualified(bucket: str | None) -> bool:
    """<<PREENCHER: critério de MQL do cliente novo>> — assume por padrão faixas de
    faturamento no formato "Entre R$X e R$Y" / "Menos de R$X" / "Mais de R$X" (mesma
    coluna de qualificação da planilha). Ajuste esta função se o critério do cliente
    novo não for baseado em faixa de faturamento (ex.: outra pergunta do formulário,
    outro tipo de corte)."""
    s = norm(bucket)
    if not s or "test lead" in s:
        return False
    nums = _money_values(s)
    if not nums:
        return False
    if "menos" in s or "ate " in s or "abaixo" in s:
        return False
    if "entre" in s:
        return min(nums) >= MQL_FATURAMENTO_MIN
    if any(k in s for k in ("mais", "acima", "superior", "maior")):
        return max(nums) >= MQL_FATURAMENTO_MIN
    return max(nums) >= MQL_FATURAMENTO_MIN


def pretty_bucket(bucket: str) -> str:
    s = (bucket or "").strip()
    return s.replace("_", " ").replace(" e ", " a ").capitalize() if s else "Sem resposta"


def mask_email(e: str) -> str:
    e = (e or "").strip()
    if "@" not in e:
        return "—"
    user, dom = e.split("@", 1)
    keep = user[:2] if len(user) > 2 else user[:1]
    return f"{keep}****@{dom}"


def mask_phone(p: str) -> str:
    digits = re.sub(r"\D", "", p or "")
    return f"…{digits[-4:]}" if len(digits) >= 4 else "—"


def first_last_initial(name: str) -> str:
    parts = (name or "").strip().split()
    if not parts:
        return "—"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][:1]}."


def valid_utm(campaign: str) -> bool:
    c = (campaign or "").strip()
    return bool(c) and c not in ("-", "—")


# --------------------------------------------------------------------------- #
# Indexacao das colunas
# --------------------------------------------------------------------------- #
def header_index(header, wanted, fallback):
    idx = {}
    hn = [norm(h) for h in header]
    for key, aliases in wanted.items():
        found = None
        for a in aliases:
            a = norm(a)
            for i, h in enumerate(hn):
                if h == a or (a and a in h):
                    found = i
                    break
            if found is not None:
                break
        idx[key] = found if found is not None else fallback.get(key)
    return idx


def cell(row, i):
    if i is None or i < 0 or i >= len(row):
        return ""
    return (row[i] or "").strip()


# --------------------------------------------------------------------------- #
# Processamento -> registros brutos
# --------------------------------------------------------------------------- #
def process(leads_rows, meta_rows):
    lheader = leads_rows[0] if leads_rows else []
    lidx = header_index(
        lheader,
        # Aba "Leads" (formulário/typeform): sem coluna de plataforma/orgânico
        # dedicada — usamos utm_source como platform e is_organic fica sem
        # alias (todos os leads atuais são via Meta Ads pago).
        {"created": ["data ajustada", "created_time", "data", "created"],
         "ad_name": ["utm_content", "ad_name"],
         "adset_name": ["utm_medium", "adset_name"], "campaign": ["utm_campaign", "campaign_name"],
         "is_organic": ["is_organic"],
         "platform": ["utm_source", "platform"], "profession": ["profissao e atividade", "qual_sua_profissao", "profiss"],
         "faturamento": ["media de faturamento mensal", "qual_seu_faturamento", "faturamento"],
         "name": ["nome completo", "full_name", "nome"],
         "email": ["e-mail", "email"], "phone": ["whatsapp", "phone_number", "phone", "telefone"]},
        # <<PREENCHER: fallback posicional (índice de coluna) — confira contra o
        # cabeçalho real da planilha do cliente novo; os aliases acima cobrem a
        # maioria dos casos, este fallback só entra se nenhum alias bater>>
        {"created": 31, "ad_name": 14, "adset_name": 12, "campaign": 13, "is_organic": None, "platform": 11,
         "profession": 26, "faturamento": 29, "name": 7, "email": 8, "phone": 9},
    )

    leads = []
    for row in leads_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        if is_test_lead(" ".join(str(c) for c in row)):
            continue
        organic = norm(cell(row, lidx["is_organic"])) in ("true", "1", "sim", "verdadeiro")
        platform = norm(cell(row, lidx["platform"]))
        campaign = cell(row, lidx["campaign"])
        if organic:
            src = "org"
        elif norm(campaign).startswith("goog") or platform in ("google", "youtube"):
            src = "google"
        elif platform in ("ig", "fb", "instagram", "facebook") or campaign:
            src = "meta"
        else:
            src = "outros"
        fat = cell(row, lidx["faturamento"])
        leads.append({
            "d": parse_date(cell(row, lidx["created"])),
            "src": src,
            "plat": platform or "—",
            "camp": campaign or "(sem campanha)",
            "adset": cell(row, lidx["adset_name"]) or "(sem conjunto)",
            "ad": cell(row, lidx["ad_name"]) or "(sem anúncio)",
            "prof": (cell(row, lidx["profession"]) or "Sem resposta").replace("_", " ").capitalize(),
            "bucket": pretty_bucket(fat),
            "q": 1 if is_qualified(fat) else 0,
            "utm": 1 if valid_utm(campaign) else 0,
            "nm": first_last_initial(cell(row, lidx["name"])),
            "em": mask_email(cell(row, lidx["email"])),
            "ph": mask_phone(cell(row, lidx["phone"])),
        })

    mheader = meta_rows[0] if meta_rows else []
    midx = header_index(
        mheader,
        {"day": ["day", "data"], "campaign": ["campaign name", "campaign"], "adset": ["ad set name", "adset"],
         "ad": ["ad name"], "spent": ["amount spent", "valor gasto", "gasto"], "impr": ["impressions", "impress"],
         "clicks": ["link clicks", "clicks", "cliques"], "leads": ["leads"],
         "pv": ["landing page views", "page views", "pageviews"],
         # Link do criativo (ex. Instagram) — coluna opcional adicionada pelo cliente
         # na aba de mídia. Usada na aba Relatório (Top/Piores anúncios) para linkar
         # o anúncio. Aliases cobrem variações do cabeçalho.
         "link": ["creative instagram permalink", "instagram permalink", "permalink",
                  "creative link", "link do anuncio", "link do criativo"]},
        {"day": 0, "campaign": 1, "adset": 2, "ad": 3, "spent": 4, "impr": 5, "clicks": 6, "leads": 8, "pv": 7},
    )

    meta = []
    # Anúncio (nome) -> 1 permalink do criativo. "Qualquer um correlato" ao
    # anúncio serve (o mesmo criativo pode rodar em vários dias/conjuntos);
    # guardamos o primeiro link não-vazio encontrado para cada anúncio.
    ad_links = {}
    for row in meta_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        ad = cell(row, midx["ad"]) or "(sem anúncio)"
        link = cell(row, midx["link"])
        if link and ad not in ad_links:
            ad_links[ad] = link
        meta.append({
            "d": parse_date(cell(row, midx["day"])),
            "camp": cell(row, midx["campaign"]) or "(sem campanha)",
            "adset": cell(row, midx["adset"]) or "(sem conjunto)",
            "ad": ad,
            "sp": round(to_float(cell(row, midx["spent"])), 4),
            "im": to_float(cell(row, midx["impr"])),
            "cl": to_float(cell(row, midx["clicks"])),
            "pv": to_float(cell(row, midx["pv"])),
            "ml": to_float(cell(row, midx["leads"])),
        })

    dates = sorted({d for d in ([l["d"] for l in leads if l["d"]] + [m["d"] for m in meta if m["d"]])})
    now_brt = datetime.now(BRT)
    return {
        "build": {
            "generated_at_brt": now_brt.strftime("%d/%m/%Y %H:%M"),
            "build_id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
            "today": now_brt.strftime("%Y-%m-%d"),
            "date_min": dates[0] if dates else None,
            "date_max": dates[-1] if dates else None,
            "tax_factor": TAX_FACTOR,
            # config da aba Relatório (lida pelo front)
            "sample_min_spend": SAMPLE_MIN_SPEND,
            "sample_min_mqls": SAMPLE_MIN_MQLS,
            "top_ads_n": TOP_ADS_N,
            # metas & parâmetros (defaults do painel editável; None = não definida)
            "meta_cpmql": META_CPMQL,
            "meta_cac": META_CAC,
            "volume_min_amostral": VOLUME_MIN_AMOSTRAL,
            "n_dias_corte": N_DIAS_CORTE,
        },
        "leads": leads,
        "meta": meta,
        # Anúncio -> permalink do criativo (aba Relatório).
        "ad_links": ad_links,
        # Insights de Tráfego (texto pré-escrito, lido de relatorios.json). Preenchido
        # em main() via load_briefings(); fica {} se relatorios.json não existir.
        "briefings": {},
    }


# --------------------------------------------------------------------------- #
# Insights de Tráfego (aba Relatório)
# --------------------------------------------------------------------------- #
def load_briefings(path: str) -> dict:
    """Lê build/relatorios.json. Estrutura:
        {"generated_at": "...", "periodos": {"<preset>": {"html": "..."}, ...}}
    Retorna o dict inteiro (ou {} se o arquivo não existir/for inválido).
    A geração NÃO acontece aqui — este build só lê o texto já pronto, sem
    chamar nenhuma API (custo zero no build/no navegador)."""
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else {}
    except (ValueError, OSError):
        return {}


# --------------------------------------------------------------------------- #
# Render
# --------------------------------------------------------------------------- #
def render(data, template_path):
    # A dashboard e montada a partir de arquivos separados (visual x logica):
    #   template.html          -> esqueleto HTML (placeholders __STYLES__/__APP_JS__)
    #   identidade-visual.css  -> TODAS as cores (edite aqui p/ mexer so em cor)
    #   estilos.css            -> layout/componentes
    #   app.js                 -> logica + renderizacao
    # Esta funcao so COSTURA os arquivos e injeta os dados; nao altera nada deles.
    base = os.path.dirname(os.path.abspath(template_path))

    def readf(name):
        with open(os.path.join(base, name), "r", encoding="utf-8") as f:
            return f.read()

    with open(template_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    styles = readf("identidade-visual.css") + "\n" + readf("estilos.css")
    tpl = tpl.replace("__STYLES__", styles)
    tpl = tpl.replace("__APP_JS__", readf("app.js"))
    tpl = tpl.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False))
    tpl = tpl.replace("__BUILD_ID__", data["build"]["build_id"])
    tpl = tpl.replace("__GENERATED_BRT__", data["build"]["generated_at_brt"])
    return tpl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leads-file")
    ap.add_argument("--meta-file")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    leads_rows = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=GID_LEADS), args.leads_file)
    meta_rows = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=GID_META), args.meta_file)
    data = process(leads_rows, meta_rows)

    # Insights de Tráfego (texto pré-escrito) — lidos do arquivo versionado ao
    # lado do template. Sem chamada de API no build.
    briefings_path = os.path.join(os.path.dirname(os.path.abspath(args.template)), "relatorios.json")
    data["briefings"] = load_briefings(briefings_path)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(data, args.template))

    b = data["build"]
    q = sum(l["q"] for l in data["leads"])
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo : {b['date_min']} -> {b['date_max']}", file=sys.stderr)
    print(f"  leads   : {len(data['leads'])}  MQLs qualificados: {q}", file=sys.stderr)
    print(f"  meta    : {len(data['meta'])} linhas", file=sys.stderr)
    print(f"  out     : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
