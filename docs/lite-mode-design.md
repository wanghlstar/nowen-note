# Lite 模式设计文档

> 配套文档：[产品分析与决策记录](./lite-mode-assessment.md)（D1-D11）、[实施规划与分工](./lite-mode-work-plan.md)（W0-W7、Agent 编制）。本文只描述"怎么实现"，不重复决策理由。

## 1. 总体形态

单代码库、单数据库 schema、单同步协议，两个正交维度：

| 维度 | 机制 | 作用 |
| --- | --- | --- |
| 部署 profile | 服务端 `NOWEN_PROFILE=lite` + 前端同一 profile 下发 | 运行时关闭 P1 模块（API 返回禁用、导航无入口） |
| 构建变体 | `VITE_LITE=1` | 打包时剔除 P1 代码与依赖，减小 bundle 与安装包 |

完整模式（默认）行为不变。Lite 客户端写入的数据完整模式可读，反之亦然（schema 不变）。

## 2. 模块注册表（单一事实来源）

现状：P1 模块的"关闭面"分散在路由表、导航、懒加载注册、Capacitor 插件、npm 依赖五处，逐个模块人肉关闭容易漏。引入一个注册表作为唯一事实来源：

```ts
// frontend/src/lib/featureRegistry.ts（新增，唯一新增抽象）
export const FEATURES = {
  notes:        { tier: "P0", routes: [...], nav: [...], chunks: [...] },
  importBasic:  { tier: "P0", chunks: [...] },              // D12：MD/HTML 基础导入
  encrypted:    { tier: "P0", ... },
  ai:           { tier: "P1", backendRoutes: ["ai.ts", "ai-reliable.ts"], chunks: ["AIChatPanel", ...] },
  tasks:        { tier: "P1", backendRoutes: ["task-*.ts", "habits.ts"], ... },
  diary:        { tier: "P1", backendRoutes: ["diary.ts", "journals.ts"], ... },
  mindmap:      { tier: "P1", backendRoutes: ["mindmaps.ts", "mindmap-folders.ts"], chunks: ["MindMapEditor", ...] },  // D13 降级
  collab:       { tier: "P1", backendRoutes: ["sync realtime ws"], ... },
  sharing:      { tier: "P1", backendRoutes: ["shares.ts"], ... },
  plugins:      { tier: "P1", backendRoutes: ["plugins.ts", "plugin-*.ts"], ... },
  openApi:      { tier: "P1", backendRoutes: ["mcp/cli/sdk/webhook 相关"], ... },
  importCenter: { tier: "P1", ... },                        // 多源导入；基础 MD/HTML 已拆至 P0
  sheet:        { tier: "P1", backendRoutes: ["sheets.ts"], ... },
  voiceMemo:    { tier: "P1", ... },
  automation:   { tier: "P1", backendRoutes: ["automations.ts", ...], ... },
} as const;
```

约束（遵守 AGENTS.md 简洁原则）：
- **不新建平行框架**：路由表、导航、懒加载注册全部从现有代码位置派生，注册表只做"开关 + 清单"，不做插件系统
- P0 集合 = D1-D9 确认保留项（知识树、MD/富文本、附件、备份、搜索、思维导图、加密笔记、Web、账号）
- 注册表内容由 Agent-D 测绘 260 个组件与 60+ 路由文件后填充，不靠猜

## 3. 各层关闭机制

**服务端**：profile 决定路由挂载。现有 `backend/src/routes/` 已是按模块拆文件，挂载处按注册表过滤；被禁模块返回明确禁用错误（非 500、非 404 误导）。ws 协作端点在 lite 不启动。

**前端**：profile 由服务端配置下发（登录后可用），构建期 `VITE_LITE` 作为默认值。路由/导航/搜索范围/懒加载 chunk 均读注册表；lite 下未注册模块的 `Lazy*Runtime` 不挂载——现有 `DeferredGlobalFeatureCenters` 模式已证明该解耦可行。

**依赖**：`VITE_LITE=1` 时从产物剔除 `y-codemirror.next`、`lunar-javascript`、`mammoth`、`bonjour` 等（精确清单以构建分析为准）。`mermaid` 依赖**保留**——MD 笔记内的 Mermaid 图表渲染属基础笔记能力，与被裁的脑图编辑器（D13）是两回事。

## 4. 同步架构（local-first）

现状即目标形态，无需重设计：
- 本地优先存储：桌面为本地 backend sidecar（SQLite），移动为 Capacitor SQLite + IndexedDB；Sync V2 HTTP 增量同步与 Yjs 解耦（已核实）
- Yjs 保留为富文本本地文档模型，仅移除协作 WS 层（D10 边界）

**W0.5 冲突治理**（关键路径，根因未明）：
- 现状机制：`sync/bootstrap.ts` reconcile 对"ID 相同 + 内容异"双版本入 `sync_conflicts` 转人工
- 调查假设（按优先级）：① 本地已推送修改未正确标记导致回声被判冲突；② 桌面/移动两条本地存储路径产生伪冲突；③ 推送-拉取游标竞态；④ reconcile 缺少版本/时间戳判定
- 候选策略与选择标准：优先修"伪冲突"（标记/游标类），不动"真冲突双保留"的产品语义；若需引入版本判定，最小方案是单调版本号，不引入 CRDT 第二套
- 验收：冲突不再作为常规操作出现 + CJK 边界用例（汉字后空格/逗号/单引号往返一致）

## 5. Tauri 客户端（D5/D10）

- 形态：**local-first**（D10），非 remote-only。本地 backend sidecar 参考 `electron/localAccountBootstrap.js` 的启动方式在 Tauri 侧重建
- 工程布局：`tauri/` 新目录（或 `apps/desktop-tauri/`），复用 `frontend/dist`；三平台（D8）
- 需重建：auto-update（tauri-plugin-updater）、菜单/托盘、md/txt 文件关联、加密笔记自动锁定（对应 `electron/encrypted-notes-auto-lock.js`）、附件打开、打印桥
- 插件映射（Capacitor → Tauri）：SQLite（`nativeDatabase.ts`，加密笔记在用）→ tauri-plugin-sql 或 IndexedDB 回退（**先确认 web 分支是否存在**）；biometric/secure-storage → Tauri 插件或移除；local-notifications 不迁移（任务已裁）
- 不需迁移：本地 backend 之外的 clipper-host（剪藏已裁）
- 签名/公证：macOS 需用户 Apple 账号，为本设计中最强的用户侧门禁

## 6. 基线策略

Lite 开发基线 = fork 的 `macos-fix` 分支（已含顶部栏风格与工具提交，D11）。升级官方走 `upgrade-official.sh` + 补丁重放（§见工作规划 M0）；`feat/lite` 从 `macos-fix` 切出，稳定后合回，不做长期独立分支（上游 16 天 6139 commits 的速度下独立分支必然失控）。

## 7. 回滚

- 代码：所有轨道在 fork 有远端分支；补丁重放失败可 `git checkout macos-fix` 回到当前状态
- 数据：恢复出厂/完整恢复流程已在产品内（自动安全备份），Lite 不改动该机制
- 发布：lite 独立 appId/channel（D4），与 full 互不覆盖
