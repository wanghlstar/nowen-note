#!/bin/bash
# =============================================================================
# upgrade-official.sh — 升级到官方新版本并保留 macOS 修复补丁
#
# 为什么需要：应用内"检查更新"（electron-updater）会把 /Applications 下的
# Nowen Note.app 覆盖成官方原版，macOS 侧栏/红绿灯修复全部丢失；
# 且修复的一半改动在编译后的 JS 里，无法往官方安装包内打补丁。
# 唯一能保留修复的路径：源码升级 + 补丁重放 + 自己重新打包。
#
# 用法：
#   ./scripts/upgrade-official.sh              # 升级到最新官方 tag
#   ./scripts/upgrade-official.sh v1.5.2       # 升级到指定 tag
#   ./scripts/upgrade-official.sh --no-build   # 只切代码+打补丁，不打包
#
# 流程：检查工作树 -> 拉取 tag -> 切分支 -> 重放补丁 -> 构建 -> 询问覆盖安装
# =============================================================================
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "x 不在 git 仓库内，请在仓库任意目录下运行本脚本"
  exit 1
}
cd "$ROOT"

BUILD=1
TAG=""
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) TAG="$arg" ;;
  esac
done

step() { echo ""; echo "==> $*"; }
die()  { echo "x $*"; exit 1; }

# ---------- 0. git 锁处理（编辑器 git 集成会周期性留下死锁） ----------
# 覆盖三类锁：.git/index.lock、.git/refs/**/*.lock（fetch tag 时）、.git/*.lock。
# 判活标准：锁文件大小在 2 秒内无变化 = 死锁（进程已死），可删；
#           大小在增长 = 活跃进程，继续等，最多 60 秒。
clear_git_locks() {
  local i sz1 sz2 lock
  for i in $(seq 1 30); do
    locks=$(ls -d .git/index.lock .git/*.lock .git/refs/tags/*.lock .git/refs/heads/*.lock 2>/dev/null || true)
    [ -z "$locks" ] && return 0
    busy=0
    for lock in $locks; do
      [ -f "$lock" ] || continue
      sz1=$(stat -f%z "$lock" 2>/dev/null || echo 0)
      sleep 2
      sz2=$(stat -f%z "$lock" 2>/dev/null || echo 0)
      if [ "$sz1" != "$sz2" ]; then
        busy=1   # 还在写，是活跃进程
      else
        echo "   清理死锁 $lock（无活跃 git 进程，大小 ${sz1}B 不再变化）"
        rm -f "$lock"
      fi
    done
    [ "$busy" = "0" ] && return 0
  done
  return 1
}

# fetch 加重试：大对象传输期间锁可能随时插入，单次失败清锁后续传
fetch_tags() {
  local n
  for n in 1 2 3; do
    if git fetch --tags origin 2>&1 | grep -q "fatal\|error:"; then
      echo "   fetch 第 $n 次遇到锁/错误，清理后重试..."
      clear_git_locks || true
      sleep 2
    else
      return 0
    fi
  done
  git fetch --tags origin 2>&1 | tail -3
}

# ---------- 1. 前置检查 ----------
step "检查工作树状态"
clear_git_locks || die "git 锁被活跃进程持有超过 60 秒，请稍后再试"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "!! 工作树有未提交的改动："
  git status --short
  die "请先 commit 或 stash，再运行本脚本（避免升级时丢改动）"
fi
echo "OK 工作树干净"

# ---------- 2. 拉取官方 tag ----------
step "从官方仓库拉取 tag"
fetch_tags || die "git fetch 失败，请检查网络/代理后重试"

if [ -z "$TAG" ]; then
  TAG=$(git tag --sort=-v:refname | head -1)
  [ -n "$TAG" ] || die "没有找到任何 tag"
  echo "最新官方版本: $TAG"
else
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "本地没有 tag $TAG（git fetch 后仍找不到）"
fi

CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
[ -n "$CURRENT" ] || CURRENT="unknown"
if [ "$CURRENT" = "$TAG" ]; then
  echo "当前已在 $TAG"
else
  echo "当前版本: $CURRENT -> 目标: $TAG"
fi

# 本地领先目标 tag 的提交不会自动带到新分支，列出来提醒
AHEAD=$(git log --oneline "$TAG"..HEAD 2>/dev/null || true)
if [ -n "$AHEAD" ]; then
  echo ""
  echo "!! 本地有 $(echo "$AHEAD" | wc -l | tr -d ' ') 个提交不在 $TAG 中（切分支后不会带过去）："
  echo "$AHEAD" | sed 's/^/     /'
  echo "   （macOS 修复 commit 无需理会——新分支会由补丁脚本重放；"
  echo "    其他本地提交如需保留，升级后执行：git cherry-pick <commit>）"
  printf "   继续？[y/N] "
  read -r go || go="n"
  [ "$go" = "y" ] || [ "$go" = "Y" ] || die "已取消"
fi

# ---------- 3. 切换分支（带补丁的本地分支，避免 detached HEAD 丢改动） ----------
BRANCH="macos-fix-${TAG}"
step "切换到 $TAG（本地分支 $BRANCH）"
clear_git_locks || true
if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null; then
  git checkout "$BRANCH" || die "切换分支失败"
else
  git checkout -b "$BRANCH" "$TAG" || die "创建分支失败"
fi

# ---------- 4. 重放 macOS 修复补丁 ----------
step "重放 macOS 修复补丁"
./scripts/apply-macos-fix.sh || die "补丁重放失败，请按上面提示手动处理后再继续"

# ---------- 5. 构建 ----------
if [ "$BUILD" = "1" ]; then
  step "构建（backend + frontend + electron 打包，约 20 分钟）"
  npm run electron:build || die "构建失败"
else
  step "跳过构建（--no-build）"
fi

# ---------- 6. 覆盖安装版 ----------
APP_SRC="$ROOT/dist-electron/mac-arm64/Nowen Note.app"
if [ -d "$APP_SRC" ] && [ "$BUILD" = "1" ]; then
  step "安装版更新"
  echo "  新构建: $APP_SRC"
  echo "  目标:   /Applications/Nowen Note.app（旧版将被替换，数据目录不受影响）"
  printf "  覆盖安装？[y/N] "
  read -r ans || ans="n"
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    rm -rf "/Applications/Nowen Note.app" || die "删除旧应用失败"
    cp -R "$APP_SRC" "/Applications/" || die "拷贝新应用失败"
    echo "OK 已覆盖安装，启动 /Applications/Nowen Note.app 即可"
  else
    echo "已跳过。稍后手动执行："
    echo "  rm -rf \"/Applications/Nowen Note.app\" && cp -R \"$APP_SRC\" /Applications/"
  fi
fi

# ---------- 7. 收尾提醒 ----------
step "完成"
cat <<'EOF'
后续注意：
  1) 新安装版已含修复；不要在应用内点"检查更新"——那会装回官方原版，
     修复再次丢失。下次升级继续用本脚本。
  2) 如果上游某天自己修了 macOS 布局问题（目前没有），补丁脚本会提示
     "已在当前代码中"或三方合并时自动跳过，届时可停用本套机制。
  3) 本分支的修复改动建议 commit 一下（git add -A && git commit），
     下次升级脚本会在此基础上继续。
EOF
exit 0
