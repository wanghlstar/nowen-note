# Lite 实施 · 会话分工简报

> 用途：每个新会话复制对应简报即可开工。新会话**没有历史对话**，一切以本文档 + `docs/lite-mode-assessment.md`（决策 D1-D13）+ `docs/lite-mode-design.md`（设计）为准。开工前统一先读仓库根 `AGENTS.md`。

## 0. 总览与派发顺序

| 简报 | 会话角色 | 依赖 | 分支 / Worktree | 会话数 |
|---|---|---|---|---|
| S1 | 升级脚本完善 + 基线落地 | 无 | 主工作树 `macos-fix` | 1-2 |
| S2 | 测绘 + 注册表 + 验收用例（只读） | 无 | 只读，不建分支 | 1-2 |
| S3 | W1-W3 前后端裁剪实施 | S2 注册表 | `feat/lite-trim`（worktree `../nowen-wt-trim`） | 3-6 |
| S4 | W4 Tauri 客户端 | S1 基线 | `feat/lite-tauri`（worktree `../nowen-wt-tauri`） | 6-12 |
| S5 | W0.5 同步冲突治理（主会话） | 无 | 主工作树 `macos-fix` | 2-5 |

并行规则：S1/S2/S5 可立即并行；S3 等 S2；S4 等 S1。各会话只动自己 worktree，推自己分支，集成由主会话统一做。任何会话不得改 `docs/lite-mode-*.md`。

Worktree 准备（主工作树执行一次）：

```bash
git worktree add ../nowen-wt-trim  -b feat/lite-trim  macos-fix
git worktree add ../nowen-wt-tauri -b feat/lite-tauri macos-fix
```

---

## S1 · 升级脚本完善 + 基线落地

**任务**：修 `scripts/upgrade-official.sh` 的 4 个已实测缺陷（详见 `docs/lite-mode-work-plan.md` §6）：

1. **P0** `fetch_tags()` 末尾 `git fetch --tags origin 2>&1 | tail -3` 吞掉退出码——fetch 失败也返回成功。改为捕获失败并 `die`
2. **P0** fetch 前清理残留 worktree 注册（今天实测 `/private/tmp/nowen-pristine` 坏注册让 fetch 直接 fatal）：加 `git worktree prune`，locked 的加 unlock 兜底
3. **P1** 补丁基线漂移预警：重放前计算 drift（`git rev-list --count <TAG>..origin/main` 之类），超阈值（如 >200）警告并提示人工审查冲突清单
4. **P1** 提示语矛盾："其他本地提交需 cherry-pick" 改为"全部本地改动由补丁全量携带，无需 cherry-pick；仅补丁重放失败时才人工拣选"

**边界**：不动 `apply-macos-fix.sh` 的幂等标记逻辑；不跑完整升级构建；不碰 `patches/` 内容。
**验证**：`bash -n scripts/upgrade-official.sh`；构造一个假 worktree 注册验证 prune 生效；fetch 失败路径用错误 remote 模拟，确认脚本正确中止。
**产出**：提交到 `macos-fix`，推送 `mine`。随后**向用户汇报基线 A/B 建议**（A=旧基线即开工 / B=先重放补丁到 v1.5.3），由用户拍板。

---

## S2 · 测绘 + 注册表 + 验收用例（只读）

**任务**：

1. 遍历 `frontend/src/components/`（260 个组件）与 `backend/src/routes/`（60+ 文件），按 `docs/lite-mode-design.md` §2 的注册表格式，为每个 P1 模块列出完整"关闭面"：前端路由、导航入口、懒加载 chunk/注册点（`Lazy*Runtime`、`DeferredGlobalFeatureCenters`）、backend 路由文件、Capacitor 插件、npm 依赖
2. 填充 `frontend/src/lib/featureRegistry.ts`（按设计文档 §2 的骨架，P0/P1 分级以 assessment D12/D13 为准）
3. **验证 D12 待验证项**：Leanote 导出的 HTML 走现有"导入为富文本"链路是否兼容（找导入中心相关代码路径，用一份 Leanote HTML 样本实测；没有样本就明确标注"未实测"并给出判断依据）
4. 编写 W7 验收用例清单（对齐 assessment §5 验收标准 1-6，含 CJK 边界：汉字后紧跟空格/逗号/单引号，编辑往返 + 同步后一致）

**边界**：只读业务代码；只允许新建 `featureRegistry.ts` 与 `tests/` 下新文件；不得改任何现有逻辑。
**产出**：注册表 + 《P1 关闭面清单》markdown（放 `docs/`）+ 验收用例文件；提交到 `feat/lite-trim`（或主树，由用户定）。

---

## S3 · W1-W3 前后端裁剪实施

