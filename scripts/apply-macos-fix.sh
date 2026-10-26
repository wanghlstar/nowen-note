#!/bin/bash
# =============================================================================
# apply-macos-fix.sh — 重放 macOS 侧栏/红绿灯/全宽标题条本地修复补丁
#
# 用途：升级上游代码（git pull / merge / rebase）后运行本脚本，
#       重新应用 patches/macos-sidebar-trafficlight-fix.patch。
#       脚本是幂等的：改动已在则直接跳过，可反复运行。
#
# 当前修复内容（从 origin/main 到当前 HEAD 的全部 macOS 适配）：
#   A. electron/main.js
#      trafficLightPosition: { x: 11, y: 14 }
#   B. frontend/src/index.css + 各组件：侧栏/rail 与红绿灯视觉对齐、
#      全宽可拖拽标题条等。
#
# 幂等检测：下方 9 项标记全部命中即视为已应用。
#
# 用法：
#   ./scripts/apply-macos-fix.sh            # 只应用补丁
#   ./scripts/apply-macos-fix.sh --build    # 应用后自动重新构建前端
#
# 注意：electron/main.js 的改动必须完全退出并重启 App 才生效；
#       前端改动需要重新 build（--build 或 cd frontend && npx vite build）。
# =============================================================================
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "x 不在 git 仓库内，请在仓库任意目录下运行本脚本"
  exit 1
}
cd "$ROOT"

PATCH="patches/macos-sidebar-trafficlight-fix.patch"
[ -f "$PATCH" ] || { echo "x 找不到补丁文件 $PATCH"; exit 1; }

# ---------- 1. 已应用检测（幂等） ----------
applied=0
grep -qF 'trafficLightPosition: { x: 11, y: 14 }' electron/main.js && applied=$((applied+1))
grep -qF '.app-window-titlebar {' frontend/src/index.css && applied=$((applied+1))
grep -qF 'html[data-electron="darwin"] .app-window-titlebar {' frontend/src/index.css && applied=$((applied+1))
grep -qF 'html[data-electron="darwin"][data-fullscreen="1"] .app-window-titlebar {' frontend/src/index.css && applied=$((applied+1))
grep -qF 'padding-top: 0 !important;' frontend/src/index.css && applied=$((applied+1))
grep -qF 'app-window-titlebar items-center justify-center h-14 shrink-0' frontend/src/App.tsx && applied=$((applied+1))
grep -qF 'function DesktopWindowTitleBar()' frontend/src/App.tsx && applied=$((applied+1))
grep -qF 'paddingTop: "calc(var(--safe-area-top) + 0px)"' frontend/src/components/Sidebar.tsx && applied=$((applied+1))
grep -qF 'fixed left-3 top-14 z-[70] hidden md:block' frontend/src/components/NoteWorkspaceLayoutController.tsx && applied=$((applied+1))

TOTAL=9
if [ "$applied" -eq "$TOTAL" ]; then
  # 额外确认旧的 per-note 标题条确实已移除
  if grep -qF 'editor-window-titlebar' frontend/src/components/EditorPane.tsx; then
    echo "WARN 新标题条已就位，但 EditorPane.tsx 仍残留旧 editor-window-titlebar，建议清理。"
  fi
  echo "OK 修复补丁已在当前代码中（${applied}/${TOTAL}），无需重复应用。"
  exit 0
fi
echo "==> 检测到 $applied/$TOTAL 处改动已存在，开始重放补丁..."

# ---------- 2. 应用补丁（干净应用优先，3way 兜底） ----------
ERR="$(mktemp)"
if git apply --check "$PATCH" 2>"$ERR"; then
  git apply "$PATCH" && echo "OK git apply 成功"
elif git apply --3way "$PATCH" 2>>"$ERR"; then
  echo "OK git apply --3way 成功（上游代码有变动，已自动三方合并）"
