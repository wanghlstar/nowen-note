# Lite 实施规划与分工

> 配套文档：[产品分析与决策记录](./lite-mode-assessment.md)（D1-D11、W0-W7、验收标准）、[设计文档](./lite-mode-design.md)。本文定义轨道划分、Agent 编制、并行规则与里程碑。

## 1. 轨道划分（依赖图）

```
M0 基线 + 升级脚本完善 ─────────────────────────┐（前置，1-2 会话）
W0.5 冲突治理（backend/src/sync/）  ← 轨道1，无依赖
W1+W2+W3 裁剪（frontend/ + backend/） ← 轨道2，依赖 M0
W4 Tauri（tauri/ 新目录）           ← 轨道3，脚手架零重叠可即启
W5-W7 Android/CI/验收              ← 收尾，依赖轨道2/3产物
```

三条轨道目录所有权不重叠（`backend/src/sync/` vs `frontend/src`+`backend/src/routes/` vs `tauri/`），可并行；W1 与 W3 同属前端，由同一 Agent 顺序做。

## 2. Agent 编制（4 个干活单元）

| 单元 | 载体 | 职责 | 产出 | 会话估计 |
| --- | --- | --- | --- | --- |
| **Agent-0** | 主会话（我） | W0.5 冲突调查与修复；所有轨道集成、审查、验收门；文档维护 | 冲突修复 + 合并后的 `feat/lite` | 2-5 + 集成 2-4 |
| **Agent-A** | 子代理，worktree `wt-trim` | W1 前端裁剪 → W2 后端裁剪 → W3 构建开关，按注册表实施 | PR 到 `feat/lite` | 3-6 |
| **Agent-C** | 子代理，worktree `wt-tauri` | W4 Tauri 2 工程：sidecar、插件映射、updater、三平台打包 | `tauri/` 可安装产物 | 6-12 |
| **Agent-D** | 子代理，只读 | 测绘 260 组件 + 60 路由文件，填充 `featureRegistry.ts`；编写 W7 验收用例 | 注册表 + 测试用例 | 1-2 |

**为什么是 3 个子代理而不是更多**：每个子代理需要精确简报（不共享我的上下文），产出必须经我验证后才能合并——审查是串行的；超过 3 个并发，集成与审查成本会吃掉并行收益。Agent-D 只读，零冲突风险，随时可加。

## 3. Worktree 与分支布局

```
fork: wanghlstar/nowen-note
  main        跟踪官方（GitHub Sync fork 或 fetch origin）
  macos-fix   个人基线：顶部栏风格 + 工具提交（已推送，12 commits）
  feat/lite   Lite 开发线，从 macos-fix 切出，稳定后合回 macos-fix
本地：
  nowen-note/       主工作树（Agent-0，W0.5）
  ../nowen-wt-trim/ git worktree（Agent-A）
  ../nowen-wt-tauri/git worktree（Agent-C）
```

并行规则：
- 每个 worktree 只归一个 Agent，Git 操作互不交叉
- 子代理每个会话结束推送自己的分支；集成由 Agent-0 在每日窗口统一 review + merge，冲突在集成点解决，不在轨道内
- 任何轨道不得改 `docs/lite-mode-*.md`（文档归 Agent-0）
- 用户验收节点错峰：不和两个轨道同时交验

## 4. 里程碑

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| M0 | 基线决策（A/B）+ `upgrade-official.sh` 完善 | 脚本修复项合入；基线确定 |
| M1 | W0.5 冲突根因定位 + 修复 + 回归 | 冲突复现用例转通过；CJK 用例通过 |
| M2 | profile 裁剪完成（W1-W3） | lite 包无 P1 入口/chunk；完整模式回归不劣化 |
| M3 | Tauri 三平台可安装 | 本地编辑→离线→联网同步→第二设备读取全通过 |
| M4 | lite 发布候选（W5-W7） | 验收标准 1-6 全过；发布物料就绪 |

## 5. 用户参与节点（不可代理）

1. **基线决策**（M0）：A=旧基线即开工 / B=先重放补丁到 v1.5.3
2. **UI 验收**：Lite 界面效果（顶部栏风格呈现）需肉眼确认
3. **Apple 开发者账号**：macOS 签名/公证（M3 卡点）
4. **真机测试**：Android 客户端验收（M4）
5. **发布**：Docker Hub / GitHub Releases 操作

## 6. 升级脚本完善项（M0 组成部分，今天实测验证）

`scripts/upgrade-official.sh` + `apply-macos-fix.sh` 总体设计良好（锁探测、幂等重放、3way 兜底、分支防丢）。今天实测发现 4 个待修点：

| # | 级别 | 问题 | 修复方向 |
| --- | --- | --- | --- |
| 1 | P0 | `fetch_tags()` 末尾 `git fetch \| tail -3` 吞掉退出码，fetch 失败也会返回成功，带着错误信息继续跑 | 捕获退出码，失败即 die |
| 2 | P0 | 不清理残留 worktree 注册——今天 `/private/tmp/nowen-pristine` 坏注册直接让 fetch fatal，脚本重试 3 次仍失败 | fetch 前 `git worktree prune`（含 unlock 兜底） |
| 3 | P1 | 补丁基线漂移无预警：补丁生成于 10-13，上游已 6139 commits，3way 冲突面积不可知 | 重放前计算 drift（`rev-list --count`），超阈值警告并提示人工审查冲突清单 |
| 4 | P1 | 提示语矛盾：说"其他本地提交需 cherry-pick"，但补丁是 `origin/main..HEAD` 全量 diff 已包含全部提交，照做会重复应用 | 改为"全部本地改动由补丁携带，无需 cherry-pick；仅当补丁重放失败时才需人工拣选" |

## 7. 并行后的总体估计

- 会话总量：约 12-16（vs 串行 16-30）
- 日历时间：每天 1-2 会话 ≈ **2-3 周**；每天 2-3 会话 ≈ **10-14 天**
- 最大残余风险：W0.5 若为架构级根因，轨道 1 作废重估（不影响轨道 2/3）
