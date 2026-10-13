#!/bin/bash
# =============================================================================
# apply-macos-fix.sh — 重放 macOS 侧栏/红绿灯本地修复补丁
#
# 用途：升级上游代码（git pull / merge / rebase）后运行本脚本，
#       重新应用 patches/macos-sidebar-trafficlight-fix.patch。
#       脚本是幂等的：改动已在则直接跳过，可反复运行。
#
# 补丁内容共 11 处改动（本次修复的全部）：
#   1. electron/main.js
#      trafficLightPosition: { x: 12, y: 22 } -> { x: 11, y: 14 }
#      （红绿灯回到 macOS 标准高度，整体左移 1px）
#   2. frontend/src/index.css
#      html[data-electron="darwin"] .nav-rail { padding-top: 56px -> 28px }
#      （导航栏图标随标题行消失而上移，避开红绿灯）
#   3. frontend/src/components/Sidebar.tsx
#      桌面端（rail 可见）不再渲染 <header>：
#      - 删除 useSiteSettings import / siteConfig 使用
#      - 删除标题 <span>{siteConfig.title || "nowen-note"}</span>
#      - <header> 包进条件渲染 {(variant !== "desktop" || railMode === "hidden") && (...)}
#      （header 的 border-b 分隔线不再直通顶端、从红绿灯下穿过——这是"别扭"的主因）
#   4. frontend/src/components/Sidebar.tsx
#      WorkspaceSwitcher（"我的笔记"）外层 div 在桌面端 rail 模式下
#      加 paddingTop: calc(var(--safe-area-top) + 60px)（工作区选择器下移，不与灯重叠）
#   5. frontend/src/index.css
#      .nav-rail 通高的 border-r 改为伪元素起画：
#      border-right-width: 0 + .nav-rail::after { top: 60px; right: 0; bottom: 0; width: 1px;
#      background: var(--color-border) }
#      （rail 右缘竖线不再从红绿灯底下穿过；灯底 52px + 8px 间隙 = 60px）
#   6. frontend/src/index.css
#      html[data-electron="darwin"][data-fullscreen="1"] .nav-rail::after { top: 0 }
#      （全屏时系统隐藏红绿灯，竖线恢复通高）
#   7. frontend/src/index.css
#      桌面端侧栏顶部补 drag region（伪元素，不占布局）：
#      [data-unified-sidebar][data-sidebar-variant="desktop"]::before
#      { position:absolute; top/left/right:0; height:52px; -webkit-app-region:drag }
#      （header 被移除后，原本由 header 承担的拖拽/双击最大化能力在此补回）
#   8. frontend/src/index.css
#      html[data-electron="darwin"] .nav-rail::before 同样补 drag region，height: 28px
#      （rail 顶部空白区也可拖动/双击；图标从 28px 起，不会被盖住）
#   9. frontend/src/index.css
#      html[data-electron="darwin"][data-fullscreen="1"] .nav-rail::before { height: 0 }
#      （全屏时灯区消失、rail 内容上移到 4px，拖拽区让位，否则盖住前几个图标）
#  10. frontend/src/index.css
#      main::before 去掉 pointer-events: none（原 28px 主区顶部 drag 区生效）
#      + main 内交互元素通配 no-drag：
#      main :is(button, a, input, select, textarea, [role="button"], [contenteditable="true"])
#      { -webkit-app-region: no-drag }
#      （编辑器顶栏那一行也能拖动/双击最大化；行内按钮靠通配规则保住点击）
#  11. frontend/src/components/Sidebar.tsx
#      WorkspaceSwitcher 容器桌面端 paddingLeft/paddingRight: 8px
#      （与下方"筛选…"输入框左对齐：知识树工具栏是 px-2=8px，本容器默认
#       px-3=12px 会让"我的笔记"框比筛选框偏右 4px）
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
grep -qF 'padding-top: 28px !important;' frontend/src/index.css && applied=$((applied+1))
grep -qF 'variant !== "desktop" || railMode === "hidden"' frontend/src/components/Sidebar.tsx && applied=$((applied+1))
grep -qF 'safe-area-top) + 60px' frontend/src/components/Sidebar.tsx && applied=$((applied+1))
grep -qF 'border-right-width: 0;' frontend/src/index.css && applied=$((applied+1))
grep -qF '.nav-rail::after' frontend/src/index.css && applied=$((applied+1))
grep -qF '[data-unified-sidebar][data-sidebar-variant="desktop"]::before' frontend/src/index.css && applied=$((applied+1))
grep -qF '.nav-rail::before' frontend/src/index.css && applied=$((applied+1))
grep -qF '[data-fullscreen="1"] .nav-rail::before' frontend/src/index.css && applied=$((applied+1))
grep -qF 'main :is(button, a, input, select, textarea, [role="button"], [contenteditable="true"])' frontend/src/index.css && applied=$((applied+1))
grep -qF 'paddingLeft: "8px"' frontend/src/components/Sidebar.tsx && applied=$((applied+1))

if [ "$applied" -eq 11 ]; then
  echo "OK 修复补丁已在当前代码中（11/11），无需重复应用。"
  exit 0
fi
echo "==> 检测到 $applied/11 处改动已存在，开始重放补丁..."

# ---------- 2. 应用补丁（干净应用优先，3way 兜底） ----------
ERR=$(mktemp)
if git apply --check "$PATCH" 2>"$ERR"; then
  git apply "$PATCH" && echo "OK git apply 成功"
elif git apply --3way "$PATCH" 2>>"$ERR"; then
  echo "OK git apply --3way 成功（上游代码有变动，已自动三方合并）"