else
  echo "x 补丁无法自动应用（上游改动较大）。git 输出："
  cat "$ERR"
  if grep -rl '^<<<<<<<' electron/main.js frontend/src/index.css frontend/src/App.tsx frontend/src/components/Sidebar.tsx frontend/src/components/EditorPane.tsx frontend/src/components/NoteWorkspaceLayoutController.tsx 2>/dev/null; then
    echo ""
    echo "!! 上面列出的文件里残留了冲突标记（<<<<<<< / ======= / >>>>>>>），请手动解决后删掉标记。"
  fi
  echo ""
  echo "请手动完成以下重构（补丁的全部内容就是这些，详见 patches/macos-sidebar-trafficlight-fix.patch）："
  echo "  1) electron/main.js: trafficLightPosition: { x: 11, y: 14 }"
  echo "  2) App.tsx: 根布局包 flex flex-col，顶部加 <DesktopWindowTitleBar />，内容包进 flex-1 min-h-0；新增 DesktopWindowTitleBar 组件渲染 .app-window-titlebar 居中 nowen note。"
  echo "  3) EditorPane.tsx: 删除打开笔记时才出现的 editor-window-titlebar 标题条 div。"
  echo "  4) index.css: 新增 .app-window-titlebar(darwin 下 drag + 高 56px，全屏隐藏)；撤销分散拖拽伪元素；.nav-rail padding-top 改 0；.nav-rail::after top 改 0。"
  echo "  5) Sidebar.tsx: 桌面端 WorkspaceSwitcher paddingTop 60px -> 0px（标题条已向下扩展并与卡片上沿对齐）。"
  echo "  6) NoteWorkspaceLayoutController.tsx: 布局浮层 portal top-2 -> top-14。"
  rm -f "$ERR"
  exit 1
fi
rm -f "$ERR"

# ---------- 3. 验证关键改动 ----------
echo "==> 验证关键改动："
fail=0
check() {
  if grep -qF "$2" "$1"; then
    echo "  OK  $3"
  else
    echo "  x   $3（未找到预期内容）"
    fail=1
  fi
}
check electron/main.js 'trafficLightPosition: { x: 11, y: 14 }' "红绿灯位置 x:11 y:14"
check frontend/src/index.css '.app-window-titlebar {' "全宽标题条根规则"
check frontend/src/index.css 'html[data-electron="darwin"] .app-window-titlebar {' "darwin 下显示 + 可拖拽/双击最大化"
check frontend/src/index.css 'html[data-electron="darwin"][data-fullscreen="1"] .app-window-titlebar {' "全屏隐藏标题条"
check frontend/src/index.css 'padding-top: 0 !important;' "nav-rail 留白 0"
check frontend/src/App.tsx 'app-window-titlebar items-center justify-center h-14 shrink-0' "标题条挂载点"
check frontend/src/App.tsx 'function DesktopWindowTitleBar()' "DesktopWindowTitleBar 组件"
check frontend/src/components/Sidebar.tsx 'paddingTop: "calc(var(--safe-area-top) + 0px)"' "我的笔记框与标题条下沿对齐"
check frontend/src/components/NoteWorkspaceLayoutController.tsx 'fixed left-3 top-14 z-[70] hidden md:block' "布局浮层避开标题条 top-14"
if [ "$fail" -ne 0 ]; then
  echo "x 有改动未生效，请检查 git diff 中的冲突标记后重跑本脚本。"
  exit 1
fi

# ---------- 4. 提示后续步骤 ----------
if [ "${1:-}" = "--build" ]; then
  echo "==> 重新构建前端..."
  ( cd frontend && npx vite build ) || { echo "x 前端构建失败"; exit 1; }
  echo ""
  echo "OK 全部完成。完全退出并重启 Nowen Note 后生效。"
else
  echo ""
  echo "接下来："
  echo "  1) cd frontend && npx vite build        # 重新构建前端（或加 --build 参数跑本脚本）"
  echo "  2) 完全退出 Nowen Note 再启动            # main.js 的灯位置必须重启进程才生效"
fi
exit 0
