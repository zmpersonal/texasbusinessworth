#!/usr/bin/env python3
"""Create random campaign tokens, D1 import SQL, and email links from a prospect CSV.

Input CSV columns:
company_name,industry_label,sector,naics,metro
"""
import csv, secrets, sys
from pathlib import Path

if len(sys.argv) < 4:
    raise SystemExit("Usage: python scripts/make_campaign_links.py prospects.csv CAMPAIGN_ID https://texasbusinessworth.com")

src = Path(sys.argv[1])
campaign_id = sys.argv[2]
base_url = sys.argv[3].rstrip('/')
out_csv = src.with_name(src.stem + '-email-links.csv')
out_sql = src.with_name(src.stem + '-campaign.sql')

def sql(v):
    return "'" + str(v or '').replace("'", "''") + "'"

rows=[]
with src.open(newline='', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        token=secrets.token_urlsafe(24)
        row['token']=token
        row['valuation_url']=f"{base_url}/?t={token}"
        rows.append(row)

fields=['company_name','industry_label','sector','naics','metro','token','valuation_url']
with out_csv.open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows({k:r.get(k,'') for k in fields} for r in rows)

with out_sql.open('w',encoding='utf-8') as f:
    f.write(f"INSERT OR IGNORE INTO campaigns (id,name,source) VALUES ({sql(campaign_id)},{sql(campaign_id)},'cold_email');\n")
    for r in rows:
        vals=[r['token'],campaign_id,r.get('company_name',''),r.get('industry_label',''),r.get('sector','other'),r.get('naics',''),r.get('metro','texas_other')]
        f.write("INSERT INTO campaign_links (public_token,campaign_id,company_name,industry_label,sector,naics,metro) VALUES (" + ','.join(sql(v) for v in vals) + ");\n")

print(f"Created {out_csv}")
print(f"Created {out_sql}")