else
  echo "x 补丁无法自动应用（上游改动较大）。git 输出："
  cat "$ERR"
  # --3way 失败时可能在文件里留下冲突标记，提醒清理
  if grep -rl '^<<<<<<<' electron/main.js frontend/src/index.css frontend/src/components/Sidebar.tsx 2>/dev/null; then
    echo ""
    echo "!! 上面列出的文件里残留了冲突标记（<<<<<<< / ======= / >>>>>>>），请手动解决后删掉标记。"
  fi
  echo ""
  echo "请手动完成以下 11 处修改（补丁的全部内容就是这些）："
  cat <<'EOF'
  1) electron/main.js 的 macWindowOpts 内：
       trafficLightPosition: { x: 11, y: 14 },
  2) frontend/src/index.css 的 html[data-electron="darwin"] .nav-rail 规则：
       padding-top: 28px !important;
  3) frontend/src/components/Sidebar.tsx：
       - 删除 import { useSiteSettings } from "@/hooks/useSiteSettings";
       - 删除 const { siteConfig } = useSiteSettings();
       - 删除标题 span：<span className="min-w-0 truncate text-sm font-semibold">{siteConfig.title || "nowen-note"}</span>
       - 把整个 <header>...</header> 包进条件渲染：
         {(variant !== "desktop" || railMode === "hidden") && (
           <header ...> ... </header>
         )}
  4) 同文件 WorkspaceSwitcher 外层 div，桌面端 rail 可见时加：
       style={{ paddingTop: "calc(var(--safe-area-top) + 60px)" }}
  5) frontend/src/index.css 追加（rail 右缘竖线改为伪元素起画，不从灯下穿过）：
       html[data-electron="darwin"] .nav-rail { position: relative; border-right-width: 0; }
       html[data-electron="darwin"] .nav-rail::after {
         content: ""; position: absolute; top: 60px; right: 0; bottom: 0;
         width: 1px; background: var(--color-border); pointer-events: none;
       }
  6) frontend/src/index.css 追加（全屏时系统隐藏红绿灯，竖线恢复通高）：
       html[data-electron="darwin"][data-fullscreen="1"] .nav-rail::after { top: 0; }
  7) frontend/src/index.css 追加（补回被移除的 header 所承担的拖拽/双击最大化）：
       html[data-electron="darwin"]
         [data-unified-sidebar][data-sidebar-variant="desktop"] { position: relative; }
       html[data-electron="darwin"]
         [data-unified-sidebar][data-sidebar-variant="desktop"]::before {
           content: ""; position: absolute; top: 0; left: 0; right: 0;
           height: 52px; -webkit-app-region: drag; z-index: 2;
         }
  8) 同文件追加（rail 顶部空白也可拖动/双击，图标从 28px 起不会被盖住）：
       html[data-electron="darwin"] .nav-rail::before {
         content: ""; position: absolute; top: 0; left: 0; right: 0;
         height: 28px; -webkit-app-region: drag; z-index: 2;
       }
  9) 同文件追加（全屏时灯区消失、rail 上移到 4px，拖拽区让位）：
       html[data-electron="darwin"][data-fullscreen="1"] .nav-rail::before { height: 0; }
 10) 同文件：main::before 规则里删掉 pointer-events: none 行（让 28px 主区顶部
     drag 区生效），并追加交互元素通配 no-drag（否则顶栏按钮全点不了）：
       html[data-electron="darwin"] main :is(button, a, input, select, textarea,
         [role="button"], [contenteditable="true"]) { -webkit-app-region: no-drag; }
 11) frontend/src/components/Sidebar.tsx：WorkspaceSwitcher 外层 div 的桌面端
     style 里，与 paddingTop 一起加 paddingLeft/paddingRight（与下方"筛选…"
     输入框左对齐，知识树工具栏是 px-2=8px）：
       style={variant === "desktop" && railMode !== "hidden" ? {
         paddingTop: "calc(var(--safe-area-top) + 60px)",
         paddingLeft: "8px", paddingRight: "8px",
       } : undefined}
EOF
  rm -f "$ERR"
  exit 1
fi
rm -f "$ERR"

# ---------- 3. 验证关键改动 ----------
echo "==> 验证关键改动："
fail=0
check() { # check <文件> <固定字符串> <说明>
  if grep -qF "$2" "$1"; then
    echo "  OK  $3"
  else
    echo "  x   $3（未找到预期内容）"
    fail=1
  fi
}
check electron/main.js 'trafficLightPosition: { x: 11, y: 14 }' "红绿灯位置 x:11 y:14"
check frontend/src/index.css 'padding-top: 28px !important;' "nav-rail 留白 28px"
check frontend/src/components/Sidebar.tsx 'variant !== "desktop" || railMode === "hidden"' "桌面端不渲染 header（去标题/去分隔线）"
check frontend/src/components/Sidebar.tsx 'safe-area-top) + 60px' "工作区选择器下移 60px"
check frontend/src/index.css 'border-right-width: 0;' "rail 去掉通高 border-r"
check frontend/src/index.css '.nav-rail::after' "竖线改伪元素起画（top:60px）"
check frontend/src/index.css '[data-unified-sidebar][data-sidebar-variant="desktop"]::before' "侧栏顶部补 drag region（可拖动/双击最大化）"
check frontend/src/index.css '.nav-rail::before' "rail 顶部补 drag region"
check frontend/src/index.css '[data-fullscreen="1"] .nav-rail::before' "全屏时 rail 拖拽区让位"
check frontend/src/index.css 'main :is(button, a, input, select, textarea, [role="button"], [contenteditable="true"])' "主区顶部 drag 区生效 + 交互元素通配 no-drag"
check frontend/src/components/Sidebar.tsx 'paddingLeft: "8px"' "我的笔记框与筛选框左对齐（8px）"
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
