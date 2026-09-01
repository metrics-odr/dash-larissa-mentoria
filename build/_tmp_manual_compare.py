#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script temporário (roda 1x via GitHub Actions, que tem acesso a docs.google.com)
para comparar a atribuição AUTOMÁTICA de vendas de Agosto/2026 (build_sales() em
build.py, cruzando Compradores x Leads por e-mail) com a lista de trackeamento
MANUAL levantada pela estrategista (planilha separada, aba "Agosto").

Não é parte do pipeline do dashboard — apagar depois de usar.
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B  # noqa: E402

MANUAL = json.loads(sys.stdin.read())


def build_sales_with_email(leads, sales_rows):
    """Cópia de build.build_sales() mas mantendo o e-mail no registro de saída,
    só para cruzar com a lista manual (a versão de produção mascara e-mail)."""
    if not sales_rows:
        return []
    sheader = sales_rows[0]
    sidx = B.header_index(
        sheader,
        {"date": ["data_envio", "data formatada", "data"], "email": ["email"], "phone": ["telefone"],
         "caixa": ["caixavenda"], "fat": ["faturamentovenda"], "contr": ["contratante"],
         "renov": ["renovacao", "renovação"]},
        {"date": 0, "email": 4, "phone": 9, "caixa": 10, "fat": 11, "contr": None, "renov": None},
    )

    def older(idx_a, idx_b):
        da, db = leads[idx_a]["d"] or "9999", leads[idx_b]["d"] or "9999"
        return idx_a if da <= db else idx_b

    by_email, by_phone = {}, {}
    for i, l in enumerate(leads):
        if l["_email"]:
            by_email[l["_email"]] = i if l["_email"] not in by_email else older(by_email[l["_email"]], i)
        if l["_phone"]:
            by_phone[l["_phone"]] = i if l["_phone"] not in by_phone else older(by_phone[l["_phone"]], i)

    contr_i = sidx.get("contr")
    date_idxs = B.find_indices(sheader, ["data_envio", "data formatada"]) or (
        [sidx["date"]] if sidx.get("date") is not None else [])

    def sale_date(row):
        for i in date_idxs:
            d = B.parse_date(B.cell(row, i))
            if d:
                return d
        return None

    def is_signed(row):
        if contr_i is None:
            return True
        v = B.norm(B.cell(row, contr_i))
        if any(n in v for n in ("nao", "cancel", "distrat", "reembol", "estorn", "false")):
            return False
        return ("assinou" in v or "assinad" in v or v in ("true", "sim", "1", "verdadeiro", "x"))

    renov_i = sidx.get("renov")

    def is_renewal(row):
        if renov_i is None:
            return False
        v = B.norm(B.cell(row, renov_i))
        return v in ("true", "sim", "1", "verdadeiro", "x", "✅") or "✅" in B.cell(row, renov_i)

    out = []
    for row in sales_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        if not is_signed(row):
            continue
        email = B.norm(B.cell(row, sidx["email"]))
        phone = B.phone_digits(B.cell(row, sidx["phone"]))
        idx = by_email.get(email) if email else None
        if idx is None and phone:
            idx = by_phone.get(phone)
        d = sale_date(row)
        if d and d[5:7] == "08" and is_renewal(row):
            d = f"{d[:4]}-07-31"
        sale = {
            "email": email,
            "d": d, "dl": d, "vendas": 1,
            "fat": B.to_float(B.cell(row, sidx["fat"])),
            "caixa": B.to_float(B.cell(row, sidx["caixa"])),
            "matched_lead": idx is not None,
        }
        if idx is not None:
            l = leads[idx]
            sale["dl"] = l["d"] or d
            sale["funil"] = l["funil"]
            sale["temp"] = l["temp"]
            sale["src"] = l["src"]
            if l["src"] in ("meta", "google"):
                sale.update(attributed=True, camp=l["camp"], adset=l["adset"], ad=l["ad"])
            else:
                sale.update(attributed=False, camp=None, adset=None, ad=None)
        else:
            sale.update(funil=None, temp="—", src="none", attributed=False, camp=None, adset=None, ad=None)
        out.append(sale)
    return out


