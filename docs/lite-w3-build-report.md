# Lite 模式 W1-W3 实施报告：profile 门 + 挂载过滤 + 构建开关

> 分支：`feat/lite-trim`（基于 S2 提交 `a95e6d78`）
> 范围：W1 前端 profile 门、W2 后端挂载过滤与禁用错误、W3 `VITE_LITE` 构建期剔除
> 边界遵守：不删 P1 代码、不改 P0 行为、不动 `backend/src/sync/` 与 Electron；完整模式（默认）零变化

---

## 1. 机制总览

Lite 模式由三个正交开关组成，可独立或组合使用：

| 开关 | 层 | 作用 | 默认 |
|---|---|---|---|
| `NOWEN_PROFILE=lite`（环境变量） | 后端 | 25 条 P1 路由改返 403 `feature_disabled`；WS/vec/embedding/automation/digest/calendar 等启动副作用不启动；6 个 MIXED 文件子路径级 guard | 完整模式 |
| `profile: "lite"`（`GET /api/settings` 下发） | 前后端契约 | 前端 `setServerFeatureProfile()` 接收后 `isFeatureEnabled()` 对 P1 恒 false，导航/编辑器/知识树/搜索/设置各表面入口隐藏 | `full` |
| `VITE_LITE=1`（构建期） | 前端构建 | vite alias 把 22 个 P1 规格精确替换为壳组件/stub 模块，对应 chunk 不进入产物 | 完整构建 |

三者关系：**构建开关做体积，运行开关做行为**。只设 `VITE_LITE=1` 不设后端 profile 时，前端 P1 入口已消失但 API 仍可用（隐藏 ≠ 授权，后端仍完整）；反向同理。生产 Lite 部署建议两者同时设置。

## 2. 新增文件

| 文件 | 作用 |
|---|---|
| `backend/src/profile.ts` | `SERVER_PROFILE`、`isLiteProfile()`、`isFeatureEnabled(feature)`（P1 集合 12 键）、`featureDisabledBody(feature)`（403 体）、`featureGuard(feature): MiddlewareHandler` |
| `frontend/src/components/LiteDisabledFeature.tsx` | 默认导出返回 `null` 的组件壳（VITE_LITE alias 目标） |
| `frontend/src/lib/liteFeatureStubs.ts` | `yCollab()` 返回 `[]`；docx 四函数抛 `Lite 配置下不可用：${name}`（VITE_LITE alias 目标） |
| `frontend/src/lib/__tests__/featureProfileGate.test.ts` | 前端门 5 用例 |
| `backend/tests/profile-gate.test.ts` | 后端门 4 用例（含 lite 子进程断言 SERVER_PROFILE/Hono 403/错误体 deepEqual） |

## 3. W1 前端 profile 门（`featureRegistry.ts` 末尾新增）

