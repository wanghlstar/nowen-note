/**
 * Lite 模式模块注册表（单一事实来源）。
 *
 * 分级依据 docs/lite-mode-assessment.md §5.1 决策记录 D1-D13；
 * 关闭面明细（路由/导航/懒加载/后端挂载行/依赖的 file:line 证据）见
 * docs/p1-shutdown-surface.md。本文件只做「开关 + 清单」，不是插件系统。
 *
 * backendRoutes 为 backend/src/routes/ 文件名；P0/P1 子路径同文件的（export.ts、
 * settings.ts、attachments.ts、user-preferences*.ts）按子路径级切分，见关闭面清单 §MIXED。
 */

export type FeatureTier = "P0" | "P1";

export interface FeatureEntry {
  /** P0 = 任何模式保留；P1 = Lite 默认关闭（完整模式可开） */
  readonly tier: FeatureTier;
  /** 前端 viewMode 状态机成员（frontend/src/types/index.ts ViewMode） */
  readonly viewModes?: readonly string[];
  /** URL 路由 / deep link 路径（解析位置见关闭面清单） */
  readonly routes?: readonly string[];
  /** 导航/功能入口（NavRail mode、SettingsModal tab 或导航显隐 id、FloatingLayerHost target） */
  readonly nav?: readonly string[];
  /** 懒加载注册点：vite.config.ts alias 的 *Runtime 壳（App.tsx 静态 import 经 alias 变懒加载） */
  readonly chunks?: readonly string[];
  /** DeferredGlobalFeatureCenters 挂载的全局桥/中心 */
  readonly deferredCenters?: readonly string[];
  /** backend/src/routes/ 路由文件（挂载行见关闭面清单） */
  readonly backendRoutes?: readonly string[];
  /** backend/src/index.ts 内该模块的启动副作用（定时器/扫描/初始化），lite 需条件化 */
  readonly backendStartup?: readonly string[];
  /** Capacitor 插件（仅 P1 专属） */
  readonly capacitorPlugins?: readonly string[];
  /** npm 依赖：P1 专属、VITE_LITE 可剔除（P0 共享依赖见关闭面清单 §依赖） */
  readonly dependencies?: readonly string[];
}

