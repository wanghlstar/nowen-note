# Nowen Note「轻量化」产品分析（Lite 模式评估）

> 状态：评估草案，未实施。本文回答三个问题：① nowen-note 为什么被认为"太厚"；② 轻量自托管笔记赛道（SiYuan / Joplin / Notesnook 等）的定位差异；③ "用新架构重实现 Leanote"是否值得做。结论先行：**推荐 Lite 模式（部署 profile + 构建开关裁剪），不推荐重写。**

## 1. 问题定义

用户反馈 nowen-note "太厚"。这实际是两个不同命题，解法不同：

- **认知厚**：功能面大，新用户面对 AI、任务、日记、协作、插件、导入迁移等大量入口，上手成本高。
- **物理厚**：代码量、前端 bundle、客户端安装包与内存占用大。

下文分别评估。

## 2. 现状证据

测量时间：2026-10-26，版本 v1.5.1。

| 指标 | 数值 |
| --- | --- |
| `frontend/src` TS/TSX 行数 | ≈ 287,700 行 |
| `frontend/src/components` 组件数 | 260 个 |
| `backend/src` 行数 | ≈ 137,000 行 |
| `electron` 行数 | ≈ 11,000 行 |
| frontend 运行时依赖数 | 85 个 |
| README「核心能力」模块数 | 12 个模块 |
| 平台覆盖 | Web、Electron（Win/macOS/Linux）、Android、iOS 工程、HarmonyOS 工程、Docker/NAS |

安装包体积、首屏 bundle 大小、常驻内存**未测量**，作为待补基线，本文不设数字目标。

已有的"轻"工程基础（说明架构不是瓶颈）：

- 前端已大量使用 `DeferredGlobalFeatureCenters`、`LazyXxxRuntime` 等按需挂载模式（260 个组件中大量入口）。
- 后端路由按模块拆分为 60+ 文件，具备按 profile 屏蔽单个模块的基础。
- AI、任务、语音、剪藏等功能均以独立 `*Bridge` 桥接组件接入，编辑器核心与功能模块已解耦。

**结论：厚在功能面，不在架构腐烂。**

## 3. 竞品定位对比

| 产品 | 定位 | 平台 | 编辑器 | 同步架构 | 自托管成本 | 已知问题 |
| --- | --- | --- | --- | --- | --- | --- |
| **SiYuan** | 本地优先个人知识库 | Mac/Win/Linux/Android/iOS/Web（Docker） | MD + 块编辑 WYSIWYG | 官方云（订阅）或 S3 兼容存储（MinIO / 阿里云 OSS 等）；自托管同步免费 | 低（单容器，Go kernel） | 付费点仅 AI 点数、官方云托管、部分主题插件，**同步本身免费**；用户实际弃用原因是 NAS 自托管部署没跑起来（部署门槛，非付费墙）；已知痛点：移动端后台同步中断、离线冲突合并偶发重复/丢失、大附件索引重建慢 |
| **Joplin** | 开源 Evernote 替代 | 全平台，**无官方 Web 端** | MD + 富文本（RTE） | WebDAV / Joplin Server | 很低 | 2.x 同步冲突/丢数据问题多（3.x 重写同步引擎）；MD 与 RTE 混用时往返转换会丢字符/格式；用户实测：汉字后面丢空格、逗号，疑似 SQLite 存储层单引号处理（未定位，缺复现信息） |
| **Notesnook** | E2EE 隐私笔记 | Web/Mac/Android/iOS/Linux | MD + 富文本 | 自建同步（2024 起服务端开源） | 中（账号 + 同步 + realtime 多服务） | E2EE 导致服务端无法检索正文 |
| **Standard Notes** | E2EE 极简笔记 | Web/Mac/Android | MD + 富文本（编辑器已开源） | 自托管同步服务器 | 低 | 功能面窄，扩展依赖插件 |
| **AppFlowy** | Notion 开源替代 | Web/Mac/Win/Linux + Android/iOS beta | 富文本块编辑 + MD 导入 | AppFlowy Cloud | 高（gotrue/PG/Redis/MinIO/worker 多服务） | 资源占用重，移动端 beta |
| **ZNote**（helloxz，2026-06 新建，106 stars，AGPL） | 纯 MD 笔记 | Web + Android APP（PC 客户端在 Todo） | 仅 MD WYSIWYG | **服务端集中存储，无本地同步** | 极低（Bun + Hono + libSQL 单容器） | 与 Lite 需求结构性冲突：无 local-first/离线读写、无富文本/脑图/加密笔记、无 Mac 客户端；技术栈 Vue3 与 nowen React/Tiptap 编辑器生态全错位。**不能作为 Lite 基线**，但是 Lite 完成后的轻量竞品 |