def main():
    leads_rows = B.fetch_csv(B.EXPORT_URL.format(sid=B.SPREADSHEET_ID, gid=B.GID_LEADS))
    meta_rows = B.fetch_csv(B.EXPORT_URL.format(sid=B.SPREADSHEET_ID, gid=B.GID_META))
    sales_rows = B.fetch_csv(B.EXPORT_URL.format(sid=B.SPREADSHEET_ID, gid=B.GID_SALES))

    lheader = leads_rows[0] if leads_rows else []

    # process() já apaga _email/_phone do dict final, então refazemos a leitura
    # de leads aqui (mesma lógica de build.process()) mantendo esses campos.
    lidx2 = B.header_index(
        lheader,
        {"created": ["enviado as", "enviado", "data ajustada", "created_time", "data", "created"],
         "ad_name": ["utm_content", "ad_name"], "adset_name": ["utm_medium", "adset_name"],
         "campaign": ["utm_campaign", "campaign_name"], "formulario": ["formulario"],
         "is_organic": ["is_organic"], "platform": ["utm_source", "platform"],
         "status": ["status da resposta"], "qlf": ["qualificacao"], "score": ["score"],
         "email": ["e-mail", "email"], "phone": ["whatsapp", "phone_number", "phone", "telefone"]},
        {"created": 4, "ad_name": 14, "adset_name": 12, "campaign": 13, "is_organic": None,
         "platform": 11, "formulario": 0, "status": 6, "qlf": None, "score": 16, "email": 8, "phone": 9},
    )
    leads2 = []
    for row in leads_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        if B.is_test_lead(" ".join(str(c) for c in row)):
            continue
        platform = B.norm(B.cell(row, lidx2["platform"]))
        campaign = B.cell(row, lidx2["campaign"])
        organic = B.norm(B.cell(row, lidx2["is_organic"])) in ("true", "1", "sim", "verdadeiro") or platform in ("organico", "organic", "")
        formulario = B.cell(row, lidx2["formulario"])
        funil = B.classify_funil(campaign, formulario, organic)
        if funil is None:
            continue
        if organic:
            src = "org"
        elif B.norm(campaign).startswith("goog") or platform in ("google", "youtube"):
            src = "google"
        elif platform in ("ig", "fb", "instagram", "facebook") or campaign:
            src = "meta"
        else:
            src = "outros"
        leads2.append({
            "d": B.parse_date(B.cell(row, lidx2["created"])),
            "src": src,
            "camp": campaign or "(sem campanha)",
            "adset": B.cell(row, lidx2["adset_name"]) or "(sem conjunto)",
            "ad": B.cell(row, lidx2["ad_name"]) or "(sem anúncio)",
            "funil": funil,
            "temp": B.classify_temp(campaign),
            "_email": B.norm(B.cell(row, lidx2["email"])),
            "_phone": B.phone_digits(B.cell(row, lidx2["phone"])),
        })

    sales_e = build_sales_with_email(leads2, sales_rows)
    sales_aug = [s for s in sales_e if s["d"] and s["d"][:7] == "2026-08"]

    by_email_sale = {}
    for s in sales_aug:
        by_email_sale.setdefault(s["email"], []).append(s)

    by_email_all_sales = {}
    for s in sales_e:
        by_email_all_sales.setdefault(s["email"], []).append(s)

    manual_matches = []
    for m in MANUAL:
        em = m["email"]
        found = by_email_sale.get(em, [])
        found_any_month = by_email_all_sales.get(em, [])
        manual_matches.append({
            "manual": m,
            "auto_sales_aug": found,
            "auto_sales_any_month": found_any_month,
        })

    # spend por campanha em agosto (Meta Ads)
    spend_by_camp = {}
    midx = B.header_index(
        meta_rows[0] if meta_rows else [],
        {"day": ["day", "data"], "campaign": ["campaign name", "campaign"], "spent": ["amount spent", "valor gasto", "gasto"]},
        {"day": 0, "campaign": 1, "spent": 4},
    )
    for row in meta_rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        d = B.parse_date(B.cell(row, midx["day"]))
        if not d or d[:7] != "2026-08":
            continue
        camp = B.cell(row, midx["campaign"]) or "(sem campanha)"
        spend_by_camp[camp] = spend_by_camp.get(camp, 0.0) + B.to_float(B.cell(row, midx["spent"]))

    print("===RESULT_JSON_START===")
    print(json.dumps({
        "n_sales_aug_total": len(sales_aug),
        "n_sales_aug_attributed": sum(1 for s in sales_aug if s.get("attributed")),
        "manual_matches": manual_matches,
        "spend_by_camp_aug": spend_by_camp,
    }, ensure_ascii=False))
    print("===RESULT_JSON_END===")


if __name__ == "__main__":
    main()