- `getFeatureProfile()` / `setServerFeatureProfile()`（变化时 dispatch `nowen:feature-profile-changed`，同值不重复）、`isFeatureEnabled(feature)`（full 恒 true）、`useFeatureProfile()` hook、`isNavigationModeEnabled(mode)`（NAV_MODE_FEATURE 映射 diary/tasks/mindmap/ai-chat/shares）。
- profile 下发链路：`backend/src/index.ts:363` 公开 `GET /api/settings` 的 result 加 `profile: SERVER_PROFILE`（前端 `getSiteSettingsPublic` 实际命中此内联 handler；`routes/settings.ts` 的 PUT 响应同步加）；`useSiteSettings.tsx` 三处调用 `setServerFeatureProfile`（mobile-local=full、成功=data.profile、catch=full 兜底）。
- **App 外壳**（`App.tsx`）：五个视图布尔（sheet/tasks/mindmap/ai-chat/diary/shares）追加 `isFeatureEnabled`；`applyRoute` 中 sheet/mindmap 路由命中但 feature 禁用时 `replaceAppPathState("/")`；viewMode→路由回写 mindmaps 分支加门；新增 effect：viewMode 属被禁模块时回落 `setViewMode("all")`；`/share/:token` 与 `/notebook-share/:token` 公开路由条件匹配（禁用落 AuthGate）。
- **挂载门**：`CommentManagementCenter`、`FloatingLayerHost`(plugins)、`SidebarSearchExperienceBridge`(tasks)、`WechatClipboardBridge`(plugins)；`main.tsx` 的 `VoiceRecorderSheet`(voiceMemo)、`InlineCommentBridge`(sharing)、`PublicNotebookView` 路由(sharing)。
- **NavRail**：`availableItems`/`capabilityItems` 两处 filter 加 `isNavigationModeEnabled`（本地设备模式仍全量列项、仅按 profile 过滤——已同步修正 `MobileNavigationRail.test.ts` 断言）。
- **DeferredGlobalFeatureCenters**：15 个桥逐个门（ai×2/mindmap/tasks/importCenter×7/sharing；MarkdownExperience/BackupWebDav/NoteImageExport 保持 P0）。
- **collab 总闸**：`lib/realtime.ts` `connect()` 首行 `if (!isFeatureEnabled("collab")) return`——覆盖 useYDoc/useRealtimeNote/EditorPane/NoteList/yjsProvider 全部调用方，防止向不存在的 `/ws` 重连；`useReminderNotifier.ts` tasksEnabled 早退。
- **P0 表面内嵌入口**（两个并行子代理 + 人工补漏，全部带行号变更）：EditorPane（AI 按钮约 8 处、分享/评论、PresenceBar、脑图插入对话框）、MarkdownEditorImpl/TiptapEditor（AIWritingAssistant、VoiceInsertMenu、日记 slash 条件展开）、NoteList（批量 AI、ShareModal）、SlashCommands、AttachmentXlsxPreview（lite 渲染降级提示不渲染 SheetGrid）、SettingsModal（navigationVisibilityItems 5 项、日记隐私卡、ai/plugins/automations/tokens 四个 tab）、DataManager（importMethodGroups 按 importHub 分组过滤 migration 全组+url、任务数据迁移 section、6 个导入源条件渲染）、KnowledgeTreeCreateDropdown、KnowledgeTreeNodeMenu、KnowledgeTreePanel、MobileKnowledgeTreePanel、SearchCenter、CommandPalette、FloatingLayerHost（VIEW_TARGET_FEATURE 映射 + load() 早退）、**MindMapEmbedCard**（两个代理范围均遗漏，人工补：openEditor/openEmbeddedEditor 早退门 mindmap）。
- 完整模式下 `isFeatureEnabled` 恒真，所有门为 no-op，**P0 行为零变化**。

## 4. W2 后端挂载过滤

- `index.ts` 新增 `mountFeature(path, router, feature)`：启用=`app.route`；禁用=`app.all(path)`+`app.all(path+"/*")` 返回 403 `{error:"feature_disabled",feature,message}`。
- 匿名区即门控：`/api/shared`(sharing)、`/api/automation/webhooks`(automation)、`/api/plugin-inbound` 与 wechat-assistant callback(plugins)、diary 图片(diary)、task-reminders recent/ack 内联 handler(tasks)、ICS(task-calendar)。
- 主挂载块 25 条 P1 路由改 `mountFeature`；MIXED 文件（export/settings/attachments/user-preferences 系）保持 `app.route`，子路径用 `featureGuard` 中间件（共 22 条 `app.use`/`router.use`）：export.ts（/import/origins*、/import/siyuan-package*）、settings.ts（/import-batches*、/roundtrip-permissions*）、remote-image-import.ts（`router.use("*")` 覆盖含 wechat-favorites 子挂载）、user-preferences.ts（task-day-plans/metadata/time-blocks/inbox + ai-reliable 共 10 条）、user-preferences-legacy.ts（/ai-profiles* 置于 requireAIProfileUser 之前）、mobile-bootstrap.ts（sharingEnabled 条件查询+条件展开 sharedNoteIds/sharedNotebooks）。
- 启动副作用条件化：提醒扫描 setInterval 回调（tasks||automation 早退）、realtime/yjs stats 调试端点(collab)、vec init+reindex 与 embedding worker(ai)、automationRuntime.start(automation)、taskDigestTimer(tasks)、startCalendarExportScheduler(tasks)、`attachRealtimeServer`(collab)、`setSyncBroadcaster`（collab 单独条件化，`sync/notify.ts:53` 未注入即静默降级轮询，崩溃恢复/reconcile 不动）、WS 日志行。
- `automationEventCaptureMiddleware` 包 automation if；`recoverPluginUpdates` 包 plugins if。
- **按数据安全保留**（报告中注明）：mDNS publish（部署便利非功能模块）、`index.hardened.ts` migration bootstrap（任务表结构迁移，关停会破坏既有数据升级路径）。