定位差异总结：**没有一款竞品同时满足"全平台 + MD/富文本双模 + 自托管 + 全家桶"。** 竞品要么功能窄（Joplin、Standard Notes），要么重（AppFlowy），要么同步架构妥协（SiYuan 共享 kernel、Joplin 无 Web）。nowen-note 的差异化空间在"同等能力下更轻"。

对 nowen 的启示：SiYuan/Joplin 被诟病的同步丢数据问题，恰是 nowen 已具备的护城河——Yjs 持久化确认、IndexedDB 草稿恢复、版本历史、冲突保护（README「可靠保存与离线工作区」）。这些属于 P0 保留项，**不应作为轻量化裁剪对象**，反而是 Lite 模式的宣传点。此外 SiYuan 的实际弃用原因是 NAS 自托管部署没跑起来，nowen 的一键 Docker Compose / fnOS / UGOS 应用包同样是护城河，Lite 模式必须保证部署路径不增加复杂度。

## 4. 命题评估：Leanote 用新架构重实现？

**结论：不推荐作为"解决厚"的手段。**

- 重写意味着把本仓库已解决的三端、同步、编辑器、部署重新走一遍（上述约 43.5 万行代码对应的问题）。
- Leanote 可复用资产仅"极简笔记"的产品定位；其代码（Python/Go + MongoDB）无复用价值。
- **范围修正（用户确认）**：Leanote 只做笔记、不做博客。该收敛范围与 Lite 模式 P0 范围完全重合——博客发布本来就不是 nowen-note 的能力项，无裁剪成本；独立重写的增量价值仅剩品牌独立与 Tauri 体积优势，进一步降低重写优先级。
- 唯一正当理由：战略上要换品牌、做定位不同的新产品，且接受以月计的周期。此时"新架构"的真实收益是 Electron → Tauri（客户端体积/内存数量级下降）+ 单机优先数据层；但移动端仍依赖 Capacitor，双技术栈成本需单独评估。
- 中间路线：Electron → Tauri 可作为 nowen 桌面端的独立优化项立项，与 Lite 模式解耦。

## 4.1 候选基线评估：znote fork vs nowen 裁剪（2026-10-26）

评估对象：helloxz/znote（Bun + Hono + libSQL + Vue3，AGPL-3.0，2026-06 新建，106 stars）。

