#!/bin/sh
# web2 커밋 뒤 걸쇠: 방금 커밋에 web2 아래 파일이 있으면 판단 점검(점검 모델이 바뀐 파일만 읽음)을 뒤에서 따로 띄운다 — 커밋을 막지 않는다.
# 설정 judge.auto(tools/config_principles.json — 지금 켜짐)가 꺼져 있으면 모델을 부르지 않고 바로 끝난다(기록장에 한 줄). 하루 돈 한도(judge.daily_budget_usd)에 닿으면 그날은 부르지 않고 알리기만.
# 결과·알림은 판단 점검이 스스로 남긴다(tools/logs/원칙점검_judge.log · 알림 파일). 설치: node web2/tools/install_hook.mjs
HERE_DIR=$(dirname "$0")
TOOLS_DIR=$(cd "$HERE_DIR/.." && pwd)
APP_DIR=$(cd "$TOOLS_DIR/.." && pwd)
APP_REL=$(cd "$APP_DIR" && git rev-parse --show-prefix)
if git -c core.quotepath=false diff-tree --no-commit-id --name-only -r HEAD | grep -q "^$APP_REL"; then
  REV=$(git rev-parse HEAD)
  ( node "$TOOLS_DIR/principles_run.mjs" judge --commit "$REV" >/dev/null 2>&1 & )
fi
exit 0