## 5. W3 构建开关（`frontend/vite.config.ts`）

- `LITE_FEATURE_ALIASES`：`VITE_LITE=1|true` 时用 `exactAlias`（RegExp 精确匹配+特殊字符转义）把 22 个规格映射到壳——
  - 组件壳（20 个）：`@/components/{AIChatPanel,AISettingsPanel,TaskCenter,MindMapEditor,DiaryCenter,ShareManagementPage,SharedNoteView,NotebookShareJoinView,PublicNotebookView,SheetEditor,SheetGrid,VoiceRecorderSheet,FloatingLayerHost,MiCloudImport,OppoCloudImport,iCloudImport,YoudaoImport,ObsidianImport,YuqueFileImport,WeChatFavoritesImport,UrlImport}`
  - 模块壳（2 个）：`@/lib/wordNoteService`、`y-codemirror.next`
- `resolve.alias` 改为 `[...LITE_FEATURE_ALIASES, ...原数组]`（lite 项必须前置于基础 alias 与 `@` 通用 alias）。
- **关键修复**：`MindMapEmbedCard.tsx` 的 `lazy(() => import("./MindMapEditor"))` 是 P0 宿主里的相对动态导入，alias 命中不了导致 MindMapEditor chunk 残留——改为 `import("@/components/MindMapEditor")`（完整模式下经既有 alias 走 LazyMindMapEditorRuntime，行为等价）。rg 审计确认其余 P1 根的相对导入均在 P1 树内部，无其他 P0 宿主相对导入。
- `startupChunkingContract.test.ts:70` 同步放宽为正则匹配两种规格写法。

## 6. 构建对比（同机两次 `npm run build`）

| 指标 | full | `VITE_LITE=1` | 差值 |
|---|---|---|---|
| js/css/mjs 合计 | 18,604,461 B | 17,028,786 B | **-1,575,675 B（-8.5%）** |
| 产物文件数 | 339 | 313 | -26（25 个 chunk 消失，新增 liteFeatureStubs.js） |
| 最大 index.js | 2,375,860 B | 2,359,694 B | -16,166 B |
| dist 总大小（du -sh） | 23M（assets 22M） | 21M（assets 20M） | -2M |

消失的大块：TaskCenter 588KB、TiptapEditorInitializationRuntime 516KB、docxImport.worker 305KB、VoiceTranscription 212KB、DiaryCenter 125KB、taskInboxApi 88KB、MindMapEditor 80KB、AIChatReliabilityShell 52KB、SharedNoteCommentDisplayRuntime 45KB、wordNoteService 40KB、exportService 39KB、ShareManagementPage 22KB、PublicNotebookView 18KB、sheetXlsx 16KB 等。

**残留均为 P0 合法**（逐一核实）：
- mermaid 系（mermaid.core/flow/cynefin/mindmap-definition）= mermaid 的 mindmap 图表语法，D1/D13 明确保留；
- DocxAttachmentPreview（src/office/word）= P0 附件预览；
- DocxImportCenter 链 = 经 DeferredGlobalFeatureCenters 相对导入的 P0 性能边界，mammoth 主链已被 wordNoteService alias 切断；
- y-protocols/y-indexeddb = 经 useYDoc 静态导入，P0 hook 内 enabled=false 不建连。

