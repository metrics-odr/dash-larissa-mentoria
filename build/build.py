#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a dashboard estatica (index.html) a partir de tres abas da planilha central:

  - "Leads" (gid 258602723): leads reais + Qualificacao/score => MQL
  - "Meta Ads" (gid 0): investimento/impressoes/cliques do gerenciador
  - "Compradores" (gid 179764332): vendas/faturamento/caixa, cruzadas com Leads por e-mail

Criterio de Lead Qualificado (MQL): coluna "Qualificação" == "QLF" OU coluna
"score" == 10 (aba Leads).

Cada lead/linha de midia e classificado em um dos 3 funis (Funil de High Ticket):
DIAG, APD-BR, APD-MUNDO, a partir do nome da campanha (utm_campaign / Campaign
Name) e, para leads organicos sem campanha, do nome do formulario. Campanhas que
nao pertencem a nenhum dos 3 funis (aquecimento, vendas, etc.) sao descartadas.
Ver classify_funil()/classify_temp() abaixo.

Este script apenas LE as planilhas (export CSV publico) e emite os REGISTROS BRUTOS
(leads[] e meta[]) dentro do HTML. Todos os filtros, agregacoes, KPIs, tabelas e
graficos sao calculados no navegador (client-side), permitindo filtro por data e
filtro cruzado bidirecional sem recarregar. Nunca escreve nada de volta.

Teste local: --leads-file / --meta-file / --sales-file apontando para CSVs baixados.
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

SPREADSHEET_ID = "1P7c_7rutl0fdnqIc2DX5DuGl6H9E7WRU_gzDpOdphkw"
GID_LEADS = "258602723"
GID_META = "0"
EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"

# Identificação do cliente/conta (usada só em textos/relatórios — não afeta o cruzamento de dados).
CLIENT_NAME = "Versalhes"
MAIN_PRODUCT = "Mentoria Versalhes"
MAIN_PRODUCT_PREFIX = "Funil de High Ticket"
# Aba "Compradores": vendas/faturamento/caixa, cruzadas com Leads por e-mail (ver join_sales()).
GID_SALES = "179764332"

BRT = timezone(timedelta(hours=-3))   # horario de Brasilia (exibicao)
TAX_FACTOR = 1.0                      # sem imposto adicional informado para esta conta de mídia

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
    with urllib.request.urlopen(req, timeout=180) as resp:
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


def is_qualified(qlf_flag: str | None, score) -> bool:
    """MQL do Funil de High Ticket: coluna "Qualificação" == "QLF" OU coluna
    "score" == 10 (aba Leads). Reajustável — ver checklist do CLAUDE.md."""
    if norm(qlf_flag) == "qlf":
        return True
    try:
        if float(str(score).strip().replace(",", ".")) == 10:
            return True
    except (TypeError, ValueError):
        pass
    return False


# --------------------------------------------------------------------------- #
# Classificação de funil / temperatura (a partir do nome da campanha)
# --------------------------------------------------------------------------- #
def classify_funil_campaign(campaign: str | None) -> str | None:
    """DIAG / APD-BR / APD-MUNDO a partir do nome da campanha paga (utm_campaign /
    Campaign Name). Campanhas novas usam a sigla "APD" ou "DIAG"; campanhas
    legadas usam a tag "[VERSALHES-APLICACAO]" (sempre um funil de Aplicação
    Direta). "MUNDO"/"Portugal" no nome = internacional; senão, BR. Campanhas
    fora dos 3 funis (aquecimento, vendas, etc.) retornam None (descartadas)."""
    s = (campaign or "").upper()
    if "DIAG" in s:
        return "DIAG"
    if "APD" in s or "VERSALHES-APLICACAO" in s:
        return "APD-MUNDO" if ("MUNDO" in s or "PORTUGAL" in s) else "APD-BR"
    return None


def classify_funil_formulario(formulario: str | None) -> str | None:
    """Fallback para leads orgânicos (sem campanha paga classificável): usa o
    nome do formulário/typeform de origem."""
    f = strip_accents((formulario or "").upper())
    if "DIAGNOSTICO" in f:
        return "DIAG"
    if "APLICACAO DIRETA" in f:
        return "APD-MUNDO" if "INTERNACIONAL" in f else "APD-BR"
    return None


