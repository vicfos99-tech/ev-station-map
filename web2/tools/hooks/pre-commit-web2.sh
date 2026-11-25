#!/bin/sh
# web2 커밋 전 걸쇠: 이번 커밋에 web2 아래 파일이 있으면 기계 검사 네 가지를 돌린다. 실패면 커밋을 막는다.
# 저장소 맨 위에서 git 이 부른다. 설치: node web2/tools/install_hook.mjs (web2/tools/README.md)
HERE_DIR=$(dirname "$0")
TOOLS_DIR=$(cd "$HERE_DIR/.." && pwd)
APP_DIR=$(cd "$TOOLS_DIR/.." && pwd)
APP_REL=$(cd "$APP_DIR" && git rev-parse --show-prefix)
if git -c core.quotepath=false diff --cached --name-only | grep -q "^$APP_REL"; then
  echo "[web2 걸쇠] 기계 검사 네 가지를 돌립니다"
  node "$TOOLS_DIR/check4.mjs" || { echo "[web2 걸쇠] 기계 검사 실패 — 커밋을 막습니다"; exit 1; }
fi
exit 0
