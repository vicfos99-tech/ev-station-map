#!/usr/bin/env bash
# 실제 데이터 전체 다시 받기: 전국 급속(고속도로 근처) → 휴게소 노선(live.js) → 나들목 붙이기 → 빌드.
# 쓰는 법: bash tools/refresh_all.sh [전국 원본을 둘 파일]
# 키는 환경변수 또는 레지스트리(HKCU/Environment)에서 읽는다. 값은 찍지 않는다.
# 중간에 실패하면 web/live.js 를 받기 전 것으로 되돌린다.
set -u
cd "$(dirname "$0")/.."
RAW_DIR="../../30_자료/ev-charge"
OUT="${1:-$RAW_DIR/near_highway_fast_$(date +%m%d_%H%M).json}"
export PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1

getreg() { reg query "HKCU\\Environment" //v "$1" 2>/dev/null | awk -v k="$1" '$1==k{print $3}' | tr -d '\r'; }
[ -n "${EV_CHARGER_API_KEY:-}" ] || export EV_CHARGER_API_KEY="$(getreg EV_CHARGER_API_KEY)"
[ -n "${EX_API_KEY:-}" ] || export EX_API_KEY="$(getreg EX_API_KEY)"
[ -n "$EV_CHARGER_API_KEY" ] || { echo "EV_CHARGER_API_KEY 가 없다"; exit 1; }

cp web/live.js web/live.js.before_refresh
fail() { echo "[실패] $1 → live.js 를 되돌린다"; cp web/live.js.before_refresh web/live.js; exit 1; }

echo "[1/4] 전국 급속(고속도로 근처) 받기 → $OUT"
py tools/fetch_near_highway.py "$OUT" || fail "전국 급속 받기"
echo "[2/4] 휴게소 노선 만들기"
py tools/charger_api.py || fail "휴게소 받기"
echo "[3/4] 나들목 붙이기"
py tools/ic_nearby.py --ics "$RAW_DIR/ex_units.json" --osm "$RAW_DIR/osm_junctions.json" \
  --osm-ways "$RAW_DIR/osm_motorway_ways.json" --chargers "$OUT" || fail "나들목 붙이기"
echo "[4/4] 빌드"
node web/build.js || fail "빌드"
echo "[끝] last_end 가 든 충전기 수: $(grep -o '"last_end"' web/live.js | wc -l)"
