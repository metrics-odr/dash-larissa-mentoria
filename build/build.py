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
TAX_FACTOR = 1.13806                  # imposto da mídia paga (Meta) informado pela conta

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
META_CPAGD = None          # meta de CPAGD (R$/agendamento); None = não definida — painel da aba Relatório
META_CAC = None            # meta de CAC (R$/venda); None = não definida
VOLUME_MIN_AMOSTRAL = SAMPLE_MIN_MQLS  # conversões (MQLs) mínimas p/ amostra confiável
# CPMQL/N dias: NÃO aparecem mais no painel da aba Relatório (trocados por CPAGD),
# mas continuam aqui porque o pipeline de briefing (coletar_dados_relatorio.py /
# gerar_relatorios.py / relatorio_lib.funnel_health) ainda os usa p/ a nota de saúde.
META_CPMQL = None          # meta de CPMQL (R$/MQL) — só briefing
N_DIAS_CORTE = 5           # dias consecutivos acima do teto p/ considerar corte — só briefing


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


def find_indices(header, aliases):
    """Retorna TODOS os índices de coluna cujo cabeçalho casa com algum alias
    (igualdade ou substring, sem acento). Usado p/ COALESCER perguntas que têm
    variações por funil (APD-BR / APD-MUNDO / DIAG usam colunas diferentes p/ a
    mesma pergunta, preenchidas de forma mutuamente exclusiva)."""
    hn = [norm(h) for h in header]
    idxs = []
    for a in aliases:
        a = norm(a)
        for i, h in enumerate(hn):
            if (h == a or (a and a in h)) and i not in idxs:
                idxs.append(i)
    return idxs


def coalesce(row, idxs):
    """Primeiro valor não-vazio entre as colunas indicadas (para campos com
    variantes por funil)."""
    for i in idxs:
        v = cell(row, i)
        if v:
            return v
    return ""


# --------------------------------------------------------------------------- #
# Processamento -> registros brutos
# --------------------------------------------------------------------------- #
def phone_digits(p: str) -> str:
    return re.sub(r"\D", "", p or "")[-8:]  # últimos 8 dígitos (fallback de junção)


