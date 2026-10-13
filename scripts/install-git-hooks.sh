#!/bin/bash
# =============================================================================
# install-git-hooks.sh — 安装本地 git hooks，实现升级后自动重放修复补丁
#
# 安装两个 hook：
#   post-merge   git pull / git merge 之后自动运行
#   post-rewrite git rebase 之后自动运行
#
# 两者都会调用 scripts/apply-macos-fix.sh（幂等，安全）。
# 重新 clone 仓库后只需再跑一次本脚本即可恢复自动化。
# =============================================================================
set -eu

ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$ROOT/.git/hooks"

install_hook() {
  local name="$1"
  local path="$HOOKS_DIR/$name"
  cat > "$path" <<'EOF'
#!/bin/bash
# 升级代码后自动重放 macOS 修复补丁（scripts/apply-macos-fix.sh）
ROOT="$(git rev-parse --show-toplevel)"
if [ -x "$ROOT/scripts/apply-macos-fix.sh" ]; then
  "$ROOT/scripts/apply-macos-fix.sh" || echo "!! 修复补丁重放失败，请手动运行 scripts/apply-macos-fix.sh 查看原因"
fi
EOF
  chmod +x "$path"
  echo "OK 已安装 $path"
}

install_hook post-merge
install_hook post-rewrite

echo ""
echo "完成。今后执行 git pull / git merge / git rebase 后，"
echo "修复补丁会自动重放；如自动重放失败，手动运行："
echo "  ./scripts/apply-macos-fix.sh --build"
