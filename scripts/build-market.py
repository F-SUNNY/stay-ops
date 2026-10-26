"""stay-market-scan 집계(listings.json, dong_metrics.json)에서 김해·창원 매물과 동별 예약 지표만 추려 market.json 을 만든다.
사용: python scripts/build-market.py <stay-market-scan 경로>"""
import json, sys
from pathlib import Path

src = Path(sys.argv[1]) / "data" / "agg"
out = Path(__file__).resolve().parent.parent / "market.json"
listings = json.load(open(src / "listings.json", encoding="utf-8"))
metrics = json.load(open(src / "dong_metrics.json", encoding="utf-8"))
CITIES = ("김해시", "창원시")

dongs = {}
for r in metrics["dongs"]:
    if not r["sggnm"].startswith(CITIES) or r["supply_total"] == 0:
        continue
    dongs[r["adm_cd2"]] = {
        "id": r["adm_cd2"], "name": r["adm_nm"].split()[-1], "sgg": r["sggnm"],
        "supply": {"33m2": r["supply_33m2"], "enko": r["supply_enko"], "zbstay": r["supply_zbstay"], "total": r["supply_total"]},
        "fee": {"33m2": r["median_monthly_fee_33m2"], "enko": r["median_monthly_fee_enko"], "zbstay": r["median_monthly_fee_zbstay"]},
        "occupied": {"33m2": r["occupied_ratio_33m2"], "enko": r["occupied_ratio_enko"], "zbstay": r["occupied_ratio_zbstay"]},
        "occ7d": {"33m2": r["occupancy_7d_33m2"], "zbstay": r["occupancy_7d_zbstay"]},
        "rate90": {"33m2": r["booking_rate_90d_33m2"], "zbstay": r["booking_rate_90d_zbstay"]},
        "reviews12m": r["reviews_12m_33m2"],
    }

KEEP = ["platform", "id", "adm_cd2", "name", "lat", "lng", "type", "monthly_fee", "weekly_fee", "mgmt_fee", "size", "rooms",
        "reviews_12m", "bookings", "occupied", "next_available", "booked_7d", "booked_90d", "discount", "url", "addr_lot"]
rows = [{k: l[k] for k in KEEP if k in l} for l in listings if l["adm_cd2"] in dongs]
for l in rows:
    for k in ("monthly_fee", "weekly_fee", "mgmt_fee"):
        if isinstance(l.get(k), float):
            l[k] = round(l[k])
data = {"asof": metrics["meta"]["asof"], "dongs": sorted(dongs.values(), key=lambda d: -d["supply"]["total"]), "listings": rows}
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{out.name}: dongs {len(dongs)}, listings {len(rows)}, {out.stat().st_size // 1024} KB, asof {data['asof']}")