# --------------------------------------------------------------------------- #
# Junção com a aba "Compradores" (vendas/faturamento/caixa)
# --------------------------------------------------------------------------- #
def build_sales(leads: list, sales_rows: list) -> list:
    """Cruza cada linha da aba Compradores com o lead correspondente (por
    e-mail; se não achar, tenta os últimos 8 dígitos do telefone) e emite UM
    registro de venda por linha — com a DATA DA VENDA (data_envio/"Data
    Formatada"), não a data de captura do lead. Isso faz a venda aparecer no dia
    em que aconteceu (o VLOOKUP do gestor cruzava campanha, mas jogava a métrica
    na data errada).

    Regras (pedido do cliente):
    - Só conta como venda quem **assinou o contrato** (coluna `contratante` ==
      "Assinou"); as demais linhas são ignoradas.
    - A venda herda funil/temperatura/campanha/conjunto/anúncio do lead casado
      (faz o cruzamento no código, sem VLOOKUP manual). Quando casa com mais de
      um lead do mesmo contato, usa o mais ANTIGO (primeiro toque).
    - `attributed=True` só quando o lead casado é de tráfego PAGO (src meta/
      google) — essas entram na página Meta Ads. Vendas casadas com lead orgânico
      ou sem lead correspondente ficam `attributed=False`: contam na Visão Geral
      Total (todas as vendas), mas não no funil de tráfego pago.
    """
    if not sales_rows:
        return []
    sheader = sales_rows[0]
    sidx = header_index(
        sheader,
        {"date": ["data_envio", "data formatada", "data"], "email": ["email"], "phone": ["telefone"],
         "caixa": ["caixavenda"], "fat": ["faturamentovenda"], "contr": ["contratante"],
         "renov": ["renovacao", "renovação"]},
        {"date": 0, "email": 4, "phone": 9, "caixa": 10, "fat": 11, "contr": None, "renov": None},
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

    contr_i = sidx.get("contr")
    # Data da VENDA: prioriza data_envio / "Data Formatada"; NUNCA "Data Cadastro"
    # (essa é a data do lead, com "Não Encontrado"). Coalesce por linha porque uma
    # coluna pode vir vazia enquanto a outra tem o valor.
    date_idxs = find_indices(sheader, ["data_envio", "data formatada"]) or (
        [sidx["date"]] if sidx.get("date") is not None else [])

    def sale_date(row):
        for i in date_idxs:
            d = parse_date(cell(row, i))
            if d:
                return d
        return None

    def is_signed(row):
        """Robusto a encodings da coluna `contratante`: aceita "Assinou",
        "✅ Assinou", checkbox exportado como TRUE/Sim/1, "Contrato assinado";
        rejeita negações ("Não assinou", cancelado, distrato, reembolso, FALSE).
        Se a coluna não existir, não filtra (conta todas)."""
        if contr_i is None:
            return True
        v = norm(cell(row, contr_i))
        if any(n in v for n in ("nao", "cancel", "distrat", "reembol", "estorn", "false")):
            return False                       # negação explícita -> não assinou
        return ("assinou" in v or "assinad" in v or v in ("true", "sim", "1", "verdadeiro", "x"))

    renov_i = sidx.get("renov")

    def is_renewal(row):
        """Coluna RENOVAÇÃO (checkbox): TRUE/✅/Sim/1 = renovação de uma
        assinatura existente, não uma venda nova."""
        if renov_i is None:
            return False
        v = norm(cell(row, renov_i))
        return v in ("true", "sim", "1", "verdadeiro", "x", "✅") or "✅" in cell(row, renov_i)

    out: list = []
    for row in sales_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        if not is_signed(row):   # só vendas efetivamente assinadas
            continue
        email = norm(cell(row, sidx["email"]))
        phone = phone_digits(cell(row, sidx["phone"]))
        idx = by_email.get(email) if email else None
        if idx is None and phone:
            idx = by_phone.get(phone)
        d = sale_date(row)
        if d and d[5:7] == "08" and is_renewal(row):
            # Renovação (não venda nova): não pode inflar o mês de agosto —
            # reclassificada para 31/07 do mesmo ano (pedido do cliente).
            d = f"{d[:4]}-07-31"
        sale = {
            "d": d,
            "vendas": 1,
            "fat": to_float(cell(row, sidx["fat"])),
            "caixa": to_float(cell(row, sidx["caixa"])),
        }
        if idx is not None:
            l = leads[idx]
            sale["funil"] = l["funil"]
            sale["temp"] = l["temp"]
            sale["src"] = l["src"]
            if l["src"] in ("meta", "google"):   # venda de tráfego PAGO
                sale.update(attributed=True, camp=l["camp"], adset=l["adset"], ad=l["ad"])
            else:                                 # lead orgânico -> só na Visão Geral
                sale.update(attributed=False, camp=None, adset=None, ad=None)
        else:                                     # sem lead correspondente
            sale.update(funil=None, temp="—", src="none",
                        attributed=False, camp=None, adset=None, ad=None)
        out.append(sale)
    return out


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

    # Perguntas do formulário com VARIANTES por funil (APD-BR / APD-MUNDO / DIAG):
    # coletamos todas as colunas casadas e usamos o 1º valor não-vazio por lead.
    lhdr = lheader
    IDX_PAIS = find_indices(lhdr, ["país", "em qual país você mora atualmente"])
    IDX_ESTADO = find_indices(lhdr, ["estado"])
    IDX_MOMENTO = find_indices(lhdr, [
        "qual é o seu momento profissional atual",
        "em qual situação profissional você está hoje",
        "hoje, como você atua profissionalmente"])
    IDX_EXP = find_indices(lhdr, [
        "você já tem experiência com terapias",
        "você tem alguma formação ou curso na área de desenvolvimento humano"])
    IDX_RESULTADO = find_indices(lhdr, ["qual é o principal resultado que você quer alcançar"])
    IDX_INVESTIR = find_indices(lhdr, ["você estaria disposta a investir neste momento"])
    IDX_RETORNO = find_indices(lhdr, [
        "quanto você acredita que pode multiplicar",
        "qual nível de resultado financeiro você acredita ser possível"])
    IDX_LEADSCORE = find_indices(lhdr, ["leadscore"])
    IDX_RENDA = find_indices(lhdr, [
        "renda mensal familiar",
        "na moeda do seu país, qual é a sua renda mensal",
        "renda mensal individual"])

    def clean_txt(v):
        return v.strip() if v and v.strip() else "Sem resposta"

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
        # Faixa de renda UNIFICADA (6.4a): coalesce das colunas de renda (familiar /
        # moeda do país / individual) — evita faixa em branco/dividida entre funis.
        renda_raw = coalesce(row, IDX_RENDA)
        raw_email = norm(cell(row, lidx["email"]))
        raw_phone = phone_digits(cell(row, lidx["phone"]))
        leadscore = coalesce(row, IDX_LEADSCORE).strip().upper()[:1] or "—"
        leads.append({
            "d": parse_date(cell(row, lidx["created"])),
            "src": src,
            "plat": platform or "—",
            "camp": campaign or "(sem campanha)",
            "adset": cell(row, lidx["adset_name"]) or "(sem conjunto)",
            "ad": cell(row, lidx["ad_name"]) or "(sem anúncio)",
            "prof": (cell(row, lidx["profession"]) or "Sem resposta").replace("_", " ").capitalize(),
            "bucket": pretty_bucket(renda_raw),
            # respostas do formulário (coalescidas por funil) — aba Distribuição de leads
            "pais": clean_txt(coalesce(row, IDX_PAIS)),
            "estado": clean_txt(coalesce(row, IDX_ESTADO)),
            "momento": clean_txt(coalesce(row, IDX_MOMENTO)),
            "exp": clean_txt(coalesce(row, IDX_EXP)),
            "resultado": clean_txt(coalesce(row, IDX_RESULTADO)),
            "investir": clean_txt(coalesce(row, IDX_INVESTIR)),
            "retorno": clean_txt(coalesce(row, IDX_RETORNO)),
            "leadscore": leadscore,
            "q": 1 if is_qualified(cell(row, lidx["qlf"]), cell(row, lidx["score"])) else 0,
            "utm": 1 if valid_utm(campaign) else 0,
            "nm": first_last_initial(cell(row, lidx["name"])),
            "em": mask_email(cell(row, lidx["email"])),
            "ph": mask_phone(cell(row, lidx["phone"])),
            "funil": funil,
            "temp": classify_temp(campaign),
            "agd": 1 if norm(cell(row, lidx["status"])) == "scheduled" else 0,
            "_email": raw_email, "_phone": raw_phone,  # só para build_sales(); removidos antes do JSON final
        })

    # Vendas: lista própria (1 registro por venda assinada) com data da venda e
    # atribuição de funil/campanha herdada do lead casado. NÃO mais somada no
    # lead — a agregação no navegador cruza leads + sales por data/dimensão.
    sales = build_sales(leads, sales_rows or [])
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
            "meta_cpagd": META_CPAGD,
            "meta_cac": META_CAC,
            "volume_min_amostral": VOLUME_MIN_AMOSTRAL,
            # opções do dropdown de funil (Visão Geral Total / filtro global)
            "funis": ["APD-BR", "APD-MUNDO", "DIAG"],
        },
        "leads": leads,
        "meta": meta,
        # Vendas (Compradores) — registros próprios com data da venda + atribuição.
        "sales": sales,
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
    sv = data["sales"]
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo : {b['date_min']} -> {b['date_max']}", file=sys.stderr)
    print(f"  leads   : {len(data['leads'])}  MQLs qualificados: {q}", file=sys.stderr)
    print(f"  meta    : {len(data['meta'])} linhas", file=sys.stderr)
    print(f"  vendas  : {len(sv)} (tráfego pago: {sum(1 for s in sv if s['attributed'])})", file=sys.stderr)
    print(f"  out     : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