def classify_funil(campaign: str | None, formulario: str | None = None, organic: bool = False) -> str | None:
    """Junta as duas classificações acima. Para leads PAGOS (organic=False), só
    o nome da campanha decide — uma campanha paga fora dos 3 funis (aquecimento,
    vendas, etc.) é descartada, mesmo que o formulário de origem diga "Aplicação
    Direta" (ex.: retargeting/nutrição). Para leads ORGÂNICOS, cai no formulário
    quando a campanha (utm_campaign) não permite classificar (ex.: "bio")."""
    funil = classify_funil_campaign(campaign)
    if funil is not None:
        return funil
    if organic:
        return classify_funil_formulario(formulario)
    return None


def classify_temp(campaign: str | None) -> str:
    s = (campaign or "").upper()
    if "QUENTE" in s:
        return "Quente"
    if "FRIO" in s:
        return "Frio"
    return "—"


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
def phone_digits(p: str) -> str:
    return re.sub(r"\D", "", p or "")[-8:]  # últimos 8 dígitos (fallback de junção)


# --------------------------------------------------------------------------- #
# Junção com a aba "Compradores" (vendas/faturamento/caixa)
# --------------------------------------------------------------------------- #
def join_sales(leads: list, sales_rows: list) -> None:
    """Cruza cada linha da aba Compradores com o lead correspondente (por
    e-mail; se não achar, tenta os últimos 8 dígitos do telefone) e soma
    vendas/faturamento("faturamentoVenda")/caixa("caixaVenda") na linha do
    lead. Quando o e-mail/telefone casa com mais de um lead (a pessoa se
    aplicou mais de uma vez), atribui a venda ao lead mais ANTIGO (primeiro
    toque) daquele contato. Compradores sem lead correspondente nos 3 funis
    não entram em nenhuma métrica (não há campanha/funil pra atribuir)."""
    if not sales_rows:
        return
    sheader = sales_rows[0]
    sidx = header_index(
        sheader,
        {"date": ["data_envio", "data"], "email": ["email"], "phone": ["telefone"],
         "caixa": ["caixavenda"], "fat": ["faturamentovenda"]},
        {"date": 0, "email": 4, "phone": 9, "caixa": 10, "fat": 11},
    )
    def older(idx_a, idx_b):  # -> índice do lead com created mais antigo (None-safe)
        da, db = leads[idx_a]["d"] or "9999", leads[idx_b]["d"] or "9999"
        return idx_a if da <= db else idx_b

    by_email: dict[str, int] = {}
    by_phone: dict[str, int] = {}
    for i, l in enumerate(leads):
        if l["_email"]:
            by_email[l["_email"]] = i if l["_email"] not in by_email else older(by_email[l["_email"]], i)
        if l["_phone"]:
            by_phone[l["_phone"]] = i if l["_phone"] not in by_phone else older(by_phone[l["_phone"]], i)

    for row in sales_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        email = norm(cell(row, sidx["email"]))
        phone = phone_digits(cell(row, sidx["phone"]))
        idx = by_email.get(email) if email else None
        if idx is None and phone:
            idx = by_phone.get(phone)
        if idx is None:
            continue
        leads[idx]["vendas"] += 1
        leads[idx]["fat"] += to_float(cell(row, sidx["fat"]))
        leads[idx]["caixa"] += to_float(cell(row, sidx["caixa"]))


