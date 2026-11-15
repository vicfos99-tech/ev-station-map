#!/usr/bin/env bash
# 커밋된 것을 GitHub(vicfos99-tech/ev-station-map)에 올린다. 저장소 루트에서:  bash tools/push.sh
#
# - Claude 가 도는 원격 PC 에서 쓴다. 이 PC 에는 묘성 계정 로그인이 없어서, 이 저장소 전용 배포 키(SSH)로 올린다.
#   키: ~/.ssh/ev_station_map_deploy (비밀 키는 이 PC 에만). 공개 키는 GitHub 저장소 Settings → Deploy keys 에
#   '쓰기 허용'으로 등록돼 있어야 한다. 거기서 지우면 바로 막힌다.
# - 묘성 PC 에서는 이 스크립트 말고 그냥 `git push` 를 쓴다(거기는 로그인이 저장돼 있다).
# - 올리기 전에: 커밋 안 된 변경이 없는지, 올라갈 파일에 키·토큰이 없는지 확인한다. 걸리면 올리지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${EV_DEPLOY_KEY:-$HOME/.ssh/ev_station_map_deploy}"
REMOTE_SSH="git@github.com:vicfos99-tech/ev-station-map.git"
REMOTE_HTTPS="https://github.com/vicfos99-tech/ev-station-map.git"
BRANCH="master"

[ -f "$KEY" ] || { echo "배포 키가 없다: $KEY"; exit 2; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || { echo "$BRANCH 브랜치가 아니다."; exit 2; }
if [ -n "$(git status --porcelain)" ]; then
  echo "커밋 안 된 변경이 있다. 먼저 커밋한다:"; git status --short | head -20; exit 2
fi

# 비밀값 검사: 환경변수에 든 키 값, 키처럼 생긴 글자가 추적 중인 파일에 있으면 멈춘다(값은 찍지 않는다)
py tools/check_secrets.py

export GIT_SSH_COMMAND="ssh -i \"$KEY\" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
git push "$REMOTE_SSH" "$BRANCH:$BRANCH"
# 이 PC 의 origin/master 표시도 맞춰 둔다(공개 저장소라 로그인 없이 받아진다)
unset GIT_SSH_COMMAND
git fetch -q "$REMOTE_HTTPS" "$BRANCH:refs/remotes/origin/$BRANCH" || echo "(origin/$BRANCH 표시 갱신은 실패. 올리기는 됐다)"
echo "올림: $(git log --oneline -1)"
echo "웹페이지는 1~2분 뒤 바뀐다: https://vicfos99-tech.github.io/ev-station-map/"