| 维度 | znote fork 自建 | nowen 裁剪（现行方案） |
| --- | --- | --- |
| 与 D1-D11 的差距 | 缺 local-first 同步引擎（**完全没有，要从零设计**）、富文本编辑器、思维导图、加密笔记、Mac 客户端、备份恢复——约占目标工作量的 60-70% | 只缺"裁剪本身"+ Tauri 壳；同步/双编辑器/脑图/加密/附件/备份全部现成 |
| 最大难点 | 从零造本地优先同步层（游标、outbox、冲突检测）——把"修一个 bug"（W0.5）变成"造最难的子系统" | 修现有同步引擎的冲突 bug（W0.5，根因可调查、边界已知） |
| 技术栈 | Vue3/Bun/libSQL 全新栈；nowen 的 Tiptap/CodeMirror/加密笔记/脑图代码**零可移植性** | 现有 React/Tiptap/CodeMirror/Yjs 生态全部复用 |
| 工作量（会话） | **25-45**，且每会话伴随更多架构决策（绿地风险） | **12-16**（三轨道并行） |
| 数据源 | 现 924MB nowen 库弃用（用户将恢复出厂）；但 Leanote MD/HTML 需经导入链路进 Lite，而 Lite 原计划裁掉导入中心——需 carved out | 同一问题：导入中心在 P1 名单，必须把基础 MD/HTML 导入升为 P0（见 D12） |
| 上游依赖 | 单人作者、2 个月新项目、已停更 2 个月，bus factor = 1 | 成熟主线 + 已有 fork/补丁/升级工作流 |
| 风险性质 | 绿地架构风险 + 陌生栈调试 + 上游弃养可能 | 全部已知可测（W0.5 根因、Tauri 签名、上游合并） |

**结论：nowen 裁剪，且差距是数量级的（约 2-3 倍工作量 + 更高不确定性）。** znote 的正确定位是**产品参考**而非代码基线——它的"小而美纯笔记"IA/UX 正是 Lite 的目标气质，其功能取舍（无脑图无清单、版本历史 50 个、ZIP 导入）可作为 Lite 的信息架构对照。仅当需求放松为"服务端集中存储 + Web/Android、放弃 local-first/富文本/脑图"时，znote 才值得直接采用。

## 5. 最小方案：Lite 模式（推荐）

### 目标规格（用户 2026-10-26 确认并修订）

- 只做笔记；不要 AI，不要多人协作
- 客户端形态：**local-first** —— 数据本地存储优先，离线可读可写，联网后自动增量同步到自托管服务器（Docker/NAS）
- **明确否定 remote-only 直连服务器形态**：完整版"登录服务器直连"的用法不满足需求；现有 electron remote-only lite 包（`builder.lite.*`）的定位随之否定，需重新评估废弃或改造
- 客户端：macOS（Tauri）、Android（Capacitor）、Web
- **已知障碍（关键路径）**：完整版本地模式 + 同步服务器"总是冲突"，冲突须先治理，否则 Lite 的核心承诺（本地优先 + 自动同步）不成立
- 认知与物理都要"清凉"：Level 1 + Level 2 同时做

同一代码库、同一数据库 schema、同一同步协议，通过两级裁剪：

- **Level 1 · 部署 profile**：服务端配置 `NOWEN_PROFILE=lite`，禁用模块 API 返回明确禁用错误，前端不注册路由与懒加载 chunk。减认知。
- **Level 2 · 构建开关**：`VITE_LITE=1` 打包时剔除模块代码，真正减小 bundle 与安装包。减体积。代码保留在主分支，仅从 Lite 产物中剔除，避免双份维护。

### 功能分级清单

| 级别 | 模块 | Lite 默认 |
| --- | --- | --- |
| P0 核心（任何模式保留） | 知识树、MD/富文本双编辑器与互转、本地优先存储与离线工作区、Sync V2 增量同步、附件本地存储、账号、备份恢复、标签/收藏/搜索、回收站、加密笔记、基础 MD/HTML 导入（D12）、Web 端、Electron→Tauri(macOS)/Android 客户端、Docker 部署 | 保留 |
| P1 默认关闭（Lite 关闭，完整模式可开） | AI 全部（RAG/对话/写作）、任务与习惯、日记/每日记录、思维导图（D13 降级）、分享/公开空间/评论、插件平台、MCP/CLI/SDK/Webhook/剪藏、多源迁移导入中心、Sheet、语音备忘录、自动化、实时协作 WebSocket 层 | 关闭 |

### 技术裁剪要点（已核查代码）