## 7. Lite 运行 smoke（实测）

环境：`NODE_ENV=production NOWEN_PROFILE=lite PORT=3111 JWT_SECRET=... FRONTEND_DIST=<repo>/frontend/dist npm run dev`（backend），Playwright + 系统 Chrome。

| 检查项 | 结果 |
|---|---|
| `GET /api/settings` 返回 `profile` | `lite` PASS |
| 登录页渲染（密码框+登录文案） | PASS |
| 登录页无 P1 导航文案（任务中心/思维导图/AI 助手/每日记录/分享管理/轻量表格） | PASS |
| 页面加载的 script 无 P1 chunk | PASS（仅 1 个入口 script） |
| console 错误 | 无 |

## 8. 全量验证（与 HEAD 基线逐条比对，零劣化）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.app.json`（frontend） | 全绿 |
| `frontend npm run test:run` | 34 failed / 3430 passed（631 文件）；HEAD stash 复跑同为 34 失败，逐条 comm 比对零新增；净修复 2 个既有失败（startupChunkingContract、MobileNavigationRail 各 1） |
| `frontend npm run lint` | 1701 problems（1452 error/249 warning），与 HEAD stash 态完全一致，本次改动零新增 |
| `backend npx tsc --noEmit` | 184 条错误，与 HEAD 逐条一致（既有债务，本次文件零新增） |
| `backend npm test` | 335 passed / 1 failed / 336 文件；唯一失败 docker-plugin-artifacts 已 stash 复现确认 HEAD 同样失败（因上述 tsc 既有错误导致构建失败） |

既有失败 34 个全部与本次无关（EditorPaneMobileHeader×2、EditorPaneSaveSafety×3、CodeBlockView×4、MobileNavigationRail×3、SyncStatusBadge.mobile×2、removedConnectionFeatures×2、useAttachmentVideoRenderSource×3 等）。

测试契约修复 3 处（均为断言随实现演进而更新、意图保留）：startupChunkingContract 规格正则、MobileNavigationRail capabilityItems 口径、backend task-stats-standard-entry 搜索串兼容 mountFeature 写法。

## 9. 使用方式

```bash
# 完整模式（默认，零变化）
npm run dev

# Lite 运行（前端 + 后端都设）
VITE_LITE=1 npm run build           # 前端构建（frontend/）
NOWEN_PROFILE=lite npm run dev      # 后端（backend/）

# 仅构建开关（前端隐藏入口，API 仍完整）
VITE_LITE=1 npm run build

# 仅运行开关（前端全量，P1 API 返 403）
NOWEN_PROFILE=lite npm run dev
```

生产 Lite 部署建议同时设置 `VITE_LITE=1` 与 `NOWEN_PROFILE=lite`。注意仓库既有同名不同义的「Lite」：`electron/builder.lite.*` 指 remote-only 分发变体（无内置 backend），与本功能裁剪无关（见 p1-shutdown-surface.md §8 存疑 #6）。

## 10. 遗留与后续

1. **真实 Leanote 导出样本 smoke** 未做（D12 测试样本为重建）——W7 AC-12。
2. **P1 关闭面 10 项存疑** 待产品拍板（issues 模块归属、NoteTransferCenter/SystemFullDataTransferBridge 归属、ShareOutline/TaskDataTransferBridgeV1 死代码确认、mobileLocal* shim、命名冲突等）——见 `docs/p1-shutdown-surface.md` §8。
3. **lite 下 yCollab/wordNoteService stub 的调用方**（MarkdownEditorImpl 的 collabEnabled 分支、docx 导入入口）在运行期是否还有可达路径，建议 W7 用手工用例复核（本次以单测+构建剔除覆盖）。
4. mDNS publish 与 index.hardened.ts migration bootstrap 按数据安全保留未门控，如需严格 Lite 可再评估。
5. Electron/Capacitor 打包侧未动（brief 边界）；`electron/builder.lite.*` 与功能 Lite 的命名统一留待文档修订。
