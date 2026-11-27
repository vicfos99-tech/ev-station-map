#!/bin/sh
# web2 커밋 전 걸쇠: 이번 커밋에 web2 아래 파일이 있으면 기계 검사 다섯 가지(check4)와 원칙 점검(스크립트 점검 — 바뀐 파일만)을 돌린다.
# 기계 검사가 실패면 커밋을 막는다. 원칙 점검은 설정 block_on_fail(tools/config_principles.json — 지금 켜짐)이면 위반 때 끝 코드 1 이라 막고, 꺼져 있으면 알림만 남긴다.
# 같은 곳이 세 번 연달아 막히면 원칙 점검이 텔레그램으로 묻는다(설정 stuck — 그 곳이 든 커밋만 계속 막힘). 판단 점검은 여기서 돌리지 않는다(커밋 뒤 걸쇠, 막지 않음).
# 저장소 맨 위에서 git 이 부른다. 설치: node web2/tools/install_hook.mjs (web2/tools/README.md)
HERE_DIR=$(dirname "$0")
TOOLS_DIR=$(cd "$HERE_DIR/.." && pwd)
APP_DIR=$(cd "$TOOLS_DIR/.." && pwd)
APP_REL=$(cd "$APP_DIR" && git rev-parse --show-prefix)
if git -c core.quotepath=false diff --cached --name-only | grep -q "^$APP_REL"; then
  echo "[web2 걸쇠] 기계 검사 다섯 가지를 돌립니다"
  node "$TOOLS_DIR/check4.mjs" || { echo "[web2 걸쇠] 기계 검사 실패 — 커밋을 막습니다"; exit 1; }
  echo "[web2 걸쇠] 원칙 점검(바뀐 파일)을 돌립니다"
  node "$TOOLS_DIR/principles_run.mjs" check --staged || { echo "[web2 걸쇠] 원칙 점검 실패 — 커밋을 막습니다"; exit 1; }
fi
exit 0