- **Yjs 是双角色，不能整体移除**：`frontend/src/hooks/useYDoc.ts`、`y-indexeddb` 表明 Yjs 同时承担富文本本地文档模型与持久化确认，是编辑器保存链路的一部分；可移除的只是**实时协作 WebSocket 层**（`backend/src/sync/realtime.ts`、`notify.ts`、`services/realtime.ts`）。Lite 保留 Yjs 本地文档模型，关闭 ws 协作端点。
- **Sync V2 与 Yjs 解耦**：`backend/src/routes/sync-v2.ts` 及 `backend/src/sync/` 无 Yjs 依赖，HTTP 增量同步链路不受协作层裁剪影响——本地优先 + 离线读写 + 联网自动同步的需求由现有 Sync V2 直接满足。
- **候选移除依赖**（Level 2 生效后）：`y-codemirror.next`（CodeMirror 协作绑定）、`lunar-javascript`（日记农历）、`mammoth`（DOCX 导入）、`bonjour`（局域网发现）、`html2canvas`/`jspdf`（导出周边，按保留项再评估）。精确清单以构建分析为准。
- **重要发现：仓库已有另一个"Lite"**：`electron/builder.lite.base.config.js` + `npm run electron:build:lite` 已存在，但它的含义是 **remote-only Electron 客户端**（不打包内置 backend，~70MB→~25MB，appId 加 `.lite`、GitHub channel=lite 独立分发），**没有做任何功能裁剪**。用户要的"清凉版"是功能维度裁剪，与现有分发维度的 Lite 是两回事——文档后续统一称功能裁剪为「Lite 产品线」，现有 remote-only 包视为其分发变体之一，命名需在待决策中最终确认。

## 5.1 决策记录（用户 2026-10-26 确认）

| # | 决策 | 影响 |
| --- | --- | --- |
| D1 | 思维导图保留 | 从 P1 升 P0；`mermaid` 依赖保留（MD 图表同属笔记能力） |
| D2 | Web 端保留 | 同一前端产物服务浏览器，成本接近零 |
| D3 | 加密笔记保留 | 加密本地库链路（`nativeDatabase.ts`）进入 P0，Tauri 迁移需处理其 SQLite 依赖 |
| D4 | Lite 用独立包 | 延续现有 lite 分发策略：独立 appId / channel / 产物名，与 full 并存不互覆盖 |
| D5 | Tauri 立项 | Lite 桌面端用 Tauri 2 替代 Electron；完整版 Electron 保留 |
| D6 | 分享不留 | 分享/公开空间/评论从待定转为确认移除；ACL/权限继承代码仅在完整模式保留 |
| D7 | 产品名 = Lite | 功能裁剪产品线定名 Lite；但 D10 否定 remote-only 后，现有 electron remote-only lite 包（`builder.lite.*`）定位需重新评估（废弃或改造为 local-first） |
| D10 | 客户端形态 = local-first + 同步服务器 | 否定 remote-only 直连；Tauri Lite 必须携带本地优先同步栈（本地 backend sidecar 或本地 SQLite + Sync V2），不是纯远程壳 |
| D8 | Tauri 三平台都做 | macOS（arm64+x64）、Windows（x64）、Linux（AppImage/deb）；构建矩阵随 W6 扩展 |
| D9 | Android 维持 Capacitor | 现有工程完整，Tauri mobile 生态太新；local-notifications 等任务相关插件在 lite 下无引用但不删代码 |
| D11 | Lite UI 沿用当前 main 的顶部栏风格 | 即用户与当前版本共同改出的全宽标题栏/侧栏方案（对应 `a2c1086e`~`336bbe07` 系列提交与 `patches/macos-sidebar-trafficlight-fix.patch`），Lite 不另做界面设计 |
| D12 | 基础 MD/HTML 导入升为 P0 | 用户数据源为 Leanote 导出的 MD + HTML；"迁移导入中心"整体裁掉（P1）会堵死初始数据加载。拆分为：基础 MD/HTML 导入 = P0 保留；多源导入（思源/Obsidian/微信/小米云等）= P1 裁。**待验证**：Leanote HTML 结构走现有富文本 HTML 导入是否兼容，不兼容则需先转 MD |
| D13 | 思维导图移出 P0（修正 D1） | 用户确认脑图可忽略；思维导图编辑器（MindMapEditor/Overview/Embed + `mindmaps.ts`/`mindmap-folders.ts`）降为 P1 默认关闭。注意 `mermaid` 依赖仍保留——MD 笔记内 Mermaid 图表渲染属基础笔记能力，与脑图编辑器是两回事 |

