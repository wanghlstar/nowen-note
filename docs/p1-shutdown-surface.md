# P1 关闭面清单（Lite 模式 S2 测绘产出）

> 测绘时间：2026-10-26，基线 `main`（`02dc16fa`）。只读测绘，未改任何业务代码。
> 配套：`frontend/src/lib/featureRegistry.ts`（注册表，机器可读）、
> `docs/lite-mode-assessment.md`（决策 D1-D13）、`docs/lite-mode-design.md`（设计 §2）。
> 本文回答一个问题：**每个 P1 模块从前端到后端、从路由到依赖，一共要在哪几处关门。**

## 0. 先读：三个与直觉不符的机制事实

S3 实施前必须知道，否则按常规方法（搜 import 找挂载点）会大面积漏关：

1. **没有 react-router**。前端是「自研 pathname 状态机 + viewMode 状态机」双轨制：
   - 路径导航：`frontend/src/lib/appPathNavigation.ts:81-105`（pushState/replaceState + `APP_PATH_CHANGED_EVENT`）
   - viewMode 联合类型：`frontend/src/types/index.ts:263`（`notebook/favorites/trash/all/search/tasks/tag/mindmaps/ai-chat/diary/files/shares/issues`）
   - 路由→viewMode：`frontend/src/App.tsx:491-530`；viewMode→路由回写：`App.tsx:532-560`
   - 公开分享路由（整页重载型）：`App.tsx:1833-1852`、`frontend/src/main.tsx:195-204`
2. **`Lazy*Runtime` 在源码里没有任何生产 import**。它们靠 `frontend/vite.config.ts:33-140` 的
   `resolve.alias` 精确替换生效（如 `@/components/TaskCenter` → `LazyTaskCenterRuntime`，`vite.config.ts:117-120`）。
   App.tsx 的静态 import 经 alias 变懒加载。契约测试：`frontend/src/lib/__tests__/startupChunkingContract.test.ts:12-28`
   （13 个 Runtime 白名单，改懒加载前必看）。
3. **后端挂载处单一集中**：81 个路由文件的 `app.route(...)` 几乎全部在 `backend/src/index.ts:595-650` 与 `:681-688`
   两个连续块；另有 4 处 `backend/src/runtime/*.ts` 的 `Hono.prototype.route` 补丁挂载（模块加载即注入，见 §6）。

**可复用的既有开关先例**（不要新造平行机制）：
- 用户级导航显隐/排序：`frontend/src/lib/navigationVisibility.ts:1-10`（含 diary/tasks/mindmaps/ai-chat/shares）
- 工作区级功能开关（服务端下发）：`frontend/src/types/index.ts:132-150`（`WorkspaceFeatures`），
  消费于 `frontend/src/components/NavRail.tsx:112-133,176`，管理 UI `MembersPanel.tsx:135-150`

---

## 1. 总览矩阵

