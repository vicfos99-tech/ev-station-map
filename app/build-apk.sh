#!/usr/bin/env bash
# 테스트용(디버그) APK 만들기. 저장소 루트에서:  bash app/build-apk.sh
# 안드로이드 빌드 도구는 경로에 한글이 있으면 거부해서(10_프로젝트), 영어 경로로 복사해 빌드하고 APK 만 가져온다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="${EV_BUILD_DIR:-$LOCALAPPDATA/ev-charge-build}"
export JAVA_HOME="${JAVA_HOME:-C:/Program Files/Android/openjdk/jdk-21.0.8}"

node "$ROOT/web/build.js"
node "$HERE/copy-web.js"
(cd "$HERE" && npx cap sync android)

mkdir -p "$BUILD"
# 빌드 결과·gradle 캐시는 빼고 복사(robocopy: 0~7 은 성공)
robocopy "$(cygpath -w "$HERE")" "$(cygpath -w "$BUILD/app")" //MIR //NFL //NDL //NJH //NJS //NP \
  //XD build .gradle .idea //XF "*.apk" > /dev/null || [ $? -lt 8 ]

(cd "$BUILD/app/android" && ./gradlew.bat assembleDebug --no-daemon -q)

mkdir -p "$HERE/dist"
cp "$BUILD/app/android/app/build/outputs/apk/debug/app-debug.apk" "$HERE/dist/충전길잡이-test.apk"
ls -l "$HERE/dist/충전길잡이-test.apk"