def process(leads_rows, meta_rows, sales_rows=None):
    lheader = leads_rows[0] if leads_rows else []
    lidx = header_index(
        lheader,
        # Aba "Leads" (formulário Typeform "Versalhes"): sem coluna de
        # plataforma/orgânico dedicada — usamos utm_source como platform.
        {"created": ["enviado as", "enviado", "data ajustada", "created_time", "data", "created"],
         "ad_name": ["utm_content", "ad_name"],
         "adset_name": ["utm_medium", "adset_name"], "campaign": ["utm_campaign", "campaign_name"],
         "formulario": ["formulario"],
         "is_organic": ["is_organic"],
         "platform": ["utm_source", "platform"], "profession": ["profissao"],
         "faturamento": ["renda mensal familiar"],
         "status": ["status da resposta"], "qlf": ["qualificacao"], "score": ["score"],
         "name": ["nome completo", "full_name", "nome"],
         "email": ["e-mail", "email"], "phone": ["whatsapp", "phone_number", "phone", "telefone"]},
        {"created": 4, "ad_name": 14, "adset_name": 12, "campaign": 13, "is_organic": None, "platform": 11,
         "formulario": 0, "profession": None, "faturamento": 23, "status": 6,
         "qlf": None, "score": 16, "name": 7, "email": 8, "phone": 9},
    )

    leads = []
    for row in leads_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        if is_test_lead(" ".join(str(c) for c in row)):
            continue
        platform = norm(cell(row, lidx["platform"]))
        campaign = cell(row, lidx["campaign"])
        organic = norm(cell(row, lidx["is_organic"])) in ("true", "1", "sim", "verdadeiro") or platform in ("organico", "organic", "")
        formulario = cell(row, lidx["formulario"])
        funil = classify_funil(campaign, formulario, organic)
        if funil is None:
            continue  # fora dos 3 funis do Funil de High Ticket -> descarta
        if organic:
            src = "org"
        elif norm(campaign).startswith("goog") or platform in ("google", "youtube"):
            src = "google"
        elif platform in ("ig", "fb", "instagram", "facebook") or campaign:
            src = "meta"
        else:
            src = "outros"
        fat = cell(row, lidx["faturamento"])
        raw_email = norm(cell(row, lidx["email"]))
        raw_phone = phone_digits(cell(row, lidx["phone"]))
        leads.append({
            "d": parse_date(cell(row, lidx["created"])),
            "src": src,
            "plat": platform or "—",
            "camp": campaign or "(sem campanha)",
            "adset": cell(row, lidx["adset_name"]) or "(sem conjunto)",
            "ad": cell(row, lidx["ad_name"]) or "(sem anúncio)",
            "prof": (cell(row, lidx["profession"]) or "Sem resposta").replace("_", " ").capitalize(),
            "bucket": pretty_bucket(fat),
            "q": 1 if is_qualified(cell(row, lidx["qlf"]), cell(row, lidx["score"])) else 0,
            "utm": 1 if valid_utm(campaign) else 0,
            "nm": first_last_initial(cell(row, lidx["name"])),
            "em": mask_email(cell(row, lidx["email"])),
            "ph": mask_phone(cell(row, lidx["phone"])),
            "funil": funil,
            "temp": classify_temp(campaign),
            "agd": 1 if norm(cell(row, lidx["status"])) == "scheduled" else 0,
            "vendas": 0, "fat": 0.0, "caixa": 0.0,
            "_email": raw_email, "_phone": raw_phone,  # só para join_sales(); removidos antes do JSON final
        })

    join_sales(leads, sales_rows or [])
    for l in leads:
        del l["_email"], l["_phone"]

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
        campaign = cell(row, midx["campaign"])
        funil = classify_funil(campaign)
        if funil is None:
            continue  # fora dos 3 funis do Funil de High Ticket -> descarta
        ad = cell(row, midx["ad"]) or "(sem anúncio)"
        link = cell(row, midx["link"])
        if link and ad not in ad_links:
            ad_links[ad] = link
        meta.append({
            "d": parse_date(cell(row, midx["day"])),
            "camp": campaign or "(sem campanha)",
            "adset": cell(row, midx["adset"]) or "(sem conjunto)",
            "ad": ad,
            "sp": round(to_float(cell(row, midx["spent"])), 4),
            "im": to_float(cell(row, midx["impr"])),
            "cl": to_float(cell(row, midx["clicks"])),
            "pv": to_float(cell(row, midx["pv"])),
            "ml": to_float(cell(row, midx["leads"])),
            "funil": funil,
            "temp": classify_temp(campaign),
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
            # opções do dropdown de funil (Visão Geral Total / filtro global)
            "funis": ["APD-BR", "APD-MUNDO", "DIAG"],
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
    ap.add_argument("--sales-file")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    leads_rows = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=GID_LEADS), args.leads_file)
    meta_rows = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=GID_META), args.meta_file)
    sales_rows = load_rows(EXPORT_URL.format(sid=SPREADSHEET_ID, gid=GID_SALES), args.sales_file)
    data = process(leads_rows, meta_rows, sales_rows)

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