export const FEATURES = {
  notes: {
    tier: "P0",
    viewModes: ["notebook", "all", "favorites", "trash", "tag", "search", "files"],
  },
  importBasic: {
    tier: "P0",
    nav: ["SettingsModal#data → DataManager generic（MD/TXT/HTML 文件导入）", "知识树「+」markdown/markdown-zip"],
    backendRoutes: ["export.ts", "folder-sync.ts"],
  },
  encrypted: {
    tier: "P0",
    capacitorPlugins: ["@capacitor-community/sqlite", "@aparajita/capacitor-secure-storage", "@aparajita/capacitor-biometric-auth"],
  },

  ai: {
    tier: "P1",
    viewModes: ["ai-chat"],
    nav: ["NavRail:ai-chat", "SettingsModal#ai", "SettingsModal#navigationVisibility:ai-chat", "FloatingLayerHost:ai-chat"],
    chunks: ["LazyAIChatPanelRuntime", "AISettingsReliabilityShell"],
    deferredCenters: ["AIProfileSwitcherBridge", "EmbeddingIndexTaskCopyBridge"],
    backendRoutes: ["ai.ts", "ai-reliable.ts"],
    backendStartup: ["index.ts:927-946 initVecStore/reindex", "index.ts:948-952 startEmbeddingWorker"],
    dependencies: ["sqlite-vec", "word-extractor"],
  },
  tasks: {
    tier: "P1",
    viewModes: ["tasks"],
    nav: ["NavRail:tasks", "SettingsModal#navigationVisibility:tasks", "FloatingLayerHost:tasks", "DataManager 任务数据迁移按钮"],
    chunks: ["LazyTaskCenterRuntime"],
    deferredCenters: ["TaskDataTransferBridgeV2"],
    backendRoutes: [
      "tasks.ts",
      "habits.ts",
      "task-attachments.ts",
      "task-reminders.ts",
      "task-projects.ts",
      "task-templates.ts",
      "task-dependencies.ts",
      "task-calendar.ts",
      "task-digest.ts",
      "task-inbox.ts",
      "task-metadata.ts",
      "task-day-plans.ts",
      "task-time-blocks.ts",
    ],
    backendStartup: ["index.ts:701-735 提醒扫描 30s", "index.ts:962-966 taskDigest 定时器", "index.ts:971-975 startCalendarExportScheduler"],
    capacitorPlugins: ["@capacitor/local-notifications"],
    dependencies: ["lunar-javascript"],
  },
  diary: {
    tier: "P1",
    viewModes: ["diary"],
    nav: ["NavRail:diary", "SettingsModal#navigationVisibility:diary", "FloatingLayerHost:diary", "SettingsModal#switches 日记隐私卡"],
    chunks: ["LazyDiaryCenterRuntime"],
    backendRoutes: ["diary.ts", "journals.ts"],
    dependencies: [],
  },
  mindmap: {
    tier: "P1",
    viewModes: ["mindmaps"],
    routes: ["/mindmaps", "/mindmaps/:uuid"],
    nav: ["NavRail:mindmaps", "SettingsModal#navigationVisibility:mindmaps", "FloatingLayerHost:mindmaps", "知识树新建/打开脑图", "编辑器插入脑图"],
    chunks: ["LazyMindMapEditorRuntime"],
    deferredCenters: ["MindMapAppearanceBridge"],
    backendRoutes: ["mindmaps.ts", "mindmap-folders.ts"],
    dependencies: [],
  },
  collab: {
    tier: "P1",
    nav: ["编辑器 PresenceBar（EditorPane 更多菜单）"],
    deferredCenters: [],
    backendRoutes: [],
    backendStartup: ["index.ts:983 attachRealtimeServer", "index.ts:988-1013 setSyncBroadcaster", "index.ts:766-773 realtime/yjs stats 调试端点"],
    dependencies: ["ws", "y-codemirror.next", "y-protocols", "y-indexeddb"],
  },
  sharing: {
    tier: "P1",
    viewModes: ["shares"],
    routes: ["/share/:token", "/notebook-share/:token", "/public", "/public/:token"],
    nav: ["NavRail:shares", "SettingsModal#navigationVisibility:shares", "FloatingLayerHost:shares", "PublicSpaceLauncher DOM 注入", "编辑器/列表/树右键 分享弹窗", "编辑器评论面板"],
    chunks: ["LazySharedNoteViewRuntime", "LazyShareManagementPageRuntime", "LazyNotebookShareJoinViewRuntime"],
    deferredCenters: ["PublicSpaceLauncher"],
    backendRoutes: ["shares.ts", "notifications.ts"],
    dependencies: [],
  },
  plugins: {
    tier: "P1",
    nav: ["SettingsModal#plugins", "FloatingLayerHost 插件 UI 扩展", "CommandPalette 插件命令", "NoteTemplatePickerDialog 插件模板", "AIChatPanel 插件提示词"],
    chunks: [],
    deferredCenters: [],
    backendRoutes: ["plugins.ts", "plugin-studio.ts", "plugin-executions.ts", "plugin-inbound.ts", "clipper-local.ts"],
    backendStartup: ["index.ts:199-206 recoverPluginUpdates"],
    dependencies: ["quickjs-emscripten"],
  },
  openApi: {
    tier: "P1",
    nav: ["SettingsModal#tokens（MCP/CLI/Agent 令牌）"],
    chunks: [],
    deferredCenters: [],
    backendRoutes: ["tokens.ts", "webhooks.ts"],
    backendStartup: [],
    dependencies: [],
  },
  importCenter: {
    tier: "P1",
    nav: ["SettingsModal#data → DataManager 多源迁移（siyuan/obsidian/yuque/wechat-favorites/youdao/mobile-memo/url）", "知识树「+」word/wechat 导入"],
    chunks: [],
    deferredCenters: [
      "DocxImportCenter",
      "SiyuanImportProgressBridge",
      "RoundTripImportBatchCenter",
      "RoundTripPermissionMappingCenter",
      "RoundTripPermissionExportCenter",
      "NoteTransferCenter",
      "SystemFullDataTransferBridge",
    ],
    backendRoutes: [
      "export.ts",
      "import-batches.ts",
      "roundtrip-permissions.ts",
      "url-import.ts",
      "micloud.ts",
      "oppocloud.ts",
      "icloud.ts",
      "wechat-favorites-import.ts",
      "settings.ts",
    ],
    dependencies: ["mammoth"],
  },
  sheet: {
    tier: "P1",
    routes: ["/sheets/:id"],
    nav: ["知识树新建/打开轻量表格", "SearchCenter/CommandPalette sheet 结果跳转", "附件预览 xlsx（AttachmentXlsxPreview）"],
    chunks: [],
    deferredCenters: [],
    backendRoutes: ["sheets.ts"],
    dependencies: [],
  },
  voiceMemo: {
    tier: "P1",
    nav: ["main.tsx 根级 VoiceRecorderSheet（nowen:voice-record 事件）", "编辑器插入语音菜单", "AI 设置内语音设置（SpeechSettingsPanel）"],
    chunks: [],
    deferredCenters: [],
    backendRoutes: ["voice.ts"],
    dependencies: [],
  },
  automation: {
    tier: "P1",
    nav: ["SettingsModal#automations"],
    chunks: [],
    deferredCenters: [],
    backendRoutes: ["automations.ts", "automation-scanner.ts"],
    backendStartup: ["index.ts:592 automationEventCaptureMiddleware", "index.ts:954-958 automationRuntime.start"],
    dependencies: ["cron-parser"],
  },
} as const satisfies Record<string, FeatureEntry>;

export type FeatureKey = keyof typeof FEATURES;
