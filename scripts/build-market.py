"""stay-market-scan 집계(listings.json, dong_metrics.json)에서 김해·창원 매물과 동별 예약 지표만 추려 market.json 을 만든다.
사용: python scripts/build-market.py <stay-market-scan 경로 또는 listings.json 이 있는 집계 폴더> [--trend trend.json] [--status status.json]
--trend/--status 는 daily.py 가 넘긴다. 없으면 기존처럼 asof/dongs/listings 만 쓴다."""
import argparse
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("src")
p.add_argument("--trend", default=None)
p.add_argument("--status", default=None)
a = p.parse_args()

src = Path(a.src)
if not (src / "listings.json").exists():
    src = src / "data" / "agg"
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
if a.trend:
    data["trend"] = json.load(open(a.trend, encoding="utf-8"))
    data["trend"]["dongs"] = {k: v for k, v in data["trend"]["dongs"].items() if k in dongs}
if a.status:
    st = json.load(open(a.status, encoding="utf-8"))
    data["collect"] = {"lastRun": st.get("lastRun"), "lastSuccess": st.get("lastSuccess"), "error": st.get("error"),
                       "failed": [k for k, v in (st.get("steps") or {}).items() if not v.get("ok")]}
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
extra = (" trend" if a.trend else "") + (" collect" if a.status else "")
print(f"{out.name}: dongs {len(dongs)}, listings {len(rows)}, {out.stat().st_size // 1024} KB, asof {data['asof']}{extra}")