**前置**：S2 注册表就绪；`git worktree add ../nowen-wt-trim -b feat/lite-trim macos-fix` 已在 `../nowen-wt-trim` 工作。

**任务**（按 W1→W2→W3 顺序）：

- **W1 前端**：路由表、导航、搜索范围、懒加载注册点读注册表加 profile 门；`NOWEN_PROFILE=lite`（或前端等效配置）下 P1 模块不挂载、无入口
- **W2 后端**：`backend/src/routes/` 挂载处按 profile 过滤；被禁模块 API 返回明确禁用错误（非 500）；lite 不启动 ws 协作端点
- **W3 构建开关**：`VITE_LITE=1` 剔除 P1 代码与依赖 chunk；出构建分析报告，对比 W0 基线（dist 23MB / assets 22MB / 最大 chunk `index-*.js` 2,284KB）

**边界**：不改 P0 任何行为；**不删 P1 代码**（只关入口，代码保留供完整模式）；不动 `backend/src/sync/`；不动 Electron；完整模式默认行为零变化。
**验证**：lite profile 下前端无 P1 入口、被禁 API 返回禁用错误；`VITE_LITE=1` 产物无 P1 chunk；`cd frontend && npm run lint && npm run test:run` 与 `cd backend && npm test` 不劣于基线（区分既有债务与本次问题）。
**产出**：PR 到 `feat/lite-trim`，推送 `mine`；附构建对比数据。

---

## S4 · W4 Tauri 客户端

**前置**：S1 基线已定。可先用完整 `frontend/dist` 跑通壳，S3 完成后换 lite 产物。

**任务**（对齐 `docs/lite-mode-design.md` §5）：

1. `tauri/` 新工程（Tauri 2），复用 `frontend/dist`；三平台配置（D8：macOS arm64/x64、Windows x64、Linux AppImage/deb）
2. **local-first 形态（D10）**：本地 backend sidecar 启停与健康检查（参考 `electron/localAccountBootstrap.js` 的本地后端启动方式）
3. 插件映射：Capacitor SQLite（`frontend/src/lib/nativeDatabase.ts`，加密笔记在用）→ tauri-plugin-sql 或 IndexedDB 回退（**先确认 web 分支是否存在**）；biometric/secure-storage → Tauri 插件或移除；local-notifications 不迁移
4. 重建 Electron 侧能力：auto-update（tauri-plugin-updater）、菜单/托盘、md/txt 文件关联、加密笔记自动锁定（参考 `electron/encrypted-notes-auto-lock.js`）、附件打开、打印桥
5. 三平台打包；macOS 签名/公证步骤文档化（**执行需要用户 Apple 账号，本人不碰**）

**边界**：不改 `frontend/src` 业务逻辑（除必要的平台探测分支）；不碰 Electron 与 `patches/`；不做 remote-only 形态。
**验证**：至少 macOS 产物可安装 → 登录 → 建/编笔记 → 断网编辑 → 联网自动同步 → 第二设备读取；构建与运行步骤写入 `docs/`。
**产出**：`tauri/` 工程 + 三平台构建配置，PR 到 `feat/lite-tauri`，推送 `mine`。

---

## S5 · W0.5 同步冲突治理（主会话）

**任务**（对齐 `docs/lite-mode-design.md` §4）：

1. **先向用户要复现路径**：哪几台设备、什么操作后冲突、冲突两侧内容差异长什么样；拿不到就基于代码审查提假设并用测试验证，明确标注"未复现"
2. 按假设优先级调查：① 本地已推送未标记导致回声判冲突；② 桌面/移动两条本地存储路径伪冲突；③ 推送-拉取游标竞态；④ reconcile 缺版本判定。关键文件：`backend/src/sync/{bootstrap,conflict,apply,applyLocal,push,outbox}.ts`
3. 写失败复现测试 → 修 → 转绿；修"伪冲突"，不动"真冲突双保留"的产品语义（若要改语义，先问用户）
4. CJK 边界回归：汉字后紧跟空格/逗号/单引号，编辑往返 + 同步后一致

**边界**：不动编辑器/Yjs；不引入 CRDT；不用"清空本地数据"当修复。
**验证**：`cd backend && npm test` 全绿；复现用例从红到绿；冲突场景人工步骤可复测。
**产出**：修复提交到 `macos-fix`，推送 `mine`；根因结论回写 assessment §5 W0.5 行（由主会话统一改文档）。

---

## 附：每会话启动模板

```
先读：AGENTS.md、docs/lite-mode-assessment.md、docs/lite-mode-design.md、
docs/lite-mode-session-briefs.md 中属于你的简报（Sx）。严格按简报的
任务/边界/验证执行；文档与简报冲突时以 assessment 的决策记录为准并
向我指出。结束时汇报：做了什么、验证结果（命令+输出摘要）、遗留问题。
```