## 5.2 实施方案（工作流分解）

| # | 工作流 | 内容 | 验证 |
| --- | --- | --- | --- |
| W0 | 基线测量 ✅ 2026-10-26 | `npm run build:frontend` 实测：dist 23MB / assets 22MB / 338 文件；最大 chunk `index-*.js` 2,284KB（gzip 659KB）、`App-*.js` 1,174KB（gzip 322KB）；P1 可归属 chunk（TaskCenter / cynefin / flow / pdf / jspdf / typescript / babel）≈3.8MB raw，其中 flow/cynefin 归属待确认（疑为任务/习惯视图），pdf/jspdf 与导出的边界待确认 | 数字目标待 W3 后对比；安装包与内存基线未测（需 electron build + 运行测量），列为遗留 |
| W0.5 | 同步冲突治理（关键路径，先于 W1-W4） | 调查完整版本地模式 + 同步服务器"总是冲突"的根因。已知机制：`backend/src/sync/bootstrap.ts` 的 reconcile 对"ID 相同 + 内容异"直接入 `sync_conflicts` 双版本保留、需人工解决（`conflict.ts`）。待查：本地已推送修改是否被正确标记、双设备编辑的版本判定、mobile/desktop 两条本地存储路径是否产生伪冲突 | 冲突不再作为常规操作出现；自动化回归用例覆盖 |
| W1 | 前端功能裁剪 | `NOWEN_PROFILE=lite` 下前端路由/导航/懒加载注册点移除 P1 模块 | Lite 包无 AI/任务/日记入口 |
| W2 | 后端功能裁剪 | lite 模式不挂载 P1 路由（ai/tasks/diary/shares/plugins/mcp/webhook/automations/ws 协作端点/导入） | 被禁 API 返回明确禁用错误 |
| W3 | 构建开关 | `VITE_LITE=1` 剔除 P1 代码与依赖 chunk | bundle 分析对比 W0 基线 |
| W4 | Tauri 桌面客户端（最大工作量，macOS + Windows + Linux） | **local-first 形态**（D10）：本地 backend sidecar（参考 `electron/localAccountBootstrap.js` 的本地后端启动）或本地 SQLite + Sync V2 后台增量同步；需重建：auto-update（tauri-plugin-updater）、菜单/托盘、md/txt 文件关联、加密笔记自动锁定（对应 `electron/encrypted-notes-auto-lock.js`）、附件打开、打印桥；需替换：Capacitor SQLite（`nativeDatabase.ts`）→ tauri-plugin-sql 或 IndexedDB 回退（先确认 web 分支是否存在）、biometric/secure-storage；不需迁移：clipper-host | Tauri 三平台安装后可本地编辑、离线、联网自动同步 |
| W5 | Android | Capacitor 保留；任务相关 Capacitor 插件（local-notifications 等）在 lite 下无引用但不删除代码 | Android APK 核心闭环回归 |
| W6 | CI/发布 | lite Docker 镜像 tag、Tauri mac 构建矩阵（arm64+x64）、channel 分离（已有先例） | CI 全绿 + smoke |
| W7 | 验收 | 见上文验收标准 1-6 | 全部通过 |

### 5.3 分支与升级策略（2026-10-26 定）