| 模块 | tier | viewMode | URL 路由 | NavRail | 懒加载壳 | Deferred 桥 | 后端文件数 | P1 专属依赖 |
|---|---|---|---|---|---|---|---|---|
| ai | P1 | ai-chat | — | ✓ | 2 | 2 | 2 | sqlite-vec, word-extractor |
| tasks | P1 | tasks | — | ✓ | 1 | 1 | 13 | lunar-javascript, @capacitor/local-notifications |
| diary | P1 | diary | — | ✓ | 1 | — | 2 | — |
| mindmap | P1 | mindmaps | /mindmaps, /mindmaps/:uuid | ✓ | 1 | 1 | 2 | — |
| collab | P1 | — | /ws（WS） | —（编辑器内 PresenceBar） | — | — | —（services/realtime.ts） | ws, y-codemirror.next, y-protocols, y-indexeddb |
| sharing | P1 | shares | /share/:token, /notebook-share/:token, /public, /public/:token | ✓ | 3 | 1 | 2 | — |
| plugins | P1 | —（设置 tab） | — | — | — | — | 5 | quickjs-emscripten |
| openApi | P1 | —（设置 tab tokens） | — | — | — | — | 2 | —（packages/* 独立工作区） |
| importCenter | P1 | —（设置 tab data） | — | — | — | 7 | 9 | mammoth（与后端共享，见 §7） |
| sheet | P1 | —（/sheets/:id 文档） | /sheets/:id | — | **无壳** | — | 1 | — |
| voiceMemo | P1 | —（全局浮层+编辑器） | — | — | — | — | 1 | — |
| automation | P1 | —（设置 tab） | — | — | — | — | 2 | cron-parser |

P0 保留项（notes / importBasic / encrypted）的正面清单见注册表；本文只展开 P1 关闭面。

---

## 2. 逐模块关闭面（file:line 证据）

### 2.1 ai（AI 全部）

- **viewMode 渲染**：`App.tsx:571`（`isAIChatView`）→ `App.tsx:1088-1107`（`<AIChatPanel>`）；import `App.tsx:25`
- **导航**：`NavRail.tsx:92`（NAV_CONFIG `mode:"ai-chat"`, group tools，无 feature 键）；渲染 `NavRail.tsx:368-372`；
  移动本地模式登录拦截 `NavRail.tsx:189-193`；显隐设置 `SettingsModal.tsx:792`；插件浮层目标 `FloatingLayerHost.tsx:59,144-154`
- **懒加载壳**：`LazyAIChatPanelRuntime.tsx:4-16`（alias `vite.config.ts:33-36`）；
  `AISettingsReliabilityShell.tsx:3,185`（alias `vite.config.ts:37-40`）
- **Deferred 桥**：`DeferredGlobalFeatureCenters.tsx:30-31`（`AIProfileSwitcherBridge`、`EmbeddingIndexTaskCopyBridge`）
- **后端**：`ai.ts`（57 端点，`index.ts:626` `/api/ai`）、`ai-reliable.ts`（`user-preferences.ts:40` + `index.ts:645` 子挂载）
- **启动副作用**：`index.ts:927-946`（initVecStore + vec 冷启动 reindex）、`index.ts:948-952`（startEmbeddingWorker）
- **P0 表面内嵌入口（最易漏）**：
  - 设置 AI tab：`SettingsModal.tsx:22,1914,2108`
  - MD 编辑器 AI 写作助手：`MarkdownEditorImpl.tsx:131,2749-2757`；Tiptap：`TiptapEditor.tsx:151,6948`
  - 编辑器「更多」菜单 AI 摘要/Mermaid/标题/标签：`EditorPane.tsx:2743,2850,2632,2704`（按钮 `:3653,4538,4559-4561`）
  - 笔记列表批量 AI：`NoteList.tsx:2284,2367`（按钮 `:3803,3820`）
  - AI 设置内嵌语音设置/插件提示词包：`AISettingsPanel.tsx:19,488`、`:18,487`

### 2.2 tasks（任务与习惯）

- **viewMode 渲染**：`App.tsx:569` → `App.tsx:1069-1074`（`<TaskCenter>`）；import `App.tsx:21`
- **导航**：`NavRail.tsx:90`（`feature:"tasks"`，受 WorkspaceFeatures 控制 `NavRail.tsx:176`）；显隐 `SettingsModal.tsx:790`；
  浮层 `FloatingLayerHost.tsx:57`；提醒通知跳转 `App.tsx:778-785`
- **懒加载壳**：`LazyTaskCenterRuntime.tsx:4-11`（alias `vite.config.ts:117-120`）
- **Deferred 桥**：`DeferredGlobalFeatureCenters.tsx:34`（`TaskDataTransferBridgeV2`）
- **组件树**：`TaskCenter.tsx:2-6` → `TaskCenterImpl.tsx:16-53`（tasks/ 子目录 38+ 组件集中 import）
- **后端**（13 文件，全部挂载行见 §6）：tasks/habits/task-attachments/task-reminders/task-projects/
  task-templates/task-dependencies/task-calendar/task-digest/task-inbox/task-metadata/task-day-plans/task-time-blocks
- **启动副作用**：`index.ts:701-735`（30s 提醒扫描）、`index.ts:962-966`（taskDigest 60s 定时器）、
  `index.ts:971-975`（startCalendarExportScheduler）；另 `index.hardened.ts:5-7,15` 三个任务 migration bootstrap
- **Capacitor 插件**：`@capacitor/local-notifications`（全仓唯一 import：`frontend/src/lib/taskNotifications.ts:2`；
  消费者 useReminderNotifier/ReminderCenter/TaskDetailPanel/TaskCenterImpl）
- **P0 表面内嵌入口**：侧边栏搜索快捷捕获 `SidebarSearchExperienceBridge.tsx:7`（挂载 `App.tsx:1762`）；
  数据管理任务迁移 `DataManager.tsx:48,1166`；任务更新安全桥（全局 fetch 包装）`lib/taskUpdateSafetyBridge.ts:4`
  （安装 `main.tsx:62,168`）；Android 本地模式 task shim `lib/mobileLocalAdvancedTaskBridge.ts`、`lib/mobileLocalModuleBridge.ts:18`

### 2.3 diary（日记/每日记录）

- **viewMode 渲染**：`App.tsx:572` → `App.tsx:1108-1112`（`<DiaryCenter>`）；import `App.tsx:26`
- **导航**：`NavRail.tsx:89`（`feature:"diaries"`；标签特判「每日记录」`NavRail.tsx:278-280`）；显隐 `SettingsModal.tsx:789`；
  浮层 `FloatingLayerHost.tsx:56`
- **懒加载壳**：`LazyDiaryCenterRuntime.tsx:4-11`（alias `vite.config.ts:125-128`）
- **组件链**：`DiaryCenter.tsx:2,11` → `daily-records/DailyRecordsHub.tsx:10,173` → `DiaryCenterImpl.tsx:28,37-38`
  （还挂 `DiaryVideoFeed`、`SayCalendarView`、`DiarySidebar`）；`DailyJournalView.tsx:26-27`（JournalArchive + ShareModal）
- **后端**：`diary.ts`（17 端点，`index.ts:623`；匿名图片 `index.ts:438`）、`journals.ts`（24 端点，`index.ts:624`）
- **P0 表面内嵌入口**：日记隐私设置卡 `SettingsModal.tsx:28,1083`；编辑器 slash 插入日记
  `SlashCommands.tsx:18`、`MarkdownEditorImpl.tsx:162`（定义 `daily-records/dailyRecordSlashCommands.tsx`）

### 2.4 mindmap（思维导图编辑器，D13 降级）

- **路由**：`lib/mindMapDeepLink.ts:20-40`（`/mindmaps`、`/mindmaps/:uuid`）；构造 `:59-71`；
  状态 `App.tsx:479-481,513-514,548-554`
- **viewMode 渲染**：`App.tsx:570` → `App.tsx:1075-1087`（`<MindMapCenter>`）；import `App.tsx:23`
- **导航**：`NavRail.tsx:91`（`feature:"mindmaps"`；点击行为 `:201-207`）；显隐 `SettingsModal.tsx:791`；
  浮层 `FloatingLayerHost.tsx:58`
- **懒加载壳**：`LazyMindMapEditorRuntime.tsx:3-12`（alias `vite.config.ts:121-124`）
- **Deferred 桥**：`DeferredGlobalFeatureCenters.tsx:33`（`MindMapAppearanceBridge`）
- **后端**：`mindmaps.ts`（16 端点，`index.ts:620`）、`mindmap-folders.ts`（`index.ts:621`）
- **P0 表面内嵌入口（最多）**：知识树打开/新建 `KnowledgeTreePanel.tsx:723,1019`、`MobileKnowledgeTreePanel.tsx:611,726`、
  `CreateNoteMenu.tsx:105`、`KnowledgeTreeCreateDropdown.tsx:16`、`KnowledgeTreeNodeMenu.tsx:123,706`；
  编辑器插入脑图 `EditorPane.tsx:170,4988`、Mermaid→脑图 `EditorPane.tsx:2969-2970`；
  嵌入卡片 `MindMapEmbedCard.tsx:209`（Tiptap 注册 `TiptapEditor.tsx:159,2130`、MD 预览 `MarkdownPreview.tsx:25,413`）；
  搜索/命令面板跳转 `SearchCenter.tsx:311`、`common/CommandPalette.tsx:230`
- **注意**：`mermaid` 依赖保留（D1/D13）——MD 笔记内 Mermaid 图表渲染是 P0 基础能力，与脑图编辑器是两回事。

### 2.5 collab（实时协作 WebSocket 层）

- **前端 WS 客户端**：`lib/realtime.ts`（`WS_PATH="/ws"` `:28`）；provider `lib/yjsProvider.ts:16`
- **总闸（关键）**：`EditorPane.tsx:1645-1651` 的 `collabReady` 是唯一总闸；`hooks/useYDoc.ts:22` 的 `enabled`
  选项置 false 即切断 yjsProvider（WS + awareness + yCollab）整链
- **UI**：`PresenceBar.tsx:57`（`EditorPane.tsx:98,4412`）
- **其他 P0 表面引用**：`App.tsx:73,658-696`、`NoteList.tsx:25`、`features/trash/useTrash.ts:2`、`NoteIconBridge.tsx:6`、
  `WorkspaceSwitcher.tsx:30`、`lib/workspaceRefreshBridge.ts:1`
- **后端**：`backend/src/services/realtime.ts:207-283`（`attachRealtimeServer`，`noServer:true`）；
  挂载 `backend/src/index.ts:983`；关停 `:1049`；调试端点 `:766-773`
- **Sync V2  WS 通知（P0，须保留）**：`index.ts:988-1013` 的 `setSyncBroadcaster`；
  `backend/src/sync/notify.ts:53` `if (!broadcaster) return;` 未注入时静默降级为轮询兜底
  （`sync/notify.ts:17`）——**lite 不调用 attachRealtimeServer 也不注入 broadcaster，sync/ 零改动**
- **勿误裁**：`backend/src/sync/realtime.ts`（188 行）是 Sync V2 客户端远端通知订阅，复用 /ws 路径，属 P0
- **依赖**：`ws`（后端唯一 importer `services/realtime.ts:11`）、`y-codemirror.next`（`MarkdownEditorImpl.tsx:74,1482-1483`，
  在 P0 文件内，需条件导入）、`y-protocols`/`y-indexeddb`（`yjsProvider.ts:14-15`）
- **Yjs 边界**：`yjs` 本身是 P0（本地文档模型 + 持久化确认，`hooks/useYDoc.ts`、`y-indexeddb` 用途见
  assessment §5）——只删协作绑定，不删 yjs

### 2.6 sharing（分享/公开空间/评论，D6）

- **路由**（P1 中最多）：`/share/:token`（`App.tsx:1833-1842`）、`/notebook-share/:token`（`App.tsx:1844-1852`）、
  `/public`、`/public/:token`（`main.tsx:195-204`，lazy import `main.tsx:78`）
- **viewMode 渲染**：`App.tsx:574` → `App.tsx:1118-1122`（`<ShareManagementPage>`）；import `App.tsx:28`
- **导航**：`NavRail.tsx:93`（无 feature 键；本地模式拦截 `:189-193`）；显隐 `SettingsModal.tsx:793`；
  浮层 `FloatingLayerHost.tsx:60`；**公开空间 DOM 注入** `PublicSpaceLauncher.tsx:118-138`（扫 `.nav-rail`）
- **懒加载壳**：`LazySharedNoteViewRuntime.tsx:4-14`（alias `vite.config.ts:84-88`）、
  `LazyShareManagementPageRuntime.tsx:4-11`（`:133-136`）、`LazyNotebookShareJoinViewRuntime.tsx:4-14`（`:137-140`）
- **Deferred 桥**：`DeferredGlobalFeatureCenters.tsx:39`（`PublicSpaceLauncher`）
- **后端**：`shares.ts`（46 端点，`index.ts:639` + 公开 `sharedRouter` `index.ts:339`）、
  `notifications.ts`（`index.ts:642`；数据源 100% 协作：workspace_issues + share_comments，
  `services/notificationListing.ts:14-22`）
- **P0 表面内嵌入口**：笔记分享弹窗 5 处（`EditorPane.tsx:89,4761-4765`、`NoteList.tsx:9,4150`、
  `KnowledgeTreeNodeMenu.tsx:45,769-772`、`ShareManagementPage.tsx:19,622`、`DailyJournalView.tsx:27,833`）；
  笔记本分享 `KnowledgeTreeNodeMenu.tsx:44,767`；评论面板 `EditorPane.tsx:91,4816-4820`；
  评论管理中心 `App.tsx:8,1184`（事件 `lib/noteCommentNavigation.ts:7-11`）；行内评论桥 `main.tsx:30,245`

### 2.7 plugins（插件平台）

- **挂载**：`SettingsModal.tsx:20,1915,2109`（plugins tab → `settings/plugins/PluginSettingsTab.tsx:8-11`）
- **P0 表面内嵌入口（4 条链）**：
  - 插件 UI 悬浮层：`FloatingLayerHost.tsx`（特性门控 `:88` `pluginApi.features()`；挂载 `App.tsx:1196`）
  - 命令面板插件命令：`common/CommandPalette.tsx:30,116-123`
  - 新建模板选择器插件模板：`NoteTemplatePickerDialog.tsx:7`（对话框挂载 3 处：`CreateNoteMenu.tsx:159`、
    `KnowledgeTreeCreateMenuRuntime.tsx:309`、`MobileKnowledgeTreePanel.tsx:1748`）
  - AI 面板/设置内插件提示词：`AIChatPanel.tsx:42`、`AISettingsPanel.tsx:18,487`
- **剪藏（归 plugins/openApi 双侧）**：`WechatClipboardBridge.tsx:3`（挂载 `App.tsx:1764`）；
  Electron 侧 `electron/clipper-host.js`、`electron/clipper-native-host.js`（打包 `electron/builder.base.config.js:492-497`）；
  Android 分享导入 `main.tsx:27,242`（`AndroidShareImportCenter`，走 api.createNote，**P0 保留**）
- **后端**：`plugins.ts`（46 端点，`index.ts:629`）、`plugin-studio.ts`（`:628`）、`plugin-executions.ts`（`:632`）、
  `plugin-inbound.ts`（匿名 `:442`）、`clipper-local.ts`（`:609`）
- **启动副作用**：`index.ts:199-206`（recoverPluginUpdates）
- **依赖**：`quickjs-emscripten`（`backend/src/plugins/sandbox-child.mjs`）

### 2.8 openApi（MCP / CLI / SDK / Webhook / 剪藏凭证）

- **前端 UI 面很窄**：仅 `TokenManagement.tsx`（`SettingsModal.tsx:13,1920,2115`；自述「为 MCP、CLI 和
  自动化 Agent 创建独立令牌」`:183`）+ `TokenUsageStats.tsx`（`TokenManagement.tsx:19,200`）
- **Webhook 触发类型**：`automation/AutomationCenter.tsx:22`（随 automation 一并关）
- **后端**：`tokens.ts`（`index.ts:644`；`nkn_` 长期凭证签发/吊销面）、`webhooks.ts`（`index.ts:634`）
- **共用基础设施不可整体关**：`index.ts:509-540` API Token 认证分支、`index.ts:591` `enforceApiTokenAccess`
- **`initWebhookTables`（`index.ts:215`）必须保留**：notes/notebooks/tasks 等 P0 写路径同步调用
  `emitWebhook()`，表不存在会在每次写操作打印错误（`index.ts:209-214` 注释）。lite 只关 `/api/webhooks` 路由。
- **packages/* 独立工作区（P1 整体，不并入 frontend/backend 依赖树）**：`packages/nowen-mcp`、
  `packages/nowen-cli`、`packages/nowen-sdk`、`packages/nowen-clipper`、`packages/create-nowen-plugin`、
  `packages/nowen-extension-registry`

### 2.9 importCenter（多源迁移导入中心；D12 拆分后）

- **入口**：`SettingsModal.tsx:14,2119`（data tab → `DataManager.tsx`）
- **方法注册表（单一事实来源，可直接作 Lite 切分依据）**：`frontend/src/lib/importHub.ts:22-32`
  - `migration` 组（siyuan/obsidian/yuque/wechat-favorites/youdao/mobile-memo）→ **P1 裁**
  - `general` 组（generic=MD/TXT/HTML/PDF 文件；url）→ generic **P0 保留**；url 边界（见下）
  - `restore` 组（nowen=.nowen.zip 恢复）→ **P0 保留**
- **P1 组件**：`DataManager.tsx:31-38`（MiCloudImport/OppoCloudImport/iCloudImport/YoudaoImport/ObsidianImport/
  YuqueFileImport/WeChatFavoritesImport/UrlImport；条件渲染 `:1397,2006-2037`）；`DocxImportCenter.tsx`；
  `SiyuanImportProgressBridge.tsx`；`RoundTripImportBatchCenter.tsx`、`RoundTripImportReviewCenter.tsx`、
  `RoundTripPermissionMappingCenter.tsx`、`RoundTripPermissionMappingPanel.tsx`、
  `RoundTripPermissionExportCenter.tsx`；`NoteTransferCenter.tsx`；`SystemFullDataTransferBridge.tsx`；
  全局桥 `main.tsx:65-66,170-171`（`lib/roundTripImportReview.ts`、`lib/roundTripPermissionExport.ts`）
- **Deferred 桥**：`DeferredGlobalFeatureCenters.tsx:35,38,40-44`（7 个）
- **知识树「+」内的 P1 导入**：`CreateNoteMenu.tsx:107-118`（word/wechat；`lib/knowledgeTreeImport.ts:57,152`）；
  菜单项 `KnowledgeTreeCreateDropdown.tsx:22-25`（markdown/markdown-zip 是 P0，勿裁）
- **后端**（9 文件）：`export.ts`（子路径，见 §5）、`import-batches.ts`（`settings.ts:163` + `index.ts:647`）、
  `roundtrip-permissions.ts`（`settings.ts:165` + `index.ts:647`）、`url-import.ts`（`index.ts:625`；
  `routes/url-import.ts:295-302` 仅支持微信文章抓取——网络剪藏而非文件导入，建议 P1）、
  `micloud.ts`（`index.ts:617`）、`oppocloud.ts`（`:618`）、`icloud.ts`（`:619`）、
  `wechat-favorites-import.ts`（`remote-image-import.ts:135` → `attachments.ts:272` → `index.ts:649`）
- **依赖**：`mammoth`（前端 `workers/docxImport.worker.ts:2`、`lib/youdaoNoteService.ts`；
  **后端也在用**——`services/attachment-indexer.ts:225-226` 附件 docx 抽取供搜索，共享不可删，见 §7）

### 2.10 sheet（轻量表格）

- **路由**：`lib/sheetDeepLink.ts:12-19`（`/sheets/:id`）；状态 `App.tsx:482-484,509-512`；
  渲染 `App.tsx:568` → `App.tsx:1053-1060`（`<SheetEditor>`）；import `App.tsx:24`
- **入口（无 NavRail 条目，全在知识树与搜索）**：`KnowledgeTreeCreateDropdown.tsx:17`、`CreateNoteMenu.tsx:106`、
  `KnowledgeTreePanel.tsx:735,1023`、`MobileKnowledgeTreePanel.tsx:624,732`、`SearchCenter.tsx:26-27,297-302`、
  `common/CommandPalette.tsx:18,221-224`
- **无懒加载壳**：`SheetEditor` 是 App.tsx 静态 import，vite.config.ts 无 sheet alias，
  `startupChunkingContract.test.ts` 白名单也没有——**P1 主模块中唯一没有现成壳的**。W3 构建期剔除需新建壳
  或接受留在 App chunk。
- **后端**：`sheets.ts`（4 端点，`index.ts:622`）
- **跨层依赖（高风险）**：P0 附件预览内嵌 P1 SheetGrid：`attachmentPreview/AttachmentPreview.tsx:24` →
  `attachmentPreview/AttachmentXlsxPreview.tsx:4,114`（xlsx 识别 `lib/attachmentOpenStrategy.ts:55`）。
  Lite 裁 sheet 需决定 xlsx 附件预览降级方案（如仅下载）。

### 2.11 voiceMemo（语音备忘录）

- **全局录音浮层（根级）**：`main.tsx:15,234`（`<VoiceRecorderSheet>`）；事件 `nowen:voice-record`
  （`VoiceRecorderSheet.tsx:138`；API `lib/voiceMemo.ts:13-15`；调用方 `MarkdownEditorImpl.tsx:120,982`、
  `TiptapEditor.tsx:24,4749`）
- **编辑器内**：插入菜单 `VoiceInsertMenu.tsx:5`（`MarkdownEditorImpl.tsx:2456`、`TiptapEditor.tsx:5736`）；
  富文本节点 `TiptapEditor.tsx:22-23,2129`（VoiceMemoBlock + 扩展）；转写 `VoiceMemoBlock.tsx:5-6,20`
- **MD 预览/分享页渲染**：`MarkdownPreview.tsx:36-37,398`、`SharedNoteView.tsx:5`
- **设置入口（在 AI 设置内）**：`SpeechSettingsPanel.tsx`（`AISettingsPanel.tsx:19,488`）——随 ai 一并关
- **后端**：`voice.ts`（5 端点，`index.ts:627`；`services/speechTranscription.ts`）
- **schema 牵连**：导入/导出管线引用 VoiceMemo 块级标记（`lib/contentFormat.ts:48`、
  `lib/exportServiceCore.ts:21`、`lib/importService.base.ts:21`）——裁 voiceMemo 需决定历史数据渲染降级

### 2.12 automation（自动化）

- **唯一入口**：`SettingsModal.tsx:21,1916,2110`（automations tab → `automation/AutomationCenter.tsx:3,5,48`；
  触发类型 event/schedule/webhook/manual `:22`）
- **后端**：`automations.ts`（15 端点，`index.ts:633`；匿名 webhook trigger `index.ts:441`）、
  `automation-scanner.ts`（无路由，`index.ts:693,720,727`）
- **启动副作用**：`index.ts:592`（automationEventCaptureMiddleware）、`index.ts:954-958`（automationRuntime.start）、
  关停 `:1043`；`index.ts:701-735` 的提醒扫描同时服务任务（tasks 节）

---

## 3. P0 表面内嵌 P1 入口汇总（裁剪最易漏，逐条关门）

| P0 表面 | 内嵌 P1 入口 |
|---|---|
| `App.tsx:1048-1182` | 7 个 P1 视图分支 + 2 条公开分享路由 + 评论中心 `:1184` + 任务通知 `:778-785` |
| `main.tsx:225-245` | VoiceRecorderSheet、AndroidShareImportCenter（P0 保留）、DeferredGlobalFeatureCentersMount、InlineCommentBridge、PublicNotebookView 路由 |
| `NavRail.tsx:89-93` | diary/tasks/mindmaps/ai-chat/shares 五项（`:176` availableItems 过滤） |
| `EditorPane.tsx` | AI 摘要/Mermaid/标题/标签、分享弹窗、评论面板、PresenceBar、插入脑图、realtime |
| `MarkdownEditorImpl.tsx` / `TiptapEditor.tsx` | AIWritingAssistant、VoiceInsertMenu、requestVoiceMemo、VoiceMemoBlock、BlockEmbed(脑图)、日记 slash |
| `MarkdownPreview.tsx` | 脑图嵌入卡片、语音音频+转写 |
| `NoteList.tsx` | ShareModal、批量 AI 两按钮、realtime、CreateNoteMenu |
| `KnowledgeTreePanel.tsx` / `MobileKnowledgeTreePanel.tsx` / `KnowledgeTreeNodeMenu.tsx` / `CreateNoteMenu.tsx` / `KnowledgeTreeCreateDropdown.tsx` | 脑图/表格新建打开、Word/公众号导入、笔记/笔记本分享 |
| `SearchCenter.tsx` / `CommandPalette.tsx` | sheet/mindmap 结果跳转、插件命令 |
| `SettingsModal.tsx` | ai/plugins/automations/tokens/data 五个 P1 tab + 导航显隐设置 + 日记隐私卡 |
| `DataManager.tsx` | 8 个导入源 + 移动备忘录 + 任务数据迁移入口 |
| `AttachmentPreview.tsx` | xlsx → SheetGrid |
| `SlashCommands.tsx` | 日记 slash 命令 |

---

## 4. 后端路由全量分类（81 文件，2026-10-26 实测）

图例：P0 = Lite 保留；P1 = Lite 默认关闭；MIX = 同文件 P0/P1 子路径并存（§5）。

**P0-only（34）**：auth、users、knowledge-tree、notebooks、notes、blocks、note-templates、trash、
attachments-core、attachment-media-range、attachment-folders、files、search、search-exclusions、tags、
backups、backup-webdav、data-file、email、version、releases、system-update、fonts、workspaces、
workspace-issues、sync-v2、sync-v2-blob、sync-local、offline-sync、audit、note-transfers、folder-sync、
user-preferences-sync

**P1（41）**：ai、ai-reliable、tasks、habits、task-attachments、task-reminders、task-projects、
task-templates、task-dependencies、task-calendar、task-digest、task-inbox、task-metadata、task-day-plans、
task-time-blocks、diary、journals、mindmaps、mindmap-folders、shares、plugins、plugin-studio、
plugin-executions、plugin-inbound、clipper-local、url-import、micloud、oppocloud、icloud、voice、sheets、
tokens、webhooks、automations、automation-scanner、wechat-assistant、wechat-capture、
wechat-favorites-import、notifications、import-batches、roundtrip-permissions

**MIX（6，子路径级切分）**：export、settings、attachments、mobile-bootstrap、user-preferences-legacy、
user-preferences（明细见 §5）

边界判定备注：
- `workspace-issues.ts` 按 P0（工作区模块本体，P0 清单含 workspace）；但其写入方
  `services/workspaceIssues.ts:73` 与 P1 的 notifications 耦合
- `notifications.ts` 按 P1（数据源 100% 协作）；若 workspace-issues 保留 P0，此文件需子路径切分
- `folder-sync.ts` 按 P0（桌面本地 MD 文件夹同步，属基础 MD 导入变体）；若 Lite 要收敛"导入面"可再议
- `data-file.ts` 按 P0（.data 整库导出/导入 = 备份恢复变体）
- `offline-sync.ts` 按 P0（V1 change feed，已发布客户端在用）

---

## 5. MIXED 文件：不能整文件关，必须子路径级

| 文件 | P0 子路径 | P1 子路径 | 证据 |
|---|---|---|---|
| `export.ts` | `/import` `:524`（基础批量导入）、`/import/nowen-package` `:926`、`/notes` `:255`、`/markdown-package/jobs` `:293,348` | `/import/origins/resolve` `:404`、`/import/origins/register` `:458`、`/import/siyuan-package` `:782,789,796` | `backend/src/routes/export.ts` |
| `settings.ts` | 根 settings GET/PUT、`/system-update` `:161` | `/import-batches` `:163`、`/roundtrip-permissions` `:165` | `routes/settings.ts:161-165` |
| `attachments.ts` | 全部附件能力 | `:272` 挂载 remote-image-import（其 `:135` 又挂 wechatFavoritesImport） | `routes/attachments.ts:272` |
| `mobile-bootstrap.ts` | `:283-285,288` notes/notebooks/tags/preferences | `:286-287` sharedNoteIds/sharedNotebooks | `routes/mobile-bootstrap.ts:273-289` |
| `user-preferences-legacy.ts` | `:488-523,573,580` note-icons/根偏好 | `:312-472` 全部 `/ai-profiles*` | `routes/user-preferences-legacy.ts:312-472` |
| `user-preferences.ts` | 根 GET/PUT/PATCH、`/sync` | `:21,25,29,33` task-day-plans/metadata/time-blocks/inbox、`:40` ai-reliable | `routes/user-preferences.ts:21-40` |

---

## 6. 后端挂载处与启动副作用（W2 操作面）

**主挂载块**：`backend/src/index.ts:595-650`（含全部 P1 模块）+ `:681-688`（task-reminders/projects/templates/
dependencies/calendar）；匿名区 `:339`（sharedRouter）、`:441-443`（automation webhooks/plugin-inbound/wechat callback）、
`:438`（diary 图片）、`:227`（task-calendar ICS）

**4 处 runtime 补丁挂载（模块加载即注入，W2 唯一暗礁）**：
- `backend/src/runtime/note-appearance.ts:96,103-106`（`/api/note-appearance`，挂 `/api/notes` 时）
- `backend/src/runtime/task-stats-hardening.ts:274-285`（task stats + `/api/note-transfers`，挂 `/api/tasks`、`/api/notebooks` 时）
- `backend/src/runtime/backup-webdav.ts:9`（`/webdav` 子路由注入 backupsRouter）

**P1 启动副作用**（lite 条件化）：`index.ts:199-206` recoverPluginUpdates、`:592` automationEventCapture、
`:701-735` 提醒扫描、`:927-946` vec init/reindex、`:948-952` embedding worker、`:954-958` automationRuntime.start、
`:962-966` taskDigest 定时器、`:971-975` calendar scheduler、`:983` attachRealtimeServer、`:766-773` 调试端点、
`:1043` automationRuntime.stop；`index.hardened.ts:5-7,15,19-21,23`（任务 migration bootstrap ×3、
task-stats-hardening、micloud hardening ×2、embedding-queue-hardening）

**WS 关闭切点（4 处，全在 index.ts）**：`:983` attachRealtimeServer（`noServer:true`，不调用即完全不注册
upgrade 监听，`/ws` 自然不可达）、`:766-773` 调试端点、`:991-993` setSyncBroadcaster、`:1014` 日志行

---

## 7. 依赖清单（VITE_LITE 剔除候选；精确清单以 W3 构建分析为准）

### 7.1 P1 专属，可移除

| 依赖 | 侧 | 使用位置 |
|---|---|---|
| `ws` | backend | `backend/src/services/realtime.ts:11`（全 src 唯一 import） |
| `sqlite-vec` | backend | `db/sqlite-vec-extension.ts`、`services/vec-store.ts:25`（importers 仅 ai.ts/ai-reliable.ts） |
| `word-extractor` | backend | `routes/ai.ts:790,1429` |
| `quickjs-emscripten` | backend | `plugins/sandbox-child.mjs` |
| `cron-parser` | backend | `automation/workflowRepository.ts` |
| `lunar-javascript` | 两侧 | 前端 `components/tasks/lunarUtils.ts:1`；后端 `lib/lunar.ts:12`（**孤儿**：零 importers，三件套可删） |
| `y-codemirror.next` | frontend | `MarkdownEditorImpl.tsx:74`（P0 文件内，需在 `:1482-1483` collabEnabled 分支条件导入） |
| `y-protocols` | 两侧 | 前端 `yjsProvider.ts:14`；后端**零 import**（死依赖） |
| `y-indexeddb` | frontend | `yjsProvider.ts:15`（唯一 import） |
| `mammoth` | 两侧 | 前端 docxImport.worker/youdaoNoteService；后端 `services/attachment-indexer.ts:225-226`（**共享，见 7.3**） |

### 7.2 死依赖（与模块无关，直接删）

`bonjour`（frontend，零 import）、`y-protocols`（backend，零 import）、`lunar-javascript` + `src/lib/lunar.ts` +
`src/lunar-javascript.d.ts`（backend 三件套）

### 7.3 P0 共享，**禁止**随 P1 删除（强警示）

| 依赖 | P1 用法 | P0 用法 |
|---|---|---|
| `yjs` | yjsProvider（协作） | `hooks/useYDoc.ts`、`markdownYTextSync.ts`、`yjsDurability.ts`、`yjsSubdocumentModel.ts`（本地文档模型+持久化确认） |
| `mermaid` | —（脑图编辑器不用它） | `lib/mermaidRenderer.ts` → `MermaidView.tsx`、`CodeBlockView.tsx`（D1/D13 明确保留） |
| `mammoth` | docx/有道导入 | 后端 `attachment-indexer.ts:225-226`（附件 docx 文本抽取供搜索） |
| `html2canvas` / `jspdf` | —（**无 P1 用法**） | `lib/noteImageExportCore.ts:654-655`、`lib/exportServiceCore.ts:1669-1675`（笔记导出图片/PDF，**P0**）。assessment 候选移除清单中的这两项应划掉 |
| `jszip` | taskDataTransfer/voiceMemoExport | 导入/导出/Sheet/知识树 MD drop 等 20+ 处 |
| `idb` | voiceMemoDraftStore | `lib/localStore.ts`（本地存储基座） |
| `hash-wasm` | yuqueFileImport | `lib/encryptedNotes/crypto.ts`（加密笔记） |
| `unzipper` / `busboy` / `archiver` / `sharp` / `ffmpeg-static` / `libheif-js` / `unpdf` | 各 P1 导入路径 | 备份恢复、附件索引、缩略图、媒体处理（P0） |
| `bonjour-service` | — | `services/discovery.ts:46` mDNS 发布（`index.ts:1021-1030`），部署便利，P0/P1 边界 |

### 7.4 Capacitor 插件

**唯一 P1 专属**：`@capacitor/local-notifications`（`lib/taskNotifications.ts:2`，全仓单点 import）。
其余全部 P0 或 P0 主用：`@capacitor-community/sqlite`（加密笔记 native DB，`lib/nativeDatabase.ts:3-7`，
注意 schema 含 P1 实体表 `:51-60`）、`@aparajita/capacitor-secure-storage`、`@aparajita/capacitor-biometric-auth`、
`@mhaberler/capacitor-zeroconf-nsd`、`@capacitor/filesystem`、`@capacitor/network`、`@capacitor/browser` 等。
`frontend/capacitor.config.ts` 的 plugins 块**无需为 Lite 修改**（与 D9 一致：插件代码不删，lite 下无引用）。

---

## 8. 存疑待确认（需产品/用户拍板，未擅自决定）

1. **issues 模块（WorkspaceIssues/NotificationCenter）归属未定**：不在 D1-D13 的 P1 清单，也不在 P0 清单。
   路由 `/issues`、`/issues/:id`（`lib/workspaceIssueNavigation.ts:5-8`），渲染 `App.tsx:1061-1068`，
   NavRail 入口 `NavRail.tsx:367`、Sidebar `Sidebar.tsx:446`、通知铃铛 `NavRail.tsx:301-325`。
   注册表暂未收录，待用户决策。
2. **`NoteTransferCenter` / `SystemFullDataTransferBridge` 归属**：暂归 importCenter（多源迁移）。但前者是
   「个人空间↔团队空间」复制/移动（可能属账号/协作 P0），后者是整机备份式迁移（可能属备份恢复 P0）。
3. **`components/share/ShareOutline.tsx` 疑似死代码**：全仓无生产 import。删除前需确认。
4. **`components/TaskDataTransferBridge.tsx`（V1）疑似被 V2 取代**：DeferredGlobalFeatureCenters 只挂 V2，
   V1 无生产 import。
5. **`AttachmentXlsxPreview` 造成 P0→P1 依赖**：P0 附件预览链路硬依赖 P1 SheetGrid，裁 sheet 需定降级方案。
6. **`hooks/useYDoc.ts` / `hooks/useRealtimeNote.ts` 被 P0 EditorPane 直接使用**：裁 collab WS 层不能只删
   `lib/realtime.ts`，需连带处理 EditorPane 的 presence/协同分支（`EditorPane.tsx:108-110,1294-1296,4412`）。
7. **移动端本地模式 shim**：`lib/mobileLocalModuleBridge.ts`、`lib/mobileLocalAdvancedTaskBridge.ts`、
   `lib/mobileLocalMindMapTree.ts` 在 Android 无账号本地模式实现 task/diary/mindmap 数据层。Lite 若仍支持
   Android 本地模式，这些 shim 要保留；否则同步处理。
8. **`lib/voiceMemo.ts` 等被 P0 导入/导出 schema 引用**（`contentFormat.ts:48`、`exportServiceCore.ts:21`、
   `importService.base.ts:21`）：裁 voiceMemo 需决定导出/导入管线是否保留块级 schema。
9. **命名冲突（重要）**：仓库已有三个" Lite"：
   - `electron/builder.lite.base.config.js`（remote-only Electron 分发变体，appId `com.nowen.note.lite`，无功能裁剪）
   - `backend/src/sync/liteMigration.ts`（v1.4.x remote-only 运行时）
   - 本项目的功能维度 Lite（`NOWEN_PROFILE=lite` / `VITE_LITE`）
   建议实现时显式区分术语（如功能裁剪称 `core`/`slim`），或在全部文档中固定"Lite = 功能裁剪产品线"口径。
10. **未检查范围**：`nowen-harmony/`、i18n 文案键（`frontend/src/i18n/locales/*.json` 含 P1 字符串，
    裁剪时需同步清理，本次未逐条清点）。

---

## 9. 与任务简报/设计文档的偏差（已核实的事实修正）

1. `backend/src/routes/` 实为 **81 个** `.ts` 文件（brief 与 assessment 记 60+/75）；P1 41 + P0-only 34 + MIX 6。
2. 前端**无 react-router**，"前端路由"实为 viewMode 状态机 + deep link 解析器（见 §0）。
3. `Lazy*Runtime` 无生产 import，靠 vite alias——按"搜 import"测绘会全部漏掉（见 §0）。
4. assessment §5「候选移除依赖」中的 `html2canvas`/`jspdf` 经核实为 **P0 笔记导出在用**，应从移除清单划掉。
5. `youdao/yuque/siyuan/obsidian/docx` **不是后端路由文件**（前端 lib 实现），后端仅有 SiYuan 服务层
   （`backend/src/services/siyuanPackageImport.ts` 等）。
6. Sheet 是 P1 主模块中唯一没有 `Lazy*Runtime`/vite alias 的（W3 需新建壳或接受留 App chunk）。

---

## 10. D12 验证结论（Leanote HTML 导入兼容性）

**结论：现有「导入为富文本」链路兼容 Leanote 风格 HTML 导出；未获得真实 Leanote 导出文件，以重建样本实测通过。**

- **链路**（P0，D12 保留）：文件选择 → `readMarkdownFiles`（`frontend/src/lib/importService.ts:113-122`，
  对 HTML 源先过 `normalizeImportedHtmlContent`，`frontend/src/lib/singleFileHtmlImport.ts:109-129`，
  DOMParser 提取正文根、剥脚本/样式/属性）→ `detectHtmlSource` 判为 `"html"`
  （`importService.base.ts:386-394`，Leanote 不命中任何手机品牌关键词）→ `extractTitleFromHtml` 取 `<title>`
  （`:455-467`）→ `convertToTiptapJson`（`:1285-1291` `cleanHtmlContent` → `generateJSON` + headless editor
  兜底 `:1310-1340`）→ `importNotes` 以 `contentFormat:"tiptap-json"` 提交 → 后端 `POST /api/export/import`
  （`backend/src/routes/export.ts:524`）落库，内联 base64 图片自动抽附件（`:676-679` updateContent）
- **实测**：`frontend/src/lib/__tests__/leanoteHtmlImportCompat.test.ts`（6 用例全过，2026-10-26）：
  标题提取、标题/段落/列表/链接/图片/引用保留、CJK 边界（汉字后紧跟空格/逗号/单引号逐字保留）、
  脚本与内联样式剥离、载荷形状、远程图片 src 原样保留
- **样本口径（重要）**：样本为按 Leanote 导出特征**重建**（完整 HTML 文档 + `<title>` + div/inline-style 正文 +
  base64 图片），**非真实 Leanote 导出文件**。判断依据：链路对"完整 HTML 文档 + div 段落 + 内联样式"这一
  结构类别有专门处理（content root 回退 `body`、div→p、br→分段、headless editor 兜底），Leanote 导出
  落在该类别内。**真实样本人工 smoke 列为 W7 AC-12**，通过后才可宣称 D12 关闭。
- **已知限制（不阻塞导入，需人工跟进）**：
  1. 远程图片（Leanote 服务器 URL）原样保留，导入后不会自动本地化（generic 导入无图片本地化，
     仅 wechat-favorites 有）——Leanote 停服后图片 404。迁移 runbook 需提示用户先下载图片或接受丢失。
  2. Leanote 富文本待办（checkbox）经 `singleFileHtmlImport.ts:21` REMOVABLE_ELEMENTS 移除 `input` 后，
     checkbox 状态丢失，导入为普通列表项。
  3. Leanote 笔记元数据（创建时间/标签/笔记本归属）不在 HTML 内，导入后丢失；批量导入建议优先用
     Leanote 的 Markdown 导出（frontmatter 日期可被 `extractFrontmatterDates` 识别，`importService.base.ts:1417-1421`）。