- **不开长期风格分支，不开 Lite 独立长期分支**。上游迭代速度极高（本地 base 为 2026-10-10 的 `c66a4468`，至 v1.5.3 已领先 6139 commits），长期分支每次升级都要 rebase，冲突照旧且双份维护失控。
- **沿用仓库既有模式**（`scripts/upgrade-official.sh`）：官方 tag + 补丁重放 + 每版本一个工作分支（现为 `macos-fix-<tag>`，随 Lite 演进可更名）。本地改动以 `patches/*.patch` 固化携带，升级 = 确定性重放而非 merge。
- **Lite 开发用短期 feature 分支**（如 `feat/lite-profile`），合并回 main；Lite 是 main 上的构建变体，不是独立代码线（与本文"同一代码库"结论一致）。
- **安全底线**：本地提交当前只存在于本机（origin 为官方库，本地 git 身份非上游作者）。需 fork 个人仓库并推流，作为升级重放失败时的恢复点。

### 验收标准

1. `NOWEN_PROFILE=lite` 启动后，被禁模块 API 返回明确禁用错误（非 500），前端导航与搜索无对应入口；ws 协作端点不启动。
2. `VITE_LITE=1` 产物中不含 AI/任务/协作/日记相关 chunk（构建分析可验证）。
3. Lite 与完整模式共用 schema 与同步协议：Lite 客户端写入的数据，完整模式客户端可正常读取（双向兼容）。
4. 核心闭环回归：登录 → 建笔记 → MD/富文本互转 → 飞行模式编辑 → 联网自动同步 → macOS 与 Android 第二设备读取 → 备份恢复。
5. CJK 边界用例：汉字后紧跟空格、逗号、单引号的正文，经编辑器往返与同步后内容一致（回归 Joplin 类字符丢失问题）。
6. 前端 lint 与后端测试不劣于当前基线（`cd frontend && npm run lint`、`cd backend && npm test`）。

## 6. 风险

- **同步冲突是 Lite 的最大风险（关键路径）**：用户实测完整版本地模式 + 同步服务器"总是冲突"。当前机制（`sync/bootstrap.ts` reconcile）对任何"ID 相同 + 内容异"都双版本保留并转人工解决；若根因是本地已推送未标记或双存储路径伪冲突，不修复则 Lite 的本地优先承诺不成立，裁剪做得再好也没用。
- **Tauri 迁移工作量**：electron 主进程约 11K 行；local-first 形态下本地 backend sidecar 必须在 Tauri 重建（不能当纯远程壳裁掉）；Capacitor 插件（SQLite/biometric/secure-storage）在 Tauri 不可用，需替换或确认回退路径。
- **新旧 Lite 关系**：产品线定名 Lite（D7）；现有 electron remote-only lite 包（`builder.lite.*`）定位被 D10 否定，需决定废弃或改造，避免用户和 CI 混淆。
- **模块耦合暗礁**：大量 `*Bridge` 桥接组件（AI/Task/Voice/Clipboard 等）需逐一切断引用；懒加载降低但不能消除风险，需按清单实测。
- **双模式漂移**：Lite 构建若进 CI，需扩展构建矩阵与 smoke 覆盖，否则 Lite 产物可能长期漏测。
- **Yjs 边界**：Yjs 同时是富文本本地文档模型，"去掉 Yjs"类提案不在 Lite 范围内；Lite 只移除协作 WebSocket 层。
- **移动端插件牵连**：Android 侧 `local-notifications` 等 Capacitor 插件与任务/提醒绑定，裁剪时需同步 `frontend/` 的 Capacitor 配置与原生工程。
- **基线缺失**：体积/内存/bundle 目标值需先测基线再定。

## 7. 决策闭环

D1-D9 已覆盖全部待决策问题。最后一项（D9）：Android 维持 Capacitor。产品规格与实施范围冻结，进入 W0 基线测量。
