import React, {
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
} from "react";
import EncryptedConversionEditorGuard from "./EncryptedConversionEditorGuard";
import EncryptedNotePane from "./EncryptedNotePane";
import EncryptedNoteConversionDialog from "./EncryptedNoteConversionDialog";
import {
  firstPendingConversion,
  CONVERSION_PENDING_EVENT,
} from "@/lib/encryptedNotes/conversionPending";
import { getOfflineQueueStorageKey } from "@/lib/offlineScope";
import { Capacitor } from "@capacitor/core";
import {
  isEncryptedNoteFormat,
  sameConversionContent,
} from "@/lib/encryptedNotes/noteDocument";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Star,
  Pin,
  Trash2,
  Cloud,
  RefreshCw,
  Check,
  Loader2,
  ChevronLeft,
  FolderInput,
  ChevronRight,
  ChevronDown,
  X,
  ListTree,
  Lock,
  Unlock,
  Tag as TagIcon,
  Type,
  MoreHorizontal,
  Share2,
  History,
  MessageCircle,
  FileCode,
  FileText,
  Eye,
  Pencil,
  Paperclip,
  Search,
  Sparkles,
  Network,
  Minimize2,
  Image,
  Link2,
  Printer,
  Scissors,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { ScrollArea } from "@/components/ui/scroll-area";
import TiptapEditor from "@/components/TiptapEditor";
import NoteReadingPositionBridge from "@/components/NoteReadingPositionBridge";
import { PhaseAPerfProfiler } from "@/components/PhaseAPerfProfiler";
import type {
  NoteEditorHeading,
  NoteEditorUpdatePayload,
} from "@/components/editors/types";
import PlainTextEditor from "@/components/PlainTextEditor";
import MarkdownEditor from "@/components/MarkdownEditor";
import HtmlPreviewPane, {
  isFullHtmlDocument,
} from "@/components/HtmlPreviewPane";
import type { NoteEditorHandle } from "@/components/editors/types";
import { useApp, useAppActions, SyncStatus } from "@/store/AppContext";
import { api } from "@/lib/api";
import { confirmMediaNotePersistence } from "@/lib/mediaInsertionCommit";
import {
  parseMermaidMindmap,
  normalizeMindMapData,
} from "@/lib/mindmapTransform";
import { cn } from "@/lib/utils";
import SyncStatusBadge from "@/components/SyncStatusBadge";
import { requestMobileSyncNow } from "@/lib/mobileLocalFirstRuntime";
import { isAndroidNativeRuntime } from "@/lib/mobileLocalMode";
import { isFeatureEnabled } from "@/lib/featureRegistry";
import {
  MOBILE_SYNC_APPLIED_EVENT,
  type MobileSyncAppliedDetail,
} from "@/lib/mobileSyncStatus";
import {
  applyEditorUpdateToNote,
  PREPARE_EDITOR_SPLIT_CLOSE_EVENT,
  publishEditorSplitMirrorUpdate,
  readEditorSplitCloseNoteId,
  REQUEST_EDITOR_SPLIT_MIRROR_EVENT,
} from "@/lib/editorSplitMirror";
import { Tag, Notebook, MindMapData, MindMapNode, type Note } from "@/types";
import { useTranslation } from "react-i18next";
import { haptic } from "@/hooks/useCapacitor";
import { toast } from "@/lib/toast";
import { exportNoteAsImage, printNote } from "@/lib/exportService";
import { subscribeOpenInternalNoteLink } from "@/lib/blockNavigation";

import { extractFinalAnswer, parseAiTags } from "@/lib/aiOutput";

import { buildAiContext } from "@/lib/aiContextBuilder";
import ShareModal from "@/components/ShareModal";
import VersionHistoryPanel from "@/components/VersionHistoryPanel";
import CommentPanel from "@/components/CommentPanel";
import NoteAttachmentsPanel from "@/components/NoteAttachmentsPanel";
import FolderSyncAttachmentPreviewPane, {
  isFolderSyncAttachmentNote,
} from "@/components/FolderSyncAttachmentPreviewPane";
import BacklinksPanel from "@/components/BacklinksPanel";
import MermaidView from "@/components/MermaidView";
import { PresenceBar } from "@/components/PresenceBar";
import { EditorErrorBoundary } from "@/components/EditorErrorBoundary";
import NoteTabsBar from "@/components/NoteTabsBar";
import {
  EditorToolbarHost,
  EditorToolbarExpandSlot,
  MobileEditorToolbarPortal,
} from "@/components/CollapsibleEditorToolbar";
import NoteLoadingSkeleton from "@/components/NoteLoadingSkeleton";
import { useNoteLoader } from "@/hooks/useNoteLoader";
import { useRealtimeNote } from "@/hooks/useRealtimeNote";
import { useYDoc } from "@/hooks/useYDoc";
import { realtime } from "@/lib/realtime";
import {
  normalizeToMarkdown,
  detectFormat,
  markdownToPlainText,
} from "@/lib/contentFormat";
import {
  resolveEditorMode,
  persistEditorMode,
  clearForcedModeFromUrl,
  nextEditorMode,
  type EditorMode,
} from "@/lib/editorMode";
import {
  putWithReconcile,
  makeFetchLatestNoteVersion,
  is409Error,
  isAborted,
} from "@/lib/optimisticLockApi";
import { enqueue as enqueueOfflineMutation } from "@/lib/offlineQueue";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  shouldOfferRestore,
  type NoteDraft,
} from "@/lib/draftStorage";
import {
  reportTransientNoteImageSource,
  stabilizeNoteContentForPersistence,
} from "@/lib/noteContentPersistence";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";
import { useVisibleViewport } from "@/hooks/useVisibleViewport";
import {
  isRemoteVersionNewer,
  resolveConfirmedTiptapContent,
  shouldSkipUnchangedTitleOnlyUpdate,
} from "@/lib/editorSyncGuards";
import { canWriteNote } from "@/lib/notePermissions";
import {
  DEFAULT_OUTLINE_WIDTH,
  clampOutlineWidth,
  getSavedOutlineWidth,
  persistOutlineWidth,
} from "@/lib/outlinePanelWidth";
import { preserveNoteSyncConflictSnapshot } from "@/lib/noteSyncSafety";
import {
  NOTE_CONFLICT_AUTO_RESOLVED_EVENT,
  shouldPersistPendingConflictSnapshot,
  type NoteConflictAutoResolvedDetail,
} from "@/lib/conflictResolution";
import {
  convertNoteContent,
  REQUEST_NOTE_FORMAT_CONVERSION_EVENT,
  type NoteFormatConversionRequest,
} from "@/lib/noteFormatConversion";
import NoteThemeMenuSelect from "@/components/NoteThemeMenuSelect";
import CjkTypographyMenuActions from "@/components/CjkTypographyMenuActions";
import type { CjkTypographyAction } from "@/lib/cjkTypography";
import NoteColorMarkPicker from "@/components/NoteColorMarkPicker";
import type { NoteColorMark } from "@/types";
import MindMapEmbedInsertDialog from "@/components/MindMapEmbedInsertDialog";
import { pushMindMapAppPath } from "@/lib/mindMapDeepLink";
import { shouldApplyDefaultViewLock } from "@/lib/newNoteImmediateEdit";

// ---------------------------------------------------------------------------
// 编辑器模式切换（MD vs Tiptap）
// ---------------------------------------------------------------------------
// URL `?md=1|0` 强制，否则读 localStorage["nowen.editor_mode"]。
// 底层协议与工具：frontend/src/lib/editorMode.ts
// 切换流程与文档：docs/editor-mode-switch.md
//
// UI 已隐藏（内部测试，2026-04 暂时）：
//   顶栏 `MD / RTE` 切换按钮，对普通用户 隐藏 隐藏。设置里双击可调出，
//   按钮占位 + tooltip 仍然存在，双击即可**临时让用户删除**。
//     - `?md=1` / `?md=0` URL 参数仍然生效（逻辑没删，只是用户看不到链接）
//     - `localStorage["nowen.editor_mode"]` 仍然可读取
//     - toggleEditorMode 会切换并保存，但未完成自动迁移，刷新页面后一切可恢复
//   需要在开发调试时显示按钮，把下方变量改为 true；正式发布请保持 false。
const SHOW_EDITOR_MODE_TOGGLE = false;

interface EditorPaneProps {
  canSplitDocument?: boolean;
  onSplitDocument?: () => void;
}

export default function EditorPane(props: EditorPaneProps) {
  return (
    <ConversionAwareEditorPane key={getOfflineQueueStorageKey()} {...props} />
  );
}

function ConversionAwareEditorPane(props: EditorPaneProps) {
  const { state } = useApp();
  const { t } = useTranslation();
  const [conversion, setConversion] = useState<{
    id: string;
    note?: Note;
    storageFailed?: boolean;
  } | null>(() => {
    try {
      const pending = firstPendingConversion();
      return pending ? { id: pending.noteId } : null;
    } catch {
      return { id: "", storageFailed: true };
    }
  });
  useEffect(() => {
    const resume = () => {
      try {
        const pending = firstPendingConversion();
        if (pending)
          setConversion((current) =>
            current?.id === pending.noteId
              ? { id: pending.noteId }
              : (current ?? { id: pending.noteId }),
          );
      } catch {
        setConversion({ id: "", storageFailed: true });
      }
    };
    window.addEventListener(CONVERSION_PENDING_EVENT, resume);
    return () => window.removeEventListener(CONVERSION_PENDING_EVENT, resume);
  }, []);
  if (conversion?.storageFailed)
    return (
      <p role="alert" className="p-6 text-sm text-red-500">
        {t("encryptedConversion.errors.storage_failed")}
      </p>
    );
  if (conversion)
    return (
      <EncryptedNoteConversionDialog
        key={conversion.id}
        noteId={conversion.id}
        note={conversion.note}
        onClose={() => setConversion(null)}
      />
    );
  return state.activeNote &&
    isEncryptedNoteFormat(state.activeNote.contentFormat) ? (
    <EncryptedNotePane key={state.activeNote.id} note={state.activeNote} />
  ) : (
    <EncryptedConversionEditorGuard
      key={
        state.activeNote
          ? `${state.activeNote.id}:${state.activeNote.contentFormat}`
          : "empty"
      }
      noteId={state.activeNote?.id ?? null}
    >
      <OrdinaryEditorPane
        {...props}
        onEncryptNote={(note) => setConversion({ id: note.id, note })}
      />
    </EncryptedConversionEditorGuard>
  );
}

function OrdinaryEditorPane({
  canSplitDocument = false,
  onSplitDocument,
  onEncryptNote,
}: EditorPaneProps & { onEncryptNote: (note: Note) => void }) {
  const { state } = useApp();
  const actions = useAppActions();
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        return;
      pushMindMapAppPath(id);
      actions.setViewMode("mindmaps");
    };
    window.addEventListener("nowen:request-open-embedded-mindmap", handler);
    return () =>
      window.removeEventListener(
        "nowen:request-open-embedded-mindmap",
        handler,
      );
  }, [actions]);
  const { loadNote, retryNoteLoad } = useNoteLoader();
  const {
    activeNote,
    syncStatus,
    lastSyncedAt,
    noteLoading,
    noteLoadingState,
  } = state;
  const reduceMotion = useReducedMotion();
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const moveDropdownRef = useRef<HTMLDivElement | null>(null);
  // 大纲默认开/关是用户偏好，不等于 "默认显示大纲"。
  // 切换笔记时如果未触发"新版偏好刷新"，新路由 lockOnOpen 在同一个 effect 里
  // 一起 reset 完成（目前是"用户在编辑期间手动切换状态，新笔记打开时也会保持"。
  // 因为长期使用极少的用户来说，每次新笔记都反向丢失偏好会很不习惯。
  const { prefs: userPrefs, setPref: setUserPref } = useUserPreferences();
  const [showOutline, setShowOutline] = useState<boolean>(
    () => userPrefs.outlineDefaultOpen,
  );
  const [outlineWidth, setOutlineWidth] = useState(getSavedOutlineWidth);
  // 视图级只读：除了 DB 的 isLocked，还有用户偏好带来的"会话锁"。
  // 打开已有笔记时如果启用了 lockOnOpen 偏好，就把当前笔记 id 加入集合，
  // 编辑器变为只读，用户需要点解锁按钮移除，从而恢复编辑能力。
  // 刚创建后首次自动打开可编辑；离开后再次打开仍按偏好应用，不影响其它笔记。
  // 这样做的好处是：不污染笔记的 isLocked 字段，也不会触发协作广播 / 权限检查。
  const [viewLockedIds, setViewLockedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const lastOpenedNoteIdRef = useRef<string | null>(null);
  // 用 ref 让 yDoc/snapshot/flushToLocal 等长驻闭包引用最新值。
  // 否则可能读到旧值，导致偏好刚关之后还会往"已锁定的笔记"写 / 写 yDoc。
  const viewLockedIdsRef = useRef(viewLockedIds);
  viewLockedIdsRef.current = viewLockedIds;
  const [headings, setHeadings] = useState<NoteEditorHeading[]>([]);
  const scrollToRef = useRef<((pos: number) => void) | null>(null);
  const handleEditorReady = useCallback((scrollTo: (pos: number) => void) => {
    scrollToRef.current = scrollTo;
  }, []);
  const { t } = useTranslation();
  const { visible: keyboardVisible } = useKeyboardVisible();

  /**
   * 当前视图级有效锁定状态：DB 的 isLocked **加** 用户偏好带来的"会话锁"。
   *
   * 它影响所有"只读即禁用"判断：编辑器 editable、删除按钮、AI 写作、移动到回收站。
   * Y.Doc 协作笔记优先，但 togglePin / 收藏等元素仍然走 isLocked
   * 判断。会话锁也应阻止用户在"被保护笔记"上偷偷 pin / 收藏。
   */
  const isViewLocked = !!activeNote && viewLockedIds.has(activeNote.id);
  const isTrashed = !!activeNote?.isTrashed;
  const noteSwitchPending = !!noteLoadingState.pendingNoteId;
  const effectiveLocked =
    !!activeNote?.isLocked || isViewLocked || isTrashed || noteSwitchPending;
  const canEditActiveNote = canWriteNote(activeNote);
  const showDesktopOutline = showOutline && !state.editorFullscreen;
  const compactMobileEditing =
    keyboardVisible && canEditActiveNote && !effectiveLocked;

  const handleOutlineResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = outlineWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const nextWidth = clampOutlineWidth(
          startWidth - (moveEvent.clientX - startX),
        );
        setOutlineWidth(nextWidth);
        persistOutlineWidth(nextWidth);
      };

      const handleMouseUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [outlineWidth],
  );

  const handleOutlineWidthReset = useCallback(() => {
    setOutlineWidth(DEFAULT_OUTLINE_WIDTH);
    persistOutlineWidth(DEFAULT_OUTLINE_WIDTH);
  }, []);
  useEffect(
    () =>
      subscribeOpenInternalNoteLink(async ({ noteId }) => {
        await loadNote({
          noteId,
          summary: { title: t("editor.noteLoading"), notebookId: "" },
          request: () => api.getNote(noteId),
          onSuccess: (target) => actions.setActiveNote(target),
        });
      }),
    [actions, loadNote, t],
  );

  // 切笔记时按偏好应用"打开即锁定"。
  // 必须只在 activeNote.id 变化时跑一次，不依赖 prefs.lockOnOpen——否则用户在
  // 设置面板把开关从开切到关，会立刻把当前笔记的会话锁也撤销，体感是"我刚还在看的
  // 受保护笔记被偷偷解锁了"，不直观。开关的变化只影响"下次打开新笔记时"的初值。
  useEffect(() => {
    const id = activeNote?.id ?? null;
    // React StrictMode may replay this effect; only process a given opening once.
    if (lastOpenedNoteIdRef.current === id) return;
    lastOpenedNoteIdRef.current = id;
    if (!id) return;
    if (shouldApplyDefaultViewLock(id, userPrefs.lockOnOpen)) {
      setViewLockedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
    // 大纲默认开关：每次打开笔记时按当前偏好刷新一次，保证用户设置生效。
    // 偏好更新后第一次打开笔记才生效，中途手动切换大纲仍然在当前笔记
    // 保持，直到再次打开笔记时偏好覆盖。这是大多数用户期望的行为。
    setShowOutline(userPrefs.outlineDefaultOpen);
    // 这里 disable react-hooks/exhaustive-deps：lockOnOpen / outlineDefaultOpen
    // 变化不应该触发重新应用，否则用户随时调整偏好时会造成意外抖动 / 强制展开。
    // 当前打开的笔记，只有切换笔记、大纲只有在"打开笔记"时才生效。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id]);

  const exitEditorFullscreen = useCallback(() => {
    actions.setEditorFullscreen(false);
  }, [actions]);

  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [mobileTitlePinned, setMobileTitlePinned] = useState(false);
  const [showDesktopMoreMenu, setShowDesktopMoreMenu] = useState(false);
  const noteMenuViewport = useVisibleViewport(
    showMobileMenu || showDesktopMoreMenu,
  );
  const [showMobileMoveMenu, setShowMobileMoveMenu] = useState(false);
  const [showMobileOutline, setShowMobileOutline] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showCommentPanel, setShowCommentPanel] = useState(false);
  const [showAttachmentsPanel, setShowAttachmentsPanel] = useState(false);
  const [showBacklinksPanel, setShowBacklinksPanel] = useState(false);
  const [backlinksCount, setBacklinksCount] = useState<number | null>(null);
  const [backlinksLoading, setBacklinksLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const editorPaneRootRef = useRef<HTMLDivElement | null>(null);
  const desktopMoreMenuRef = useRef<HTMLDivElement | null>(null);

  // 纯 HTML 预览模式：当
  // 笔记内容被保存为 HTML 格式（如 clipper 导入）时自动进入只读预览，
  // 用户需要手动切换到 Tiptap 编辑器（会有格式丢失风险）。
  // Import HTML must be routed to the preview *during the first render*.
  // Waiting for a useEffect causes one Tiptap mount (and unauthorized <img> requests)
  // before the preview takes over.
  const [htmlPreviewMode, setHtmlPreviewMode] = useState(
    () =>
      !!activeNote &&
      activeNote.contentFormat !== "plaintext" &&
      detectFormat(activeNote.content) === "html",
  );
  const previewInitializedNoteIdRef = useRef(activeNote?.id);
  const isPendingHtmlNoteSwitch =
    previewInitializedNoteIdRef.current !== activeNote?.id &&
    !!activeNote &&
    activeNote.contentFormat !== "plaintext" &&
    detectFormat(activeNote.content) === "html";
  const shouldRenderHtmlPreview =
    activeNote?.contentFormat !== "plaintext" &&
    (htmlPreviewMode || isPendingHtmlNoteSwitch);
  const [showHtmlEditWarning, setShowHtmlEditWarning] = useState(false);
  // 记住当前笔记的原始格式是否为 HTML。
  // 切换到编辑模式后，内容会被 normalize 为 Markdown，此时 detectFormat 返回 "md"。
  // 如果仅靠 detectFormat 判断，切换按钮会消失，用户无法切回预览模式。
  // 所以需要单独记录，让按钮始终可见。
  const [noteIsHtml, setNoteIsHtml] = useState(false);
  // 全新只读模式：当笔记是完整 HTML 文档（含 <!DOCTYPE ...>）时，不支持编辑，只显示预览按钮。
  const [noteIsFullHtmlDoc, setNoteIsFullHtmlDoc] = useState(false);

  // 编辑器模式（MD / Tiptap）：初始值来自 URL / localStorage，可随时切换。
  const [editorMode, setEditorMode] = useState<EditorMode>(() =>
    resolveEditorMode(),
  );
  /**
   * 当前编辑器（Tiptap 或 Markdown）暴露的命令式方法。
   * EditorPane 只需要"命令 flush"等极简方法，切换编辑器、切换笔记、判断当前
   * 粘贴行为等仍然走 onUpdate 回调。
   */
  const editorHandleRef = useRef<NoteEditorHandle | null>(null);

  const handleToggleHtmlPreviewMode = useCallback(async () => {
    if (htmlPreviewMode) {
      setShowHtmlEditWarning(true);
      return;
    }

    try {
      await editorHandleRef.current?.flushSave();
    } catch {}
    setHtmlPreviewMode(true);
  }, [htmlPreviewMode]);

  /** 用于在编辑器模式切换时，防止用户连点导致重复 PUT / mount 竞态。 */
  const modeSwitchInflightRef = useRef<boolean>(false);
  const [modeSwitching, setModeSwitching] = useState(false);

  /**
   * 最近一次 handleUpdate 触发的 PUT Promise。
   *
   * 用途：编辑器模式切换时若 RTE 的 debounce 刚好在 500ms 前 fire 了且 PUT 还在途中，
   * 即使切换时 `discardPending()` 清了本地 timer 也无法阻止这个正在飞的请求。
   * 而我们接下来要发一次带同 version 的"规范化 PUT"，二者并发会造成：
   *   - 先到者 bump version=N+1；后到者带旧 version=N → 409
   *   - 409 reconcile 会用最新 version 重放"后到者"，可能把 notes.content 写回
   *     旧 Tiptap JSON（取决于到达次序），导致切换成果被覆盖
   *
   * 解决：toggleEditorMode 进入时 await 该 promise，让 in-flight 的 handleUpdate
   * 跑完（handleUpdate 里已经处理 409/回填 version），之后我们的规范化 PUT 拿到
   * 就是"最新且没有 in-flight"的版本号，可以安全并发。
   */
  const saveInflightRef = useRef<Promise<void> | null>(null);

  /**
   * 切换 MD ⇄ Tiptap：
   *
   * 完整协议见 `docs/editor-mode-switch.md`。主干步骤：
   *   1) 入口守卫：去重 / 协同未 sync 时拒绝
   *   2) 记录 preSwitchNote 快照（失败回滚用）
   *   3) await saveInflightRef（防止与 handleUpdate 并发 PUT）
   *   4) 取当前编辑器 snapshot
   *   5) flush / discardPending（按方向）
   *   6) MD→RTE：从 yDoc 回填 activeNote
   *   7) RTE→MD：normalizeToMarkdown + 规范化 PUT（带乐观锁 / syncToYjs）
   *   8) 失败回滚 preSwitchNote，成功则提交副作用（persistEditorMode / clearForcedModeFromUrl / setEditorMode）
   *   9) MD→RTE：releaseYjsRoom
   */
  const toggleEditorMode = useCallback(async () => {
    if (modeSwitchInflightRef.current) return;

    // ① 入口：CRDT 未 sync 时的保护 + 救命出口（D4/UX6+UX7）
    // ------------------------------------------------------------------
    // collabReady=true 表示已发起 y:join 但 synced=false 代表服务端还没把完整
    // state 广播回来，此时 yDoc.getText("content") 可能是空串或 IDB 陈旧缓存。
    // MD→RTE 会据此回填 activeNote → 用户最近输入被覆盖为空。
    //
    // 但若 collabSynced 因 provider/WS 异常永远卡在 false，禁止切换会把用户
    // 堵死在 MD 模式（曾有用户反馈等了 10+ 分钟）。因此改为"二次点击强制切换"：
    //   1st click：toast 警告 + 记录时间戳，阻止切换
    //   3s 内 2nd click：视为用户坚持切换，放行（用户承担可能丢字的风险）
    //   > 3s：时间戳过期，重新走一次警告流程
    // i18n 文案保持不变，仅在警告文案里追加"再次点击可强制切换"。
    if (collabReadyRef.current && !collabSyncedRef.current) {
      const now = Date.now();
      const last = lastUnsyncedClickAtRef.current;
      if (last && now - last < 3000) {
        // 2nd click in window → 放行，同时清掉时间戳避免误复用
        console.warn(
          "[EditorPane] toggleEditorMode: user forced mode switch while CRDT not synced; " +
            "content may be incomplete if yDoc is stale",
        );
        lastUnsyncedClickAtRef.current = 0;
        // 落到下面正常流程
      } else {
        lastUnsyncedClickAtRef.current = now;
        try {
          toast.warning(
            `${t("editor.modeSwitch.syncingToast")}，${t("editor.modeSwitch.forceHint")}。`,
            4000,
          );
        } catch {
          /* ignore */
        }
        return;
      }
    } else {
      // 已同步或未启用协同 → 清掉遗留时间戳
      lastUnsyncedClickAtRef.current = 0;
    }

    modeSwitchInflightRef.current = true;
    setModeSwitching(true);

    // ② 切换前快照，失败时回滚（D5）
    const preSwitchNote = activeNoteRef.current
      ? { ...activeNoteRef.current }
      : null;

    const fromMode = editorMode;
    const next: EditorMode = nextEditorMode(fromMode);

    try {
      // ③ 等待 handleUpdate 的在途 PUT（D6，不变量 2）
      //    不等的后果：规范化 PUT(v=N) 与 debounce PUT(v=N) 并发，409 reconcile 时
      //    先到者 bump v 后，后到者重放把旧内容覆盖回来。
      if (saveInflightRef.current) {
        try {
          await saveInflightRef.current;
        } catch {
          /* handleUpdate 内部已处理，这里只是串行化 */
        }
      }

      // ④ 取当前编辑器内容快照（同步读，避免依赖 flushSave 的异步 PUT）
      let snapshot: { content: string; contentText: string } | null = null;
      try {
        snapshot = editorHandleRef.current?.getSnapshot?.() ?? null;
      } catch (err) {
        console.warn("[EditorPane] getSnapshot before switch failed:", err);
      }

      // ⑤ 按方向选择 flush 策略
      //    - MD→RTE：flushSave —— 内部 PUT 的是 markdown，与最终 notes.content 一致，无副作用
      //    - RTE→MD：discardPending —— 避免 Tiptap JSON PUT 与规范化 PUT 竞态
      try {
        if (fromMode === "md") {
          editorHandleRef.current?.flushSave();
        } else {
          editorHandleRef.current?.discardPending?.();
        }
      } catch (err) {
        console.warn("[EditorPane] flush/discard before switch failed:", err);
      }

      // ⑥ MD→RTE：CRDT 漂移兜底 —— 从 yDoc 读最新 markdown 回填 activeNote
      //    MD 下真正内容在 yText 里，activeNote.content 只在打开笔记时赋过一次；
      //    不回填，TiptapEditor mount 时 parseContent 会用旧 note.content 初始化。
      if (fromMode === "md") {
        syncActiveNoteFromYDoc();
      }

      // ⑦ RTE→MD：normalizeToMarkdown + 规范化 PUT
      //    失败时 rollback + return（不变量 4）
      if (fromMode === "tiptap") {
        const ok = await normalizeAndPersistOnSwitchRteToMd(
          snapshot,
          preSwitchNote,
        );
        if (!ok) return;
      }

      // ⑧ 副作用提交
      //    所有副作用放在 setEditorMode 外面（avoid React18 "setState during render"）
      persistEditorMode(next);
      clearForcedModeFromUrl();
      setEditorMode(next);

      // 清状态栏残留：旧编辑器的 saving/error 文案不应跨越到新编辑器
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
      actions.setSyncStatus("idle");

      try {
        toast.success(
          next === "md"
            ? t("editor.modeSwitch.successToMd")
            : t("editor.modeSwitch.successToTiptap"),
        );
      } catch {
        /* toast 失败也没关系 */
      }

      // ⑨ MD→RTE：释放服务端 y room（不变量 3）
      //    失败仅记录日志——syncToYjs 机制会在下次切回 MD 前修正状态。
      if (next === "tiptap" && preSwitchNote) {
        try {
          await api.releaseYjsRoom(preSwitchNote.id);
        } catch (err) {
          console.warn(
            "[EditorPane] releaseYjsRoom after MD→RTE switch failed:",
            err,
          );
        }
      }
    } finally {
      modeSwitchInflightRef.current = false;
      setModeSwitching(false);
    }
    // toggleEditorMode deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, actions, t]);
  // ---------------------------------------------------------------------------
  // toggleEditorMode 的内部子过程（拆出来降低圈复杂度，见 A1）
  // ---------------------------------------------------------------------------

  /**
   * MD→RTE 前，从 yDoc 读取最新 markdown 回填 activeNote。
   *
   * 只读取 ref（不依赖闭包），因此不需要 useCallback；也避免把它加到
   * toggleEditorMode 的 deps 里。
   */
  function syncActiveNoteFromYDoc() {
    const yDocNow = collabYDocRef.current;
    const note = activeNoteRef.current;
    if (
      !yDocNow ||
      !note ||
      note.isLocked ||
      viewLockedIdsRef.current.has(note.id)
    )
      return;
    try {
      const latestMd = yDocNow.getText("content").toString();
      if (latestMd && latestMd !== note.content) {
        actions.setActiveNote({
          ...note,
          content: latestMd,
          contentText: latestMd,
        });
      }
    } catch (err) {
      console.warn("[EditorPane] sync yDoc before switch failed:", err);
    }
  }

  /**
   * RTE→MD：把 Tiptap JSON 规范化为 markdown，本地先回填 activeNote，
   * 再 PUT 回服务端（带乐观锁 + syncToYjs）。
   *
   * 返回 true 表示成功或无需 PUT（可以继续推进 setEditorMode）；
   * 返回 false 表示规范化 PUT 失败并已完成回滚（toggleEditorMode 应提前 return）。
   */
  async function normalizeAndPersistOnSwitchRteToMd(
    snapshot: { content: string; contentText: string } | null,
    preSwitchNote: ReturnType<typeof Object.assign> | null,
  ): Promise<boolean> {
    const note = activeNoteRef.current;
    if (
      !snapshot ||
      !note ||
      note.isLocked ||
      viewLockedIdsRef.current.has(note.id)
    )
      return true;

    // snapshot.content 通常是 Tiptap JSON 字符串；兜底识别一下。
    const fmt = detectFormat(snapshot.content);
    let normalizedMd = snapshot.content;
    let normalizedText = snapshot.contentText;
    if (fmt === "tiptap-json" || fmt === "html") {
      try {
        const md = normalizeToMarkdown(snapshot.content, snapshot.contentText);
        if (md) {
          normalizedMd = md;
          normalizedText = markdownToPlainText(md) || snapshot.contentText;
        }
      } catch (err) {
        console.warn("[EditorPane] normalize RTE→MD content failed:", err);
      }
    }

    // 本地先回填，让新 MD 编辑器 mount 时读到规范化后的内容
    // （即使后续 PUT 失败，也能立即以本地 markdown 渲染）
    const needUpdate =
      normalizedMd !== note.content || normalizedText !== note.contentText;
    if (!needUpdate) return true;

    actions.setActiveNote({
      ...note,
      content: normalizedMd,
      contentText: normalizedText,
    });

    const noteId = note.id;
    const initialVersion = note.version;

    // syncToYjs=true 让服务端在 REST 成功后把 yText 同步替换为这份 markdown，
    // 保证下次切回 MD 时 y:join 拿到的 state 与 notes.content 一致。
    const sendNormalizePut = (version: number) =>
      api.updateNote(noteId, {
        content: normalizedMd,
        contentText: normalizedText,
        contentFormat: note.contentFormat,
        version,
        syncToYjs: true,
        writeSource: "manual-save",
      } as any);

    try {
      actions.setSyncStatus("saving");
      const updated = await sendNormalizePut(initialVersion);

      // 回填 version / updatedAt，避免后续 handleUpdate 继续 409
      if (updated && activeNoteRef.current?.id === noteId) {
        actions.setActiveNote({
          ...activeNoteRef.current,
          content: normalizedMd,
          contentText: normalizedText,
          version: updated.version,
          updatedAt: updated.updatedAt,
        });
        actions.updateNoteInList({
          id: updated.id,
          title: updated.title,
          contentText: updated.contentText,
          updatedAt: updated.updatedAt,
        });
        actions.setSyncStatus("saved");
        actions.setLastSynced(new Date().toISOString());
      }
      return true;
    } catch (err) {
      // Abort（切笔记）按 idle 处理，仍视为可继续切换
      if (isAborted(err)) {
        actions.setSyncStatus("idle");
        return true;
      }
      if (is409Error(err)) {
        try {
          saveDraft({
            noteId,
            editorMode: "md",
            content: normalizedMd,
            contentText: normalizedText,
            title: note.title,
            baseVersion:
              typeof (err as any)?.currentVersion === "number"
                ? (err as any).currentVersion
                : initialVersion,
            savedAt: Date.now(),
          });
        } catch {
          /* ignore */
        }
      }
      console.warn("[EditorPane] normalize PUT on mode switch failed:", err);
      actions.setSyncStatus("error");

      // 回滚 activeNote：避免本地 content 已被 normalizedMd 覆盖但 editorMode 没切
      // （会让 Tiptap 把 markdown 当 JSON 解析 → 编辑器视觉错乱）
      if (
        preSwitchNote &&
        activeNoteRef.current?.id === (preSwitchNote as any).id
      ) {
        actions.setActiveNote(preSwitchNote as any);
      }
      try {
        toast.error(t("editor.modeSwitch.failRollback"));
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  /**
   * 切换笔记（activeNote.id 变化）前，也把当前编辑器的 debounce 立刻刷一次，
   * 防止"写到一半切走 → 500ms 内丢字"。
   */
  const lastActiveIdRef = useRef<string | null>(activeNote?.id ?? null);
  const skipNextSwitchFlushForNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = lastActiveIdRef.current;
    const nextId = activeNote?.id ?? null;
    if (prevId && prevId !== nextId) {
      if (skipNextSwitchFlushForNoteIdRef.current === prevId) {
        skipNextSwitchFlushForNoteIdRef.current = null;
      } else {
        try {
          editorHandleRef.current?.flushSave();
        } catch {
          /* ignore */
        }
      }
    }
    lastActiveIdRef.current = nextId;
  }, [activeNote?.id]);

  // ─── P2-5: 当前编辑器模式 ref（供 handleUpdate 同步写草稿用） ───────────────
  const editorModeRef = useRef<EditorMode>(editorMode);
  useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);

  // ─── P1-3: 页面被卸载 / 隐藏时强制把当前编辑器内容写入本地草稿 + 离线队列 ──────
  // 触发场景：移动端 webview 被系统回收、刷新、关 Tab、切到后台被杀。
  // 不能依赖异步 PUT（pagehide 后 fetch 会被中止），只能写 localStorage 同步落盘：
  //   1) saveDraft 写本地草稿（下次打开同笔记可恢复）
  //   2) enqueue 写离线队列（下次进 app 自动 flush）
  useEffect(() => {
    const flushToLocal = () => {
      const note = activeNoteRef.current;
      if (!note || note.isLocked || viewLockedIdsRef.current.has(note.id))
        return;
      let snap: { content: string; contentText: string } | null = null;
      try {
        snap = editorHandleRef.current?.getSnapshot?.() ?? null;
      } catch {
        /* ignore */
      }
      if (!snap || typeof snap.content !== "string") return;
      if (snap.content === note.content) return;
      // 1) 草稿（同步、零网络依赖）
      try {
        saveDraft({
          noteId: note.id,
          editorMode: editorModeRef.current,
          ...(note.contentFormat === "plaintext"
            ? { contentFormat: "plaintext" as const }
            : {}),
          content: snap.content,
          contentText: snap.contentText || "",
          title: note.title,
          baseVersion: note.version,
          savedAt: Date.now(),
        });
      } catch {
        /* ignore */
      }
      // 2) 离线队列（下次启动 flush）
      // 在线重载、热更新和切后台会触发此路径；常规保存失败会自行入队，
      // 因此在线时只保留草稿，避免将旧版本快照留待下次自动重放。
      if (navigator.onLine) return;

      try {
        enqueueOfflineMutation({
          type: "updateNote",
          noteId: note.id,
          url: `/notes/${note.id}`,
          method: "PUT",
          body: {
            title: note.title,
            content: snap.content,
            contentText: snap.contentText,
            contentFormat: note.contentFormat,
            version: note.version,
          },
        });
      } catch {
        /* ignore */
      }
    };

    const onPageHide = () => flushToLocal();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushToLocal();
    };
    // beforeunload 在桌面浏览器关闭/刷新时触发；移动端不一定可靠，故组合 pagehide
    const onBeforeUnload = () => flushToLocal();

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // 使用 ref 追踪最新的 activeNote，避免 handleUpdate 闭包引用过期
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;
  const syncStatusRef = useRef(syncStatus);
  syncStatusRef.current = syncStatus;

  const convertActiveNoteFormat = useCallback(
    async ({ noteId, targetFormat }: NoteFormatConversionRequest) => {
      const initialNote = activeNoteRef.current;
      if (
        !initialNote ||
        initialNote.id !== noteId ||
        initialNote.contentFormat === "plaintext" ||
        modeSwitchInflightRef.current
      )
        return;
      if (initialNote.isLocked || viewLockedIdsRef.current.has(noteId)) {
        toast.warning(t("editorOps.convertLocked"));
        return;
      }

      modeSwitchInflightRef.current = true;
      setModeSwitching(true);
      let snapshot: { content: string; contentText: string } | null = null;

      try {
        snapshot = editorHandleRef.current?.getSnapshot?.() ?? {
          content: initialNote.content,
          contentText: initialNote.contentText,
        };
        editorHandleRef.current?.discardPending?.();

        if (saveInflightRef.current) {
          try {
            await saveInflightRef.current;
          } catch {
            /* 使用当前编辑器快照继续转换 */
          }
        }
        if (activeNoteRef.current?.id !== noteId) return;

        const persisted = await api.getNote(noteId);
        const converted = convertNoteContent(
          snapshot.content,
          snapshot.contentText,
          targetFormat,
        );
        actions.setSyncStatus("saving");
        const updated = await api.updateNoteConfirmed(noteId, {
          ...converted,
          version: persisted.version,
          ...(targetFormat === "markdown" ? { syncToYjs: true } : {}),
          writeSource: "manual-save",
        } as any);

        activeNoteRef.current = updated;
        actions.setActiveNote(updated);
        actions.updateNoteInList({
          id: updated.id,
          contentText: updated.contentText,
          contentFormat: updated.contentFormat,
          updatedAt: updated.updatedAt,
          version: updated.version,
        });
        actions.updateNoteTab({
          id: updated.id,
          contentFormat: updated.contentFormat,
          updatedAt: updated.updatedAt,
        });

        const nextMode: EditorMode =
          targetFormat === "markdown" ? "md" : "tiptap";
        persistEditorMode(nextMode);
        clearForcedModeFromUrl();
        setEditorMode(nextMode);
        editorModeRef.current = nextMode;
        try {
          clearDraft(noteId);
        } catch {
          /* ignore */
        }

        if (targetFormat === "tiptap-json") {
          try {
            await api.releaseYjsRoom(noteId);
          } catch {
            /* 下次打开时会重新建立房间 */
          }
        }

        actions.setSyncStatus("saved");
        actions.setLastSynced(new Date().toISOString());
        actions.refreshNotes();
        window.dispatchEvent(
          new CustomEvent("nowen:knowledge-tree-changed", {
            detail: { reason: "note-format-converted", noteId },
          }),
        );
        toast.success(
          targetFormat === "markdown"
            ? t("editorOps.convertedMarkdown")
            : t("editorOps.convertedRichText"),
        );
      } catch (error) {
        console.error("[EditorPane] convert note format failed:", error);
        const current = activeNoteRef.current;
        if (snapshot && current?.id === noteId) {
          const restored = {
            ...current,
            content: snapshot.content,
            contentText: snapshot.contentText,
          };
          activeNoteRef.current = restored;
          actions.setActiveNote(restored);
          try {
            saveDraft({
              noteId,
              editorMode: editorModeRef.current,
              content: snapshot.content,
              contentText: snapshot.contentText,
              title: restored.title,
              baseVersion: restored.version,
              savedAt: Date.now(),
            });
          } catch {
            /* ignore */
          }
        }
        actions.setSyncStatus("error");
        toast.error(t("editorOps.convertFailed"));
      } finally {
        modeSwitchInflightRef.current = false;
        setModeSwitching(false);
      }
    },
    [actions, t],
  );

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent<NoteFormatConversionRequest>).detail;
      if (!detail?.noteId || !detail.targetFormat) return;
      void convertActiveNoteFormat(detail);
    };
    window.addEventListener(
      REQUEST_NOTE_FORMAT_CONVERSION_EVENT,
      handleRequest,
    );
    return () =>
      window.removeEventListener(
        REQUEST_NOTE_FORMAT_CONVERSION_EVENT,
        handleRequest,
      );
  }, [convertActiveNoteFormat]);

  // ---------------------------------------------------------------------------
  // Phase 2: 实时协作 —— Presence / 软锁 / 远程更新提示
  // ---------------------------------------------------------------------------
  /** 远程更新横幅：当别人保存了同一篇笔记，提示用户重新加载 / 处理冲突 */
  const lastAutoAppliedRemoteRef = useRef<string>("");
  /** 远程删除横幅 */
  const [remoteDelete, setRemoteDelete] = useState<{
    actorUserId?: string;
    trashed?: boolean;
  } | null>(null);

  // ─── P2-5: 未保存草稿恢复提示 ──────────────
  // 打开笔记时，如果本地有 baseVersion <= server.version 且 savedAt > server.updatedAt
  // 的草稿，则弹出恢复提示。常见场景：上次弱网 / 崩溃退出后重新进入。
  const [pendingDraft, setPendingDraft] = useState<NoteDraft | null>(null);
  // handleUpdate 在下面才定义，这里用 ref 避免"使用未初始化变量"
  const handleUpdateRef = useRef<
    | ((data: {
        content?: string;
        contentText?: string;
        title: string;
      }) => Promise<void>)
    | null
  >(null);
  const handleEditorUpdate = useCallback(
    async (data: NoteEditorUpdatePayload) => {
      await handleUpdateRef.current?.(data);
    },
    [],
  );

  const handleLocalMirrorUpdate = useCallback(
    (data: NoteEditorUpdatePayload) => {
      const current = activeNoteRef.current;
      if (!current || (data._noteId && data._noteId !== current.id)) return;
      publishEditorSplitMirrorUpdate(current.id, data);
    },
    [],
  );

  const persistPendingConflictSnapshot = useCallback(
    (detail: NoteConflictAutoResolvedDetail): boolean => {
      const current = activeNoteRef.current;
      if (!current || current.id !== detail.note.id) return false;

      const editorHandle = editorHandleRef.current;
      if (editorHandle) {
        let snapshot: ReturnType<NonNullable<NoteEditorHandle["getSnapshot"]>> =
          null;
        try {
          snapshot = editorHandle.getSnapshot?.() ?? null;
        } catch {
          return false;
        }
        if (!snapshot) return false;

        const snapshotTitle = snapshot.title ?? current.title;
        if (
          shouldPersistPendingConflictSnapshot(snapshot, current.title, detail)
        ) {
          preserveNoteSyncConflictSnapshot(
            current.id,
            {
              version: current.version,
              title: snapshotTitle,
              content: snapshot.content,
              contentText: snapshot.contentText,
              contentFormat: current.contentFormat,
            },
            current.version,
            detail.note,
          );
          editorHandle.discardPending?.();
          const localNote = {
            ...current,
            title: snapshotTitle,
            content: snapshot.content,
            contentText: snapshot.contentText,
          };
          activeNoteRef.current = localNote;
          actions.setActiveNote(localNote);
          return false;
        }
        editorHandle.discardPending?.();
      }

      activeNoteRef.current = detail.note;
      actions.setActiveNote(detail.note);
      return true;
    },
    [actions],
  );

  useEffect(() => {
    const handleAutoResolvedConflict = (event: Event) => {
      const detail = (event as CustomEvent<NoteConflictAutoResolvedDetail>)
        .detail;
      if (!detail?.note || !detail.resolvedLocal) return;
      persistPendingConflictSnapshot(detail);
    };
    window.addEventListener(
      NOTE_CONFLICT_AUTO_RESOLVED_EVENT,
      handleAutoResolvedConflict,
    );
    return () =>
      window.removeEventListener(
        NOTE_CONFLICT_AUTO_RESOLVED_EVENT,
        handleAutoResolvedConflict,
      );
  }, [persistPendingConflictSnapshot]);

  useEffect(() => {
    const prepareSplitClose = (event: Event) => {
      const noteId = readEditorSplitCloseNoteId(event);
      const current = activeNoteRef.current;
      if (!current || (noteId && current.id !== noteId)) return;

      persistCurrentEditorSnapshotDraft();
      try {
        const snapshot = editorHandleRef.current?.getSnapshot?.();
        if (snapshot && typeof snapshot.content === "string") {
          const next = {
            ...current,
            title: snapshot.title ?? current.title,
            content: snapshot.content,
            contentText: snapshot.contentText,
          };
          activeNoteRef.current = next;
          actions.setActiveNote(next);
        }
      } catch {
        /* flushSave below remains the fallback when a snapshot is unavailable. */
      }

      try {
        editorHandleRef.current?.flushSave();
      } catch {
        /* ignore */
      }
    };

    const publishRequestedMirror = (event: Event) => {
      const noteId = readEditorSplitCloseNoteId(event);
      const current = activeNoteRef.current;
      if (!noteId || !current || current.id !== noteId) return;
      const snapshot = editorHandleRef.current?.getSnapshot?.();
      if (!snapshot) return;
      publishEditorSplitMirrorUpdate(noteId, {
        title: snapshot.title ?? current.title,
        content: snapshot.content,
        contentText: snapshot.contentText,
        _noteId: noteId,
      });
    };

    window.addEventListener(
      PREPARE_EDITOR_SPLIT_CLOSE_EVENT,
      prepareSplitClose,
    );
    window.addEventListener(
      REQUEST_EDITOR_SPLIT_MIRROR_EVENT,
      publishRequestedMirror,
    );
    return () => {
      window.removeEventListener(
        PREPARE_EDITOR_SPLIT_CLOSE_EVENT,
        prepareSplitClose,
      );
      window.removeEventListener(
        REQUEST_EDITOR_SPLIT_MIRROR_EVENT,
        publishRequestedMirror,
      );
    };
  }, [actions]);

  // 切换笔记时检测本地草稿
  useEffect(() => {
    setPendingDraft(null);
    // 锁定笔记（库锁或本会话偏好锁）不弹草稿恢复提示——既然进入即只读，
    // 没有"恢复未保存内容"的意义，反而会让用户误以为锁失效。
    if (
      !activeNote ||
      activeNote.isLocked ||
      viewLockedIdsRef.current.has(activeNote.id)
    )
      return;
    let draft: NoteDraft | null = null;
    try {
      draft = loadDraft(activeNote.id);
    } catch {
      draft = null;
    }
    if (!draft) return;
    if (
      shouldOfferRestore(
        draft,
        activeNote.version,
        activeNote.updatedAt,
        activeNote.content,
        activeNote.title,
      )
    ) {
      setPendingDraft(draft);
    } else {
      // 实际内容已一致（或服务端更新） → 直接清掉草稿避免下次还提示
      try {
        clearDraft(activeNote.id);
      } catch {
        /* ignore */
      }
    }
  }, [activeNote?.id, activeNote?.version, activeNote?.updatedAt]);

  /** 恢复草稿：把本地草稿内容写回 activeNote，让编辑器重新装载并触发 PUT */
  const handleRestoreDraft = useCallback(async () => {
    const draft = pendingDraft;
    const note = activeNoteRef.current;
    if (!draft || !note || draft.noteId !== note.id) return;
    setPendingDraft(null);
    // 直接把草稿写回 activeNote，编辑器会读取 note.content 重新装载
    actions.setActiveNote({
      ...note,
      content: draft.content,
      contentText: draft.contentText,
      title: draft.title,
    });
    // 主动触发保存（走现有 putWithReconcile 路径，会自动处理冲突）
    try {
      await handleUpdateRef.current?.({
        title: draft.title,
        content: draft.content,
        contentText: draft.contentText,
      });
      try {
        toast.success(t("editor.draftRestored") || "已恢复未保存的修改");
      } catch {}
    } catch {
      // handleUpdate 内部已处理错误
    }
  }, [pendingDraft, actions, t]);

  /** 丢弃草稿 */
  const handleDiscardDraft = useCallback(() => {
    const draft = pendingDraft;
    if (!draft) return;
    setPendingDraft(null);
    try {
      clearDraft(draft.noteId);
    } catch {
      /* ignore */
    }
  }, [pendingDraft]);

  // ---------------------------------------------------------------------------
  // 当前登录用户信息
  // ---------------------------------------------------------------------------
  // selfUser 同时服务于两处：
  //   1) useRealtimeNote 的 selfUserId（过滤"自己的"presence / note:updated 回声）
  //   2) Phase 3 Y.js CRDT 的 awareness（显示本人名字与颜色）
  // 因此必须在 useRealtimeNote 之前声明，避免暂时性死区（TDZ）报错。
  /** 当前登录用户信息，用于 awareness 显示本人名字与颜色 */
  const [selfUser, setSelfUser] = useState<{
    userId: string;
    username: string;
  } | null>(() => {
    try {
      const cachedId = localStorage.getItem("nowen-self-userid");
      const cachedName = localStorage.getItem("nowen-self-username");
      if (cachedId && cachedName)
        return { userId: cachedId, username: cachedName };
    } catch {}
    return null;
  });
  useEffect(() => {
    if (selfUser) return;
    let cancelled = false;
    api
      .getMe()
      .then((me: any) => {
        if (cancelled || !me?.id) return;
        try {
          localStorage.setItem("nowen-self-userid", me.id);
          localStorage.setItem("nowen-self-username", me.username || me.id);
        } catch {}
        setSelfUser({ userId: me.id, username: me.username || me.id });
      })
      .catch(() => {
        /* 未登录/请求失败就静默 */
      });
    return () => {
      cancelled = true;
    };
  }, [selfUser]);

  function getCurrentEditorSnapshot(): {
    content: string;
    contentText: string;
    title?: string;
  } | null {
    try {
      const snap = editorHandleRef.current?.getSnapshot?.();
      return snap && typeof snap.content === "string" ? snap : null;
    } catch {
      return null;
    }
  }

  function persistCurrentEditorSnapshotDraft(): void {
    const current = activeNoteRef.current;
    if (
      !current ||
      current.isLocked ||
      viewLockedIdsRef.current.has(current.id)
    )
      return;
    const snapshot = getCurrentEditorSnapshot();
    if (!snapshot) return;
    const title = snapshot.title ?? current.title;
    if (
      snapshot.content === current.content &&
      snapshot.contentText === current.contentText &&
      title === current.title
    )
      return;
    try {
      saveDraft({
        noteId: current.id,
        editorMode: editorModeRef.current,
        ...(current.contentFormat === "plaintext"
          ? { contentFormat: "plaintext" as const }
          : {}),
        content: snapshot.content,
        contentText: snapshot.contentText,
        title,
        baseVersion: current.version,
        savedAt: Date.now(),
      });
    } catch {
      /* Local storage may be unavailable; flushSave still attempts the server write. */
    }
  }

  function hasLocalUnsavedChanges(): boolean {
    const cur = activeNoteRef.current;
    if (!cur) return false;
    if (syncStatusRef.current === "saving" || !!saveInflightRef.current)
      return true;
    const snap = getCurrentEditorSnapshot();
    if (!snap) return false;
    return (
      snap.content !== cur.content ||
      snap.contentText !== cur.contentText ||
      (snap.title ?? cur.title) !== cur.title
    );
  }

  function getCollabMarkdownSnapshot(): string | null {
    const yDoc = collabYDocRef.current;
    if (!yDoc) return null;
    try {
      return yDoc.getText("content").toString();
    } catch {
      return null;
    }
  }

  function writeMarkdownToCollabYDoc(markdown: string) {
    const yDoc = collabYDocRef.current;
    if (!yDoc) return;
    const yText = yDoc.getText("content");
    yDoc.transact(() => {
      yText.delete(0, yText.length);
      if (markdown) yText.insert(0, markdown);
    });
  }

  function logSkippedRemoteApply(
    reason: string,
    noteId: string,
    remoteVersion: number,
  ) {
    const local = activeNoteRef.current;
    const yText = getCollabMarkdownSnapshot();
    console.warn("[EditorPane] skip active note remote refresh", {
      reason,
      noteId,
      localVersion: local?.version,
      remoteVersion,
      collabSynced: collabSyncedRef.current,
      yTextLength: yText?.length ?? null,
      providerStatus: collabProviderRef.current?.getStatus?.() ?? null,
    });
  }

  function applyFetchedRemoteNote(fresh: Note) {
    actions.setActiveNote(fresh);
    actions.updateNoteInList({
      id: fresh.id,
      title: fresh.title,
      contentText: fresh.contentText,
      updatedAt: fresh.updatedAt,
      version: fresh.version,
      isPinned: fresh.isPinned,
      isFavorite: fresh.isFavorite,
      isLocked: fresh.isLocked,
      isTrashed: fresh.isTrashed,
      notebookId: fresh.notebookId,
      workspaceId: fresh.workspaceId,
    } as any);
    actions.updateNoteTab({
      id: fresh.id,
      title: fresh.title,
      updatedAt: fresh.updatedAt,
      contentFormat: fresh.contentFormat,
      isLocked: fresh.isLocked,
      isTrashed: fresh.isTrashed,
      notebookId: fresh.notebookId,
    });
    actions.setLastSynced(new Date().toISOString());
  }

  async function applyRemoteNoteUpdate(msg: {
    noteId: string;
    version: number;
    updatedAt?: string;
    title?: string;
    contentText?: string;
    actorUserId?: string;
  }) {
    const cur = activeNoteRef.current;
    if (!isRemoteVersionNewer(cur, msg)) return;

    actions.updateNoteInList({
      id: msg.noteId,
      title: msg.title,
      contentText: msg.contentText,
      updatedAt: msg.updatedAt,
      version: msg.version,
    } as any);

    const applyKey = `${msg.noteId}:${msg.version}`;
    if (lastAutoAppliedRemoteRef.current === applyKey) return;

    try {
      const collabDoc = collabYDocRef.current;
      const beforeYText = getCollabMarkdownSnapshot();
      if (collabDoc && (!collabSyncedRef.current || beforeYText === "")) {
        try {
          collabProviderRef.current?.requestResync?.();
        } catch {
          /* ignore */
        }
      }

      const fresh = await api.getNote(msg.noteId);
      const latest = activeNoteRef.current;
      if (!latest || latest.id !== msg.noteId) return;
      if (latest.version >= fresh.version) return;

      const freshMarkdown = normalizeToMarkdown(
        fresh.content,
        fresh.contentText,
      );
      const currentYText = getCollabMarkdownSnapshot();
      const yTextAlreadyFresh =
        currentYText !== null && currentYText === freshMarkdown;
      if (!yTextAlreadyFresh && hasLocalUnsavedChanges()) {
        logSkippedRemoteApply("local-unsaved", msg.noteId, fresh.version);
        return;
      }

      if (collabDoc && !yTextAlreadyFresh) {
        writeMarkdownToCollabYDoc(freshMarkdown);
      }

      lastAutoAppliedRemoteRef.current = applyKey;
      applyFetchedRemoteNote(fresh);
    } catch (e) {
      console.warn("[EditorPane] auto apply remote note failed:", e);
    }
  }

  async function checkActiveNoteRemoteVersion(reason: string) {
    const cur = activeNoteRef.current;
    if (!cur) return;
    try {
      const slim = await api.getNoteSlim(cur.id);
      const latest = activeNoteRef.current;
      if (!latest || latest.id !== cur.id) return;
      if (typeof slim.version === "number" && slim.version > latest.version) {
        await applyRemoteNoteUpdate({
          noteId: cur.id,
          version: slim.version,
          updatedAt: slim.updatedAt,
          title: slim.title,
          contentText: slim.contentText,
        });
      }
    } catch (e) {
      console.warn(
        `[EditorPane] active note version check failed (${reason}):`,
        e,
      );
    }
  }

  useEffect(() => {
    const applied = (event: Event) => {
      const cur = activeNoteRef.current;
      const detail = (event as CustomEvent<MobileSyncAppliedDetail>).detail;
      if (!cur || !detail) return;
      if (detail.deletedNoteIds.includes(cur.id))
        setRemoteDelete({ trashed: false });
      else if (detail.noteIds.includes(cur.id))
        void checkActiveNoteRemoteVersion("native-sync");
    };
    window.addEventListener(MOBILE_SYNC_APPLIED_EVENT, applied);
    return () => window.removeEventListener(MOBILE_SYNC_APPLIED_EVENT, applied);
    // The handler reads current note/editor state through existing refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    presenceUsers,
    isConnected,
    setEditing: rtSetEditing,
  } = useRealtimeNote({
    noteId: activeNote?.id ?? null,
    // 显式传入 selfUserId：EditorPane 里已有 selfUser（localStorage 缓存 + /api/me），
    // 直接传下去能消除 hook 内部"selfUserId 为 null 窗口期"导致的误提示
    // （自己编辑时弹 "XX 正在编辑 / XX 更新了笔记"）。
    selfUserId: selfUser?.userId ?? null,
    onRemoteUpdate: (msg) => {
      void applyRemoteNoteUpdate(msg);
    },
    onRemoteDelete: (msg) => {
      const cur = activeNoteRef.current;
      if (!cur || cur.id !== msg.noteId) return;
      setRemoteDelete({ actorUserId: msg.actorUserId, trashed: msg.trashed });
    },
  });

  useEffect(() => {
    realtime.connect();
    const offListUpdated = realtime.on("note:list-updated", (msg: any) => {
      const note = msg?.note;
      if (!note?.id) return;
      actions.updateNoteInList({
        id: note.id,
        title: note.title,
        contentText: note.contentText,
        updatedAt: note.updatedAt,
        version: note.version,
        isPinned: note.isPinned,
        isFavorite: note.isFavorite,
        isLocked: note.isLocked,
        isTrashed: note.isTrashed,
        notebookId: note.notebookId,
        workspaceId: note.workspaceId,
      } as any);
      actions.updateNoteTab({
        id: note.id,
        title: note.title,
        updatedAt: note.updatedAt,
        contentFormat: note.contentFormat,
        isLocked: note.isLocked,
        isTrashed: note.isTrashed,
        notebookId: note.notebookId,
      });

      const cur = activeNoteRef.current;
      if (
        !isRemoteVersionNewer(cur, { noteId: note.id, version: note.version })
      )
        return;
      void applyRemoteNoteUpdate({
        noteId: note.id,
        version: note.version,
        updatedAt: note.updatedAt,
        title: note.title,
        contentText: note.contentText,
        actorUserId: msg?.actorUserId,
      });
    });
    return () => {
      offListUpdated();
    };
    // applyRemoteNoteUpdate 内部读取 ref；这里保持一次订阅，避免保存过程反复重订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  // 移动端后台恢复 / 网络恢复 / WebSocket 重连时可能错过实时消息，补查一次当前笔记版本。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible")
        void checkActiveNoteRemoteVersion("visible");
    };
    const onOnline = () => void checkActiveNoteRemoteVersion("online");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
    // checkActiveNoteRemoteVersion 是函数声明，内部读 ref；不需要作为依赖触发重绑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isConnected) void checkActiveNoteRemoteVersion("ws-open");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, activeNote?.id]);

  // ---------------------------------------------------------------------------
  // Phase 3: Y.js CRDT Эͬ
  // ---------------------------------------------------------------------------

  /**
   * Phase 3 启用条件：
   *   - 使用 Markdown 编辑器（Tiptap JSON 无法无损映射到 Y.Text）
   *   - 笔记未锁定（锁定态直接只读，无需协同）
   *   - 已知当前用户信息（作为 awareness 身份）
   *   - 有 activeNote
   *
   * 注：单人场景下也启用——本地只一个 client，y-collab 相当于空操作，但获得了
   * 服务端增量持久化与断线重连后的自动合并。
   */
  const collabReady = !!(
    activeNote &&
    !activeNote.isLocked &&
    selfUser &&
    editorMode === "md" &&
    activeNote.contentFormat !== "plaintext" &&
    !isAndroidNativeRuntime() &&
    !/nowen-encrypted/i.test(activeNote.content || "") &&
    isFeatureEnabled("collab")
  );
  const {
    doc: collabYDoc,
    provider: collabProvider,
    synced: collabSynced,
  } = useYDoc({
    noteId: collabReady ? (activeNote?.id ?? null) : null,
    user: selfUser,
    enabled: collabReady,
  });

  /**
   * collabYDoc 的 ref 镜像。
   *
   * 背景：`toggleEditorMode`（在组件顶部定义）需要在切换前从 yDoc 读取最新
   * markdown 回填 activeNote，避免切到 RTE 后丢最近几百毫秒的输入。但是
   * `toggleEditorMode` 声明点在 `collabYDoc` 之前，若把 collabYDoc 直接写进
   * useCallback 的闭包与 deps，会踩 TDZ（初次 render 时 deps 数组求值发生在
   * useYDoc 之前，collabYDoc 还在暂时性死区）。用 ref 间接访问即可规避。
   */
  const collabYDocRef = useRef<typeof collabYDoc>(null);
  collabYDocRef.current = collabYDoc;
  const collabProviderRef = useRef<typeof collabProvider>(null);
  collabProviderRef.current = collabProvider;

  /**
   * CRDT synced 状态的 ref 镜像。
   *
   * 用途：
   *   - toggleEditorMode 需要在切换前判断"CRDT 是否已完成初次 sync"。未 synced 时
   *     yDoc.getText("content") 读出来可能是空串（还没收到服务端 y:sync），
   *     此时贸然切到 RTE 会把空内容当作最新内容回填 activeNote，用户最近输入全丢。
   *   - 同样用 ref 而非直接引用 collabSynced，规避 toggleEditorMode useCallback
   *     的 TDZ 问题（声明顺序晚于 toggleEditorMode）。
   *   - collabReadyRef 用于区分"没启用 CRDT (MD→RTE 不在 CRDT 模式)"与"启用但未 sync"。
   */
  const collabSyncedRef = useRef<boolean>(false);
  collabSyncedRef.current = collabSynced;
  const collabReadyRef = useRef<boolean>(false);
  collabReadyRef.current = collabReady;

  /**
   * UX7 救命出口：记录上次"未 sync 时尝试切换"的时间戳。
   * 第一次点击：toast 警告+记录时间戳，阻止切换。
   * 3 秒内第二次点击：认为用户坚持切换，放行（绕过 UX6 保护）。
   * 超过 3 秒：时间戳过期，视为新一次"第一次点击"。
   * 用 ref 存，不污染 render 循环。
   */
  const lastUnsyncedClickAtRef = useRef<number>(0);

  // 切换笔记时清空横幅
  useEffect(() => {
    setRemoteDelete(null);
    // cleanup 即"离开这篇笔记"：编辑告一段落，立刻同步一次，
    // 不必等本地写入的 3 秒防抖（移动端策略：写入懒同步，离开即同步）。
    return () => { requestMobileSyncNow(); };
  }, [activeNote?.id]);

  // ── 切换笔记时自动检测 HTML 格式并进入预览模式 ──
  // 如果笔记内容格式为 "html"，自动启用 HTML 预览；否则回退到常规编辑器。
  useEffect(() => {
    if (!activeNote) return;
    previewInitializedNoteIdRef.current = activeNote.id;
    const fmt = detectFormat(activeNote.content);
    const isHtml = activeNote.contentFormat !== "plaintext" && fmt === "html";
    const isFullDoc = isHtml && isFullHtmlDocument(activeNote.content);
    setHtmlPreviewMode(isHtml);
    setNoteIsHtml(isHtml);
    setNoteIsFullHtmlDoc(isFullDoc);
  }, [activeNote?.id]); // 只在切换笔记时检测，编辑过程中不再自动切换

  // BACKLINKS-02: 切换笔记时加载反向链接数量
  useEffect(() => {
    if (!activeNote?.id) {
      setBacklinksCount(null);
      return;
    }
    let cancelled = false;
    setBacklinksLoading(true);
    api
      .getBacklinks(activeNote.id)
      .then((data) => {
        if (!cancelled) {
          setBacklinksCount(data.backlinks.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBacklinksCount(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBacklinksLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeNote?.id]);

  /** 从 presence 中反查用户名（用于横幅显示） */
  const findUsername = useCallback(
    (userId?: string) => {
      if (!userId) return undefined;
      const match = presenceUsers.find((u) => u.userId === userId);
      return match?.username;
    },
    [presenceUsers],
  );

  /** 用户确认远程删除提示：清空当前笔记并从列表移除 */
  const handleAckRemoteDelete = useCallback(() => {
    const cur = activeNoteRef.current;
    if (cur) {
      actions.setActiveNote(null);
      actions.removeNoteFromList(cur.id);
      actions.removeNoteTab(cur.id);
      // 回收站：refreshNotes 会把它加回"回收站"视图
      actions.refreshNotes();
    }
    setRemoteDelete(null);
  }, [actions]);

  /** 编辑态广播：handleUpdate 调用时临时置 editing=true，500ms 后自动取消 */
  const editingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagEditing = useCallback(() => {
    rtSetEditing(true);
    if (editingTimerRef.current) clearTimeout(editingTimerRef.current);
    editingTimerRef.current = setTimeout(() => {
      rtSetEditing(false);
      editingTimerRef.current = null;
    }, 1500);
  }, [rtSetEditing]);
  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (editingTimerRef.current) clearTimeout(editingTimerRef.current);
    };
  }, []);

  // 窗口卸载前兜底 flush（刷新、关闭标签）
  useEffect(() => {
    const flushLifecycleSave = () => {
      persistCurrentEditorSnapshotDraft();
      try {
        editorHandleRef.current?.flushSave();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", flushLifecycleSave);
    window.addEventListener("pagehide", flushLifecycleSave);
    return () => {
      window.removeEventListener("beforeunload", flushLifecycleSave);
      window.removeEventListener("pagehide", flushLifecycleSave);
    };
  }, []);

  // NoteList/Sidebar 在真正切换 activeNote 前发出此事件，避免 Tiptap 收到新 note.id 后
  // 先清掉旧笔记的 debounce，导致切换前 500ms 内的编辑没有落库。
  useEffect(() => {
    const onBeforeNoteSwitch = () => {
      const noteId = activeNoteRef.current?.id ?? null;
      if (noteId && skipNextSwitchFlushForNoteIdRef.current === noteId) {
        skipNextSwitchFlushForNoteIdRef.current = null;
        return;
      }
      persistCurrentEditorSnapshotDraft();
      try {
        editorHandleRef.current?.flushSave();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("nowen:before-note-switch", onBeforeNoteSwitch);
    return () =>
      window.removeEventListener(
        "nowen:before-note-switch",
        onBeforeNoteSwitch,
      );
  }, []);

  // Delete 键删除笔记快捷键（仅在编辑器未聚焦时生效）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Delete" &&
        activeNote &&
        !activeNote.isLocked &&
        !viewLockedIdsRef.current.has(activeNote.id)
      ) {
        // 检查焦点是否在编辑器内部（如果在编辑器内，Delete 键应该正常删除文字）
        const activeEl = document.activeElement;
        const isInEditor =
          activeEl?.closest(".ProseMirror, .cm-editor") ||
          activeEl?.tagName === "INPUT" ||
          activeEl?.tagName === "TEXTAREA";
        if (!isInEditor) {
          e.preventDefault();
          setShowDeleteConfirm(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeNote]);

  // 标题离开正文可视区后，复用现有路径导航位显示标题，不额外增加顶部高度。
  useEffect(() => {
    setMobileTitlePinned(false);
    if (!activeNote || typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    let observer: IntersectionObserver | null = null;
    const frame = requestAnimationFrame(() => {
      const title = editorPaneRootRef.current?.querySelector<HTMLElement>(
        "[data-mobile-editor-title], [data-markdown-mobile-title]",
      );
      if (!title) return;
      observer = new IntersectionObserver(
        ([entry]) => setMobileTitlePinned(!entry?.isIntersecting),
        { threshold: 0.15 },
      );
      observer.observe(title);
    });

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeNote?.id]);

  // 点击外部关闭移动端菜单
  useEffect(() => {
    if (!showMobileMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-mobile-note-menu-trigger]")) return;
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node)
      ) {
        setShowMobileMenu(false);
        setShowMobileMoveMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMobileMenu]);

  useEffect(() => {
    if (!showDesktopMoreMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        desktopMoreMenuRef.current &&
        !desktopMoreMenuRef.current.contains(e.target as Node)
      ) {
        setShowDesktopMoreMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowDesktopMoreMenu(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showDesktopMoreMenu]);

  const applyCjkTypography = (action: CjkTypographyAction) => {
    setShowMobileMenu(false);
    setShowDesktopMoreMenu(false);
    // The underlying editor checks read-only again, guarding stale menu state.
    if (
      !activeNote ||
      !canEditActiveNote ||
      effectiveLocked ||
      isTrashed ||
      modeSwitching ||
      noteIsFullHtmlDoc
    )
      return;
    const applied =
      editorHandleRef.current?.applyCjkTypography?.(action) === true;
    if (!applied) toast.info(t("cjkTypography.noChanges"));
  };

  const handleUpdate = useCallback(
    async (data: NoteEditorUpdatePayload) => {
      const currentNote = activeNoteRef.current;
      if (
        !currentNote ||
        currentNote.isLocked ||
        viewLockedIdsRef.current.has(currentNote.id)
      )
        return;

      if (typeof data.content === "string") {
        try {
          const content = stabilizeNoteContentForPersistence(
            data.content,
            currentNote.contentFormat,
          );
          if (content !== data.content) data = { ...data, content };
        } catch (error) {
          reportTransientNoteImageSource(error, {
            operation: "handleEditorUpdate",
            noteId: currentNote.id,
          });
          return;
        }
      }

      // P0: 如果调度时的 noteId 与当前 activeNote 不一致，说明已切换笔记，跳过保存
      if (data._noteId && data._noteId !== currentNote.id) {
        console.warn("[handleUpdate] noteId mismatch, skipping save", {
          scheduled: data._noteId,
          current: currentNote.id,
        });
        return;
      }

      if (shouldSkipUnchangedTitleOnlyUpdate(currentNote.title, data)) {
        return;
      }

      // Keep the app state on the editor's latest local snapshot. The duplicate split pane uses
      // this state as its live read-only mirror, and a remounted primary editor must never
      // initialize from the last server acknowledgement while a newer save is still in flight.
      const localNote = applyEditorUpdateToNote(currentNote, data);
      if (localNote !== currentNote) {
        activeNoteRef.current = localNote;
        actions.setActiveNote(localNote);
      }

      // P0: 空内容防护已移至后端（notes.ts suspicious_empty_update 拦截）。
      // 前端不拦截空内容保存，因为：
      //   1. Tiptap 空文档 JSON 不是空字符串，前端 guard 实际上不拦截 RTE 模式
      //   2. Markdown 空文档是空字符串，前端 guard 会错误拦截用户主动清空
      //   3. 后端 guard 同时检查 content 和 contentText，更准确

    // ─── P2-5: 本地草稿双保险 ──────────────
    // 每次 onUpdate fire 都**同步**写一份草稿到 localStorage，只要后面任何环节
    // （PUT 失败 / fetch 挂死 / 页面被杀）丢了，下次打开同一笔记仍能从草稿恢复。
      if (data.content !== undefined) {
        try {
          saveDraft({
            noteId: currentNote.id,
            editorMode: editorModeRef.current,
            ...(currentNote.contentFormat === "plaintext"
              ? { contentFormat: "plaintext" as const }
              : {}),
            content: data.content,
            contentText: data.contentText || "",
            title: data.title,
            baseVersion: currentNote.version,
            savedAt: Date.now(),
          });
        } catch {
          /* ignore quota 等错误 */
        }
      }

    // Phase 2: 广播"我正在编辑"（1.5s 内无新输入则自动取消）
      try {
        flagEditing();
      } catch {}
      actions.setSyncStatus("saving");

    // 封装成小函数以便 409 后用 server 返回的 currentVersion 重放一次。
      //
    // P0-4: 409 重放时优先从编辑器拉最新 snapshot 重新构建 payload。
    //   背景：原实现 sendOnce 永远复用初次进入 handleUpdate 时的 data 闭包，
    //   而 data 是 500ms 前 debounce 时刻的内容。如果 409 等待 + 重放期间用户
    //   又敲了字，重放就会用"过时的内容"覆盖服务端最新版本（下一次的 debounce
    //   PUT 又会再 409，再用同样过时的内容覆盖一次）→ 用户感觉"我刚敲的字
    //   被吞了 / 编辑器自动回退"。
      //
    //   改法：每次 sendOnce 调用时（含首发 + 409 重放），都先尝试从
    //   editorHandleRef 取一份最新 snapshot；拿到则覆盖 content/contentText。
    //   首发时 snapshot 与 data 几乎一致（差几毫秒），副作用可忽略；重放时
    //   则确保发送的是"用户当下真正在编辑器里看到的内容"。
      //
    //   仅在 data.content !== undefined（即非 CRDT-only 场景）时才覆盖；
    //   CRDT 模式 data 不带 content，由 yjs 通道写回，绝不能在这里偷偷塞。
      let attemptCount = 0;
    // 实际发送的最后一份 payload（可能因 409 重放被换成最新 snapshot）。
    // 下方 setActiveNote 回填 content 时按它而不是初始 data，避免 activeNote
    // 与服务端真实存储内容不一致。
      let lastSentData: {
        content?: string;
        contentText?: string;
        title: string;
      } = data;
      const sendOnce = (version: number) => {
        attemptCount++;
        let effectiveData = data;
        if (data.content !== undefined && attemptCount > 1) {
          try {
            const snap = editorHandleRef.current?.getSnapshot?.();
            if (snap && typeof snap.content === "string") {
              effectiveData = {
                title: data.title,
                content: snap.content,
                contentText: snap.contentText,
              };
            }
          } catch {
          /* getSnapshot 失败时回退到原 data，不阻塞保存 */
          }
        }
        lastSentData = effectiveData;
      // P0-#2 修复：CRDT 模式下 content 未传 → 只同步 meta（title），
      // 避免 REST PUT 与服务端 yjs 回写 notes.content 产生竞态覆盖
        const payload: any = { title: effectiveData.title, version };
        payload.writeSource = "live-autosave";
        payload.contentFormat = currentNote.contentFormat;
        if (effectiveData.content !== undefined)
          payload.content = effectiveData.content;
        if (effectiveData.contentText !== undefined)
          payload.contentText = effectiveData.contentText;
        return api.updateNote(currentNote.id, payload);
      };

    // 把本次 PUT 注册为 "inflight"，供 toggleEditorMode 在切换前 await。
    // 串行化的是"本组件发起的 REST PUT"，不涉及 yjs update 流。
      //
    // 并发多次调用时后进者直接覆盖 ref（上一次的 handleUpdate 也还在 await 这个
    // inflight 链），无需 FIFO 队列；toggleEditorMode 只关心"切换点当下还未完成
    // 的那一笔 PUT"。
      const inflight = (async () => {
        try {
      // 乐观锁冲突 reconcile：服务端返回 { status: 409, currentVersion: N }。
      // 不做这一步的话，本地 activeNote.version 永远停留在旧值，之后每次 debounce
      // 自动保存都会再次 409，形成"409 风暴"（后端日志里能看到几十次连续 409）。
          //
      // putWithReconcile 的策略（与 toggleEditorMode 的规范化 PUT 共用同一套实现）：
      //   1) 首选用 err.currentVersion 重放一次；
      //   2) 服务端没附带版本号时再兜底走 fetchLatestVersion（GET /notes/:id）；
      //   3) 期间切笔记（onAbort）则 abort 重放，防止把旧笔记内容写入新笔记。
          let updated;
          if (data.content !== undefined) {
        // 正文保存遇到 409 时不能再“拿最新 version 盲重放旧正文”，否则会覆盖
        // PC/Web 刚保存的内容。这里改成拉取远端最新版，保留本地草稿，并进入冲突横幅。
            try {
              updated = await sendOnce(currentNote.version);
            } catch (err: any) {
              if (!is409Error(err)) throw err;
              if (activeNoteRef.current?.id !== currentNote.id) return;
              let latestVersion =
                typeof err?.currentVersion === "number"
                  ? err.currentVersion
                  : undefined;
              try {
                const fresh = await api.getNote(currentNote.id);
                latestVersion = fresh.version;
                actions.updateNoteInList({
                  id: fresh.id,
                  title: fresh.title,
                  contentText: fresh.contentText,
                  updatedAt: fresh.updatedAt,
                  version: fresh.version,
                } as any);
              } catch {
            /* 拉全文失败也保留本地草稿，稍后让用户重试 */
              }
              const snap = getCurrentEditorSnapshot();
              if (snap) {
                try {
                  saveDraft({
                    noteId: currentNote.id,
                    editorMode: editorModeRef.current,
                    ...(currentNote.contentFormat === "plaintext"
                      ? { contentFormat: "plaintext" as const }
                      : {}),
                    content: snap.content,
                    contentText: snap.contentText,
                    title: data.title,
                    baseVersion: latestVersion ?? currentNote.version,
                    savedAt: Date.now(),
                  });
                } catch {
                  /* ignore */
                }
              }
              actions.setSyncStatus("error");
              return;
            }
          } else {
            updated = await putWithReconcile({
              initialVersion: currentNote.version,
              send: sendOnce,
              fetchLatestVersion: makeFetchLatestNoteVersion(currentNote.id),
              onAbort: () => activeNoteRef.current?.id !== currentNote.id,
            });
          }

          if (updated && typeof lastSentData.content === "string") {
            const committedContent =
              typeof updated.content === "string"
                ? updated.content
                : lastSentData.content;
            confirmMediaNotePersistence(
              currentNote.id,
              committedContent,
              (updated as Note & { __offlineQueued?: boolean }).__offlineQueued
                ? "queued"
                : "saved",
            );
          }

      // 仅在保存的笔记仍是当前激活笔记时更新状态（防止快速切换时覆盖错误笔记）
          if (activeNoteRef.current?.id === updated.id) {
        // 关键：必须把刚保存的 content / contentText 也回填到 activeNote。
            //
        // 背景（为什么之前只回填元数据）：曾经担心 content 回填会让 activeNote
        // 引用变化 → TiptapEditor 的 useEffect([note.content]) 触发 setContent
        // → 光标/输入被打断。所以之前只回填 version/updatedAt/title。
            //
            // 修复"切换编辑器 (MD ⇄ RTE)"后内容丢失的 bug：
        //   - MD 编辑器保存 → activeNote.content 仍是旧 Tiptap JSON（未刷新）
        //   - 切到 Tiptap → TiptapEditor 读 note.content → 读到的是旧 JSON
        //     → 用户在 MD 里做的所有修改完全"消失"
        //   - 反向同理
        // 表现为"来回切换就丢内容、后续修改也被清空"。
            //
        // 解决办法：这里必须回填。编辑器侧通过 lastEmittedContentRef 守卫，
        // 比较 note.content 是否等于自己上次派出去的那份，是就跳过 setContent，
        // 避免光标抖动；不是（来自另一个编辑器或版本恢复）就正常同步。
            //
        // P1-5: content 字段优先用"实际发送给服务端的那一份"（lastSentData，
        // 可能是 409 重放时取的最新 snapshot），而不是闭包里的初始 data。
        // 进一步做"乐观自写守卫"：若 PUT 期间用户又敲了字，编辑器当前 snapshot
        // 和 lastSentData 不再相等——此时我们**保留 activeNote.content 不变**
        // （即仍是用户最新内容），只更新元数据；下一次 debounce 自动保存会
        // 把后续输入推上去。这样可以避免让 activeNote 引用回退到稍旧的版本，
        // 进而触发 TiptapEditor effect 误重建编辑器 DOM 导致输入回退。
            let nextContent = activeNoteRef.current.content;
            let nextContentText = activeNoteRef.current.contentText;
            let preserveLocalEditor = false;
            if (lastSentData.content !== undefined) {
              let editorSnap: { content: string; contentText: string } | null =
                null;
              try {
                const snap = editorHandleRef.current?.getSnapshot?.();
                if (snap && typeof snap.content === "string")
                  editorSnap = snap as any;
              } catch {
                /* ignore */
              }
              const confirmed = resolveConfirmedTiptapContent({
                serverContent:
                  typeof updated.content === "string"
                    ? updated.content
                    : undefined,
                serverContentText:
                  typeof updated.contentText === "string"
                    ? updated.contentText
                    : undefined,
                sentContent: lastSentData.content,
                sentContentText: lastSentData.contentText,
                editorSnapshot: editorSnap,
                fallbackContentText: activeNoteRef.current.contentText,
              });
              nextContent = confirmed.content;
              nextContentText = confirmed.contentText;
              preserveLocalEditor = confirmed.preserveLocalEditor;
            }
            const activeNoteForAck = activeNoteRef.current;
            if (!activeNoteForAck) return;
            if (data._saveGeneration && lastSentData.content !== undefined) {
              editorHandleRef.current?.acknowledgeSave?.({
                noteId: updated.id,
                version: updated.version,
                content: nextContent,
                saveGeneration: data._saveGeneration,
                preserveLocalEditor,
              });
            }
            actions.setActiveNote({
              ...activeNoteForAck,
              version: updated.version,
              updatedAt: updated.updatedAt,
              title: data.title,
              content: nextContent,
              contentText: nextContentText,
            });
            actions.updateNoteInList({
              id: updated.id,
              title: updated.title,
              contentText: updated.contentText,
              updatedAt: updated.updatedAt,
            });
            actions.updateNoteTab({
              id: updated.id,
              title: updated.title,
              updatedAt: updated.updatedAt,
              contentFormat: currentNote.contentFormat,
              isLocked: currentNote.isLocked,
              isTrashed: currentNote.isTrashed,
            });
            actions.setSyncStatus("saved");
            actions.setLastSynced(new Date().toISOString());
        // 2秒后恢复 idle
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(
              () => actions.setSyncStatus("idle"),
              2000,
            );

        // P2-5: 保存成功 → 清掉本地草稿，并重置连续失败计数
            try {
              clearDraft(currentNote.id);
            } catch {
              /* ignore */
            }
          }
        } catch (err) {
      // 切笔记中断（putWithReconcile 内部标记为 aborted）不是真正的错误
          if (isAborted(err)) return;
          console.warn("[EditorPane] save failed:", err);

      // ─── P0-1 兜底入队：弱网 / 服务端不可达使 save 抛错时， ──────────────
      // 把编辑器当前最新 snapshot 填入离线队列，等网络恢复后自动 flush。
      // 这一步使用户"在弱网下继续输入的内容"不会因为 saveInflight 生命周期
      // 结束而被遗忘 — 即使 api.ts 的上游拦截未调用 handleOfflineEnqueue
      // （例如 fetch 返回 4xx 但不在 retryable 名单中）也能提供一道保护。
          try {
            const snap = editorHandleRef.current?.getSnapshot?.();
            if (snap && typeof snap.content === "string") {
              enqueueOfflineMutation({
                type: "updateNote",
                noteId: currentNote.id,
                url: `/notes/${currentNote.id}`,
                method: "PUT",
                body: {
                  title: data.title,
                  content: snap.content,
                  contentText: snap.contentText,
                  contentFormat: currentNote.contentFormat,
                  version: currentNote.version,
                },
              });
              confirmMediaNotePersistence(
                currentNote.id,
                snap.content,
                "queued",
              );
            }
          } catch (queueErr) {
            console.warn(
              "[EditorPane] enqueue offline fallback failed:",
              queueErr,
            );
          }

          actions.setSyncStatus("error");
        }
      })();

      saveInflightRef.current = inflight;
      try {
        await inflight;
      } finally {
      // 只清空"自己"注册的那份；若期间又有新 PUT 注册新 promise，保留不动
        if (saveInflightRef.current === inflight) {
          saveInflightRef.current = null;
        }
      }
    },
    [actions, flagEditing],
  );

  // 保持 handleUpdateRef 总是指向最新 handleUpdate（供 P2-5 草稿恢复调用）
  useEffect(() => {
    handleUpdateRef.current = handleUpdate;
  }, [handleUpdate]);

  // 手动触发同步：重新保存当前编辑器内容
  const handleManualSync = useCallback(async () => {
    const currentNote = activeNoteRef.current;
    if (!currentNote || syncStatus === "saving") return;

    // Manual sync must submit what is visible in the editor. In CRDT mode the live
    // Markdown resides in CodeMirror/Y.Doc and activeNote.content can still be the
    // previous server acknowledgement, which used to overwrite the second edit.
    const snapshot = editorHandleRef.current?.getSnapshot?.();
    editorHandleRef.current?.discardPending?.();
    const title = snapshot?.title ?? currentNote.title;
    const content = snapshot?.content ?? currentNote.content;
    const contentText = snapshot?.contentText ?? currentNote.contentText;

    actions.setSyncStatus("saving");
    try {
      // GET flushes an active server-side Y.Doc first and gives this explicit save the
      // current optimistic-lock version. If the Y update already arrived, avoid a
      // redundant PUT/version bump; otherwise persist the editor snapshot and align Y.Doc.
      const persisted = await api.getNote(currentNote.id);
      const alreadyPersisted =
        persisted.title === title &&
        persisted.content === content &&
        persisted.contentText === contentText &&
        persisted.contentFormat === currentNote.contentFormat;
      const updated = alreadyPersisted
        ? persisted
        : await api.updateNoteConfirmed(currentNote.id, {
            title,
            content,
            contentText,
            contentFormat: currentNote.contentFormat,
            version: persisted.version,
            syncToYjs: true,
            writeSource: "manual-save",
          } as any);
      activeNoteRef.current = updated;
      actions.setActiveNote(updated);
      actions.updateNoteInList({
        id: updated.id,
        title: updated.title,
        contentText: updated.contentText,
        updatedAt: updated.updatedAt,
        version: updated.version,
      });
      actions.updateNoteTab({
        id: updated.id,
        title: updated.title,
        updatedAt: updated.updatedAt,
        contentFormat: updated.contentFormat,
        isLocked: updated.isLocked,
        isTrashed: updated.isTrashed,
      });
      actions.setSyncStatus("saved");
      actions.setLastSynced(new Date().toISOString());
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(
        () => actions.setSyncStatus("idle"),
        2000,
      );
    } catch (error) {
      console.warn("[EditorPane] manual sync failed:", error);
      actions.setSyncStatus("error");
    }
  }, [syncStatus, actions]);

  const toggleFavorite = useCallback(async () => {
    if (!activeNote || activeNote.isTrashed) return;
    haptic.light();
    const updated = await api.updateNote(activeNote.id, {
      isFavorite: activeNote.isFavorite ? 0 : 1,
    } as any);
    actions.setActiveNote(updated);
    actions.updateNoteInList({
      id: updated.id,
      isFavorite: updated.isFavorite,
    });
  }, [activeNote, actions]);

  const beginEncryption = () => {
    const currentNote = activeNoteRef.current;
    if (
      !currentNote ||
      effectiveLocked ||
      !canEditActiveNote ||
      Capacitor.isNativePlatform() ||
      saveInflightRef.current
    )
      return;
    const snapshot = editorHandleRef.current?.getSnapshot?.();
    const source = {
      ...currentNote,
      content: snapshot?.content ?? currentNote.content,
      contentText: snapshot?.contentText ?? currentNote.contentText,
      title: snapshot?.title ?? currentNote.title,
    };
    if (
      !sameConversionContent(
        source.content,
        currentNote.content,
        currentNote.contentFormat,
      ) ||
      source.title !== currentNote.title
    ) {
      saveDraft({
        noteId: source.id,
        editorMode: editorModeRef.current,
        content: source.content,
        contentText: source.contentText,
        title: source.title,
        baseVersion: source.version,
        savedAt: Date.now(),
      });
    }
    setShowMobileMenu(false);
    setShowDesktopMoreMenu(false);
    onEncryptNote(source);
  };

  const togglePin = useCallback(async () => {
    if (!activeNote || activeNote.isTrashed) return;
    haptic.light();
    const updated = await api.updateNote(activeNote.id, {
      isPinned: activeNote.isPinned ? 0 : 1,
    } as any);
    actions.setActiveNote(updated);
    actions.updateNoteInList({ id: updated.id, isPinned: updated.isPinned });
  }, [activeNote, actions]);

  const setNoteColorMark = useCallback(
    async (colorMark: NoteColorMark | null) => {
      if (!activeNote || activeNote.isTrashed || !canWriteNote(activeNote))
        return;
      haptic.light();
      const updated = await api.updateNote(activeNote.id, { colorMark });
      const nextColor = updated.colorMark ?? colorMark;
      actions.setActiveNote({ ...updated, colorMark: nextColor });
      actions.updateNoteInList({ id: updated.id, colorMark: nextColor });
      actions.updateNoteTab({
        id: updated.id,
        colorMark: nextColor,
      } as unknown as Partial<import("@/store/AppContext").OpenNoteTab> & {
        id: string;
      });
      try {
        window.dispatchEvent(
          new CustomEvent("nowen:knowledge-tree-changed", {
            detail: { reason: "note-color-mark-changed" },
          }),
        );
      } catch {
        /* A notification failure must not interrupt editing. */
      }
    },
    [activeNote, actions],
  );

  const toggleLock = useCallback(async () => {
    if (!activeNote || activeNote.isTrashed) return;
    haptic.medium();
    // 优先解除"会话锁"（用户偏好"打开即锁定"造成的临时只读）：
    //   - 库里本身 isLocked=1：那就走老逻辑切 DB；
    //   - 库里 isLocked=0 但本会话被偏好锁住：只移除本地集合即可，不写后端，
    //     避免一次"临时解锁"被永久持久化为该笔记的库状态。
    if (!activeNote.isLocked && viewLockedIds.has(activeNote.id)) {
      setViewLockedIds((prev) => {
        if (!prev.has(activeNote.id)) return prev;
        const next = new Set(prev);
        next.delete(activeNote.id);
        return next;
      });
      return;
    }
    const updated = await api.updateNote(activeNote.id, {
      isLocked: activeNote.isLocked ? 0 : 1,
    } as any);
    actions.setActiveNote(updated);
    actions.updateNoteInList({ id: updated.id, isLocked: updated.isLocked });
    actions.updateNoteTab({
      id: updated.id,
      isLocked: updated.isLocked,
      updatedAt: updated.updatedAt,
    });
    // 若刚把库锁切到 1（加锁），就不必再额外维持本地会话锁——库锁已经覆盖。
    // 若把库锁切到 0（解锁），同时清掉本会话的会话锁（如果有），保证 UI 一次解锁到位。
    if (!updated.isLocked) {
      setViewLockedIds((prev) => {
        if (!prev.has(activeNote.id)) return prev;
        const next = new Set(prev);
        next.delete(activeNote.id);
        return next;
      });
    }
  }, [activeNote, actions, viewLockedIds]);

  // NOTE-IMAGE-EXPORT-01: 导出笔记为图片
  const handleExportNoteImage = useCallback(
    async (format: "png" | "jpg") => {
      if (!activeNote) return;
      const toastId = toast.info(t("note.exportImageExporting"), 0);
      try {
        const ok = await exportNoteAsImage(
          {
            id: activeNote.id,
            title: activeNote.title,
            content: activeNote.content,
            contentText: activeNote.contentText,
            contentFormat: activeNote.contentFormat,
            updatedAt: activeNote.updatedAt,
          },
          { format },
        );
        toast.dismiss(toastId);
        ok
          ? toast.success(t("note.exportImageSuccess"))
          : toast.error(t("note.exportImageFailed"));
      } catch {
        toast.dismiss(toastId);
        toast.error(t("note.exportImageFailed"));
      }
    },
    [activeNote, t],
  );

  const handlePrintNote = useCallback(async () => {
    if (!activeNote) return;
    haptic.medium();
    try {
      const snapshot = editorHandleRef.current?.getSnapshot?.();
      const result = await printNote({
        title: activeNote.title,
        content: snapshot?.content ?? activeNote.content,
        contentText: snapshot?.contentText ?? activeNote.contentText,
        contentFormat: activeNote.contentFormat,
        createdAt: activeNote.createdAt,
        updatedAt: activeNote.updatedAt,
      });
      if (!result.ok) toast.error(t("note.printFailed"));
    } catch {
      toast.error(t("note.printFailed"));
    }
  }, [activeNote, t]);
  const moveToTrash = useCallback(async () => {
    // 锁定（库锁或会话锁）笔记不允许进回收站，避免"被保护笔记"被误删。
    if (
      !activeNote ||
      activeNote.isLocked ||
      activeNote.isTrashed ||
      viewLockedIdsRef.current.has(activeNote.id)
    )
      return;
    haptic.heavy();
    const noteId = activeNote.id;
    const currentTabIndex = state.openNoteTabs.findIndex(
      (tab) => tab.id === noteId,
    );
    const nextTab =
      userPrefs.enableNoteTabs && currentTabIndex >= 0
        ? state.openNoteTabs[currentTabIndex + 1] ||
          state.openNoteTabs[currentTabIndex - 1] ||
          null
        : null;
    actions.setActiveNote(null);
    actions.removeNoteFromList(noteId);
    actions.removeNoteTab(noteId);
    if (nextTab) {
      void loadNote({
        noteId: nextTab.id,
        summary: {
          title: nextTab.title || t("editorTabs.noTitle"),
          notebookId: nextTab.notebookId,
          contentFormat: nextTab.contentFormat,
        },
        request: () => api.getNote(nextTab.id),
        onSuccess: (nextNote) => {
          actions.setActiveNote(nextNote);
          actions.openNoteTab({
            id: nextNote.id,
            title: nextNote.title,
            notebookId: nextNote.notebookId,
            workspaceId: nextNote.workspaceId,
            contentFormat: nextNote.contentFormat,
            isLocked: nextNote.isLocked,
            isTrashed: nextNote.isTrashed,
            updatedAt: nextNote.updatedAt,
          });
        },
      });
    }
    api
      .updateNote(noteId, { isTrashed: 1 } as any)
      .then(() => {
        actions.refreshNotebooks();
        // 刷新列表：若当前处于"回收站"视图，这条笔记需要立即出现；
        // 其他视图也重新拉一下，保证与服务端一致。
        actions.refreshNotes();
      })
      .catch(console.error);
  }, [
    activeNote,
    actions,
    loadNote,
    state.openNoteTabs,
    t,
    userPrefs.enableNoteTabs,
  ]);

  /**
   * 冲突解决后刷新当前笔记。
   *
   * 选择「采用云端版本 / 手动合并」时，本地库已被云端版本覆盖，但编辑器里仍缓存着
   * 冲突前的旧内容。若不丢弃这段缓冲，自动保存会把旧内容重新推送到云端，
   * 表现为"选了保存云端版本，云端版本却被改掉"。
   */
  useEffect(() => {
    const onConflictResolved = (event: Event) => {
      const detail = (event as CustomEvent<{
        entityType?: string;
        entityId?: string;
        resolution?: string;
      }>).detail;
      const entityId = detail?.entityId;
      if (!detail || detail.entityType !== "note" || !entityId) return;
      // keep-local 以本机为准，编辑器内容就是结果，无需重载。
      if (detail.resolution === "keep-local") return;
      if (activeNote?.id !== entityId) return;
      editorHandleRef.current?.discardPending?.();
      void loadNote({
        noteId: entityId,
        summary: { title: activeNote.title, notebookId: activeNote.notebookId },
        request: () => api.getNote(entityId),
        onSuccess: (note) => actions.setActiveNote(note),
      });
    };
    window.addEventListener("nowen:sync-conflict-resolved", onConflictResolved);
    return () => window.removeEventListener("nowen:sync-conflict-resolved", onConflictResolved);
  }, [activeNote, actions, loadNote]);

  // BLOCK-LINKS-JUMP-01: 打开笔记回调（用于笔记引用跳转）
  const handleOpenNote = useCallback(
    async (noteId: string) => {
      await loadNote({
        noteId,
        summary: { title: t("editor.noteLoading"), notebookId: "" },
        request: () => api.getNote(noteId),
        onSuccess: (note) => actions.setActiveNote(note),
      });
    },
    [actions, loadNote, t],
  );

  const handleTagsChange = useCallback(
    (tags: Tag[]) => {
      if (!activeNote) return;
      actions.setActiveNote({ ...activeNote, tags });
      api.getTags().then(actions.setTags).catch(console.error);
    },
    [activeNote, actions],
  );
  const handleOpenNoteRef = useRef(handleOpenNote);
  handleOpenNoteRef.current = handleOpenNote;
  const handleEditorOpenNote = useCallback(
    (noteId: string) => handleOpenNoteRef.current(noteId),
    [],
  );
  const handleTagsChangeRef = useRef(handleTagsChange);
  handleTagsChangeRef.current = handleTagsChange;
  const handleEditorTagsChange = useCallback(
    (tags: Tag[]) => handleTagsChangeRef.current(tags),
    [],
  );

  // AI 生成标题
  const [aiTitleLoading, setAiTitleLoading] = useState(false);
  const handleAITitle = useCallback(async () => {
    if (!activeNote || !activeNote.contentText || aiTitleLoading) return;
    setAiTitleLoading(true);
    try {
      // 1) 先把编辑器里 pending 的 debounce 改动 flush 出去，避免：
      //    - AI 基于过期的 contentText 生成标题
      //    - 稍后 updateNote 因 version 落后被后端返回 409 "Version conflict"
      //      导致标题请求静默失败（之前只 console.error，用户看不到任何反馈）。
      try {
        editorHandleRef.current?.flushSave();
      } catch {
        /* ignore */
      }

      // 2) AI 生成
      const titleCtx = buildAiContext({
        action: "title",
        title: activeNote.title,
        contentText: activeNote.contentText,
        maxInputTokens: 1500,
      });
      if (titleCtx.notice) toast.info(titleCtx.notice);
      const rawTitle = await api.aiChat("title", titleCtx.promptText);
      const cleaned = extractFinalAnswer(rawTitle)
        .replace(/^["‘’“”'']+|["‘’“”'']+$/g, "")
        .trim();
      if (!cleaned) {
        toast.error(t("editor.aiTitleFailed") || "AI 未返回有效标题");
        return;
      }

      // 3) 写入标题：带乐观锁冲突的一次性重试。
      //    MD 编辑器 debounce 虽然已 flush，但 AI 请求耗时中用户仍可能继续输入
      //    → 保存 → version 自增；这里如果 409，就重新拉最新笔记拿新 version 再试。
      const doUpdate = async (version: number) =>
        api.updateNote(activeNote.id, {
          title: cleaned,
          contentFormat: activeNote.contentFormat,
          version,
        } as any);

      let updated;
      try {
        updated = await doUpdate(activeNote.version);
      } catch (err: any) {
        if (is409Error(err)) {
          actions.setSyncStatus("error");
          toast.error(
            t("editor.versionConflict") ||
              "内容已被其他设备更新，请刷新或打开版本历史处理",
          );
          return;
        }
        throw err;
      }

      // 4) 同步前端状态；MarkdownEditor 侧有独立的 [note.title] effect
      //    会把非受控 title input 的 DOM 值刷新成新标题。
      actions.setActiveNote(updated);
      actions.updateNoteInList({
        id: updated.id,
        title: updated.title,
        updatedAt: updated.updatedAt,
      });
      actions.updateNoteTab({
        id: updated.id,
        title: updated.title,
        updatedAt: updated.updatedAt,
        contentFormat: updated.contentFormat,
        isLocked: updated.isLocked,
        isTrashed: updated.isTrashed,
      });
      toast.success(t("editor.aiTitleApplied") || "已应用 AI 生成的标题");
    } catch (e: any) {
      console.error("AI title error:", e);
      toast.error(e?.message || t("editor.aiTitleFailed") || "AI 生成标题失败");
    } finally {
      setAiTitleLoading(false);
    }
  }, [activeNote, actions, aiTitleLoading, t]);

  // AI 推荐标签
  const [aiTagsLoading, setAiTagsLoading] = useState(false);
  const handleAITags = useCallback(async () => {
    if (!activeNote || !activeNote.contentText || aiTagsLoading) return;
    setAiTagsLoading(true);
    try {
      const tagsCtx = buildAiContext({
        action: "tags",
        title: activeNote.title,
        contentText: activeNote.contentText,
        maxInputTokens: 1800,
      });
      if (tagsCtx.notice) toast.info(tagsCtx.notice);
      const raw = await api.aiChat("tags", tagsCtx.promptText);
      const tagNames = parseAiTags(raw, 5);
      if (tagNames.length === 0) {
        toast.error(t("editor.aiTagsFailed") || "AI 未返回有效标签");
        setAiTagsLoading(false);
        return;
      }
      for (const name of tagNames) {
        // 检查是否已存在
        const existing = state.tags.find((t) => t.name === name);
        let tagId: string;
        if (existing) {
          tagId = existing.id;
        } else {
          const newTag = await api.createTag({ name });
          tagId = newTag.id;
        }
        // 检查是否已关联
        const noteTags = activeNote.tags || [];
        if (!noteTags.find((t) => t.id === tagId)) {
          await api.addTagToNote(activeNote.id, tagId);
        }
      }
      // 重新获取笔记和标签
      const updatedNote = await api.getNote(activeNote.id);
      actions.setActiveNote(updatedNote);
      api.getTags().then(actions.setTags).catch(console.error);
    } catch (e: any) {
      console.error("AI tags error:", e);
      toast.error(e?.message || t("editor.aiTagsFailed") || "AI 推荐标签失败");
    }
    setAiTagsLoading(false);
  }, [activeNote, actions, state.tags, aiTagsLoading]);

  // AI 总结
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryResult, setAiSummaryResult] = useState("");
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);

  const handleAISummary = useCallback(async () => {
    if (!activeNote || aiSummaryLoading) return;
    const snap = editorHandleRef.current?.getSnapshot?.();
    const text = (snap?.contentText || activeNote.contentText || "").trim();
    if (!text) {
      toast.error(
        t("editor.aiSummaryEmptyContent") || "当前笔记内容为空，无法总结",
      );
      return;
    }
    setAiSummaryLoading(true);
    setAiSummaryResult("");
    setShowSummaryDialog(true);
    try {
      const summaryCtx = buildAiContext({
        action: "summarize",
        title: activeNote.title,
        contentText: text,
        maxInputTokens: 1800,
      });
      if (summaryCtx.notice) toast.info(summaryCtx.notice);
      let result: string;
      if (
        summaryCtx.strategy === "chunked" &&
        summaryCtx.chunks &&
        summaryCtx.chunks.length > 1
      ) {
        const partials: string[] = [];
        for (const chunk of summaryCtx.chunks) {
          const partial = await api.aiChat("summarize", chunk.text);
          partials.push(partial.trim());
        }
        result = await api.aiChat("summarize", partials.join("\n\n---\n\n"));
      } else {
        result = await api.aiChat("summarize", summaryCtx.promptText);
      }
      result = extractFinalAnswer(result);
      if (!result.trim()) {
        toast.error(t("editor.aiSummaryEmptyResult") || "AI 未返回有效总结");
        setShowSummaryDialog(false);
        return;
      }
      setAiSummaryResult(result.trim());
    } catch (e: any) {
      console.error("AI summary error:", e);
      toast.error(e?.message || t("editorOps.summaryFailed"));
      setShowSummaryDialog(false);
    } finally {
      setAiSummaryLoading(false);
    }
  }, [activeNote, aiSummaryLoading, t]);

  const handleSummaryCopy = useCallback(async () => {
    if (!aiSummaryResult) return;
    try {
      await navigator.clipboard.writeText(aiSummaryResult);
      toast.success(t("editor.aiSummaryCopied") || "已复制");
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }, [aiSummaryResult, t]);

  const handleSummaryAppend = useCallback(async () => {
    if (!activeNote || !aiSummaryResult) return;
    const md = "\n\n## AI 总结\n\n" + aiSummaryResult + "\n";
    const appended = editorHandleRef.current?.appendMarkdown?.(md);
    if (!appended) {
      // 编辑器不支持 appendMarkdown，fallback 到复制文本
      try {
        await navigator.clipboard.writeText(aiSummaryResult);
        toast.success(
          t("editor.aiSummaryCopied") || "已复制到剪贴板，请手动粘贴",
        );
      } catch {
        toast.error(t("editorOps.appendFailed"));
      }
      return;
    }
    // 立即落盘
    try {
      editorHandleRef.current?.flushSave();
    } catch {
      /* ignore */
    }
    toast.success(t("editor.aiSummaryAppended") || "已追加到笔记末尾");
    setShowSummaryDialog(false);
  }, [activeNote, aiSummaryResult, t]);

  // AI 生成 Mermaid
  const [aiMermaidLoading, setAiMermaidLoading] = useState(false);
  const [aiMermaidResult, setAiMermaidResult] = useState("");
  const [aiMermaidType, setAiMermaidType] = useState<
    "mermaid_mindmap" | "mermaid_flowchart"
  >("mermaid_mindmap");
  const [showMermaidDialog, setShowMermaidDialog] = useState(false);
  const [showMindMapInsertDialog, setShowMindMapInsertDialog] = useState(false);

  useEffect(() => {
    const openMindMapInsert = () => setShowMindMapInsertDialog(true);
    window.addEventListener("nowen:open-mindmap-insert", openMindMapInsert);
    return () =>
      window.removeEventListener(
        "nowen:open-mindmap-insert",
        openMindMapInsert,
      );
  }, []);

  const handleAIMermaid = useCallback(
    async (type: "mermaid_mindmap" | "mermaid_flowchart") => {
      if (!activeNote || aiMermaidLoading) return;
      const snap = editorHandleRef.current?.getSnapshot?.();
      const text = (snap?.contentText || activeNote.contentText || "").trim();
      if (!text) {
        toast.error(t("editor.aiSummaryEmptyContent") || "当前笔记内容为空");
        return;
      }
      setAiMermaidLoading(true);
      setAiMermaidResult("");
      setAiMermaidType(type);
      setShowMermaidDialog(true);
      try {
        const mermaidCtx = buildAiContext({
          action: type,
          title: activeNote.title,
          contentText: text,
          maxInputTokens: 3000,
        });
        if (mermaidCtx.notice) toast.info(mermaidCtx.notice);
        let result = await api.aiChat(type, mermaidCtx.promptText);
        // 先洗掉外层围栏
        result = result
          .replace(/^```mermaid\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```\s*$/, "")
          .trim();
        // 从 AI 返回文本中提取 mermaid 源码（AI 可能返回思考过程 + 源码）
        const mindmapMatch = result.match(/^(mindmap[\s\S]*)/m);
        const flowchartMatch = result.match(/^(flowchart\s+TD[\s\S]*)/m);
        if (mindmapMatch) {
          result = mindmapMatch[1].trimEnd();
        } else if (flowchartMatch) {
          result = flowchartMatch[1].trimEnd();
        }
        // Sanitize: strip chars that break Mermaid mindmap parsing
        result = result.replace(
          /^(\s*\S+\s+)(.*?)(\s*)$/gm,
          (_m: string, prefix: string, body: string, tail: string) => {
            return prefix + body.replace(/[[\]{}:|]/g, " ") + tail;
          },
        );
        if (!result) {
          toast.error(
            t("editor.aiSummaryEmptyResult") || "AI 未返回有效思维导图",
          );
          setShowMermaidDialog(false);
          return;
        }
        setAiMermaidResult(result);
      } catch (e: any) {
        console.error("AI mermaid error:", e);
        toast.error(e?.message || t("editorOps.generateFailed"));
        setShowMermaidDialog(false);
      } finally {
        setAiMermaidLoading(false);
      }
    },
    [activeNote, aiMermaidLoading, t],
  );

  const handleMermaidInsert = useCallback(() => {
    if (!activeNote || !aiMermaidResult) return;
    const md = "\n\n```mermaid\n" + aiMermaidResult + "\n```\n";
    const appended = editorHandleRef.current?.appendMarkdown?.(md);
    if (!appended) {
      try {
        navigator.clipboard.writeText(
          "```mermaid\n" + aiMermaidResult + "\n```",
        );
        toast.success(
          t("editor.aiSummaryCopied") || "已复制到剪贴板，请手动粘贴",
        );
      } catch {
        toast.error(t("common.copyFailed"));
      }
      return;
    }
    try {
      editorHandleRef.current?.flushSave();
    } catch {}
    toast.success(t("editorOps.inserted"));
    setShowMermaidDialog(false);
  }, [activeNote, aiMermaidResult, t]);
  /** 将 Mermaid mindmap 源码解析为 MindMapData */
  const parseMermaidToMindMap = useCallback(
    (source: string): MindMapData | null => {
      try {
        const data = parseMermaidMindmap(source);
        return normalizeMindMapData(data);
      } catch {
        return null;
      }
    },
    [],
  );

  const [mermaidSavingMindMap, setMermaidSavingMindMap] = useState(false);
  const handleMermaidSaveAsMindMap = useCallback(async () => {
    if (!aiMermaidResult) return;
    const data = parseMermaidToMindMap(aiMermaidResult);
    if (!data) {
      toast.error(t("editorOps.mindmapConversionFailed"));
      return;
    }
    setMermaidSavingMindMap(true);
    try {
      const title =
        data.root.text.slice(0, 50) || t("editorOps.mindmapDefaultTitle");
      const created = await api.createMindMap({
        title,
        data: JSON.stringify(data),
      });
      toast.success(t("editorOps.mindmapSaved"));
      setShowMermaidDialog(false);
      // 通知 MindMapEditor 打开新图
      // 切换到思维导图视图
      // 保存 pending ID 到 sessionStorage 并切换到思维导图视图
      pushMindMapAppPath(created.id);
      actions.setViewMode("mindmaps");
    } catch (e: any) {
      console.error("Save mindmap error:", e);
      toast.error(e?.message || t("editorOps.saveFailed"));
    } finally {
      setMermaidSavingMindMap(false);
    }
  }, [aiMermaidResult, parseMermaidToMindMap]);

  const handleMoveToNotebook = useCallback(
    async (notebookId: string) => {
      if (!activeNote || notebookId === activeNote.notebookId) return;
    // 必须 try/catch：后端对跨工作区移动会返回 400 CROSS_WORKSPACE_MOVE_FORBIDDEN，
    // 若不捕获会冒泡成 "Uncaught (in promise)" 噪音。这里识别错误码给出明确提示。
      try {
        const updated = await api.updateNote(activeNote.id, {
          notebookId,
        } as any);
        actions.setActiveNote(updated);
        actions.updateNoteInList({
          id: updated.id,
          notebookId: updated.notebookId,
        });
        actions.updateNoteTab({
          id: updated.id,
          notebookId: updated.notebookId,
          updatedAt: updated.updatedAt,
        });
        setShowMoveDropdown(false);
        actions.refreshNotebooks();
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (/CROSS_WORKSPACE_MOVE_FORBIDDEN/.test(msg)) {
          toast.error(t("editorOps.crossSpaceMove"));
        } else {
          toast.error(msg || t("editorOps.moveFailed"));
        }
        setShowMoveDropdown(false);
      }
    },
    [activeNote, actions],
  );

  // ---- P3：AI 自动归类建议 ----
  // 点击"AI 建议归类"后发一次 /ai/classify，把 top-3 建议渲染在下拉面板内。
  // 建议加载期间按钮 disabled；失败时用 toast 提示，不阻塞用户手选。
  // 每次 activeNote 变化清空建议，避免看到上一条笔记的旧结果。
  const [aiSuggestions, setAiSuggestions] = useState<
    | {
        notebookId: string;
        notebookName: string;
        path: string;
        confidence: number;
        reason: string;
      }[]
    | null
  >(null);
  const [aiClassifyLoading, setAiClassifyLoading] = useState(false);

  useEffect(() => {
    setAiSuggestions(null);
  }, [activeNote?.id]);

  const handleAiClassify = useCallback(async () => {
    if (!activeNote || aiClassifyLoading) return;
    setAiClassifyLoading(true);
    try {
      const res = await api.aiClassify({ noteId: activeNote.id });
      // 过滤掉"就是当前笔记本"的建议——没有意义
      const filtered = res.suggestions.filter(
        (s) => s.notebookId !== activeNote.notebookId,
      );
      setAiSuggestions(filtered);
      if (filtered.length === 0) {
        toast.info(
          t("editor.aiClassifyNoSuggestion") || "AI 未找到合适的工作笔记本",
        );
      }
    } catch (e: any) {
      toast.error(
        e?.message || t("editor.aiClassifyFailed") || "AI 自动分类失败",
      );
    } finally {
      setAiClassifyLoading(false);
    }
  }, [activeNote, aiClassifyLoading, t]);

  // 构建与左侧侧边栏完全一致的笔记本树
  //
  // 但"移动到笔记本"的候选必须严格限制在**当前笔记所在的 workspace**：
  // 后端 PUT /notes/:id 已强制源/目标同 workspace，这里做前端软 guard，让
  // 用户看到的树就是干净的同空间树，避免点到必然会被 400 拒绝的笔记本。
  // workspaceId 归一：undefined/"" 都视作 null（= 个人空间）。
  const notebookTree = useMemo(() => {
    const srcWs = (activeNote?.workspaceId || null) as string | null;
    const sameWsNotebooks = activeNote
      ? state.notebooks.filter((nb) => (nb.workspaceId || null) === srcWs)
      : state.notebooks;
    return buildTree(sameWsNotebooks);
  }, [state.notebooks, activeNote]);
  // 当前笔记所属笔记本的完整路径（面包屑）
  const currentPath = useMemo(
    () => findPathById(state.notebooks, activeNote?.notebookId),
    [state.notebooks, activeNote?.notebookId],
  );

  // ── 笔记加载中骨架屏 ──
  // 在点击笔记列表后、内容还没到达前显示过渡态
  if (noteLoading && !activeNote) {
    return (
      <NoteLoadingSkeleton
        state={noteLoadingState}
        onRetry={() => {
          void retryNoteLoad();
        }}
        onBack={() => actions.setMobileView("list")}
        loadingLabel={t("editor.noteLoading")}
        errorTitle={t("noteList.loadErrorTitle")}
        errorDescription={t("noteList.loadErrorDesc")}
        retryLabel={t("noteList.retryLoad")}
      />
    );
  }

  if (!activeNote) {
    return (
      <div className="flex-1 flex flex-col bg-app-bg transition-colors relative">
        {/* 移动端：顶部返回按钮 + 提示。
            背景：原空态用 `hidden md:flex` 把内容藏起来，移动端切到 editor 视图但
            尚无 activeNote 时屏幕一片空白，用户找不到回到列表的入口（系统返回键
            虽然能触发 onBackToList，但部分用户/手势导航环境下并不直观），看起来
            就像"点笔记没反应"。这里补一条移动端可见的返回入口与文案，作为兜底。 */}
        <header
          data-adaptive-editor-empty-header
          className="flex items-center gap-2 px-3 py-2 border-b border-app-border bg-app-surface/50 md:hidden"
          style={{ paddingTop: "calc(var(--safe-area-top) + 8px)" }}
        >
          <button
            data-adaptive-editor-back
            onClick={() => actions.setMobileView("list")}
            className="flex items-center text-accent-primary py-1.5 px-1.5 -ml-1.5 rounded-lg active:bg-app-hover"
          >
            <ChevronLeft size={24} />
            <span className="text-sm font-medium">{t("editor.back")}</span>
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center px-6">
          {/* 桌面端原有空态（保持视觉不变） */}
          <div className="text-center hidden md:flex flex-col items-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-2xl bg-accent-primary/5 border border-accent-primary/10 flex items-center justify-center">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-accent-primary/30"
                >
                  <path
                    d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points="14,2 14,8 20,8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <line
                    x1="8"
                    y1="13"
                    x2="16"
                    y2="13"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1="8"
                    y1="17"
                    x2="12"
                    y2="17"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-accent-primary/10 border border-accent-primary/15 flex items-center justify-center">
                <span className="text-accent-primary/50 text-xs">?</span>
              </div>
            </div>
            <p className="text-tx-secondary text-sm font-medium mb-1">
              {t("editor.selectNote")}
            </p>
            <p className="text-tx-tertiary text-xs max-w-[220px] leading-relaxed">
              {t("editor.orCreateNew")}
            </p>
            <div className="flex items-center gap-3 mt-5">
              <kbd className="px-2 py-1 rounded-md bg-app-hover border border-app-border text-[10px] text-tx-tertiary font-mono">
                Alt+N
              </kbd>
              <span className="text-[10px] text-tx-tertiary">
                {t("editor.newNoteShortcut") || "新建笔记"}
              </span>
            </div>
          </div>
          {/* 移动端简化空态（与上面 header 配合提供完整可点交互） */}
          <div className="text-center md:hidden flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-accent-primary/5 border border-accent-primary/10 flex items-center justify-center mb-4">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                className="text-accent-primary/30"
              >
                <path
                  d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="14,2 14,8 20,8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-tx-secondary text-sm font-medium mb-1">
              {t("editor.selectNote")}
            </p>
            <p className="text-tx-tertiary text-xs max-w-[240px] leading-relaxed">
              {t("editor.orCreateNew")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <EditorToolbarHost>
      <>
        <MobileEditorToolbarPortal location="leading">
          {compactMobileEditing ? (
            <button
              data-adaptive-editor-back
              onClick={() => actions.setMobileView("list")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-accent-primary active:bg-app-hover"
              aria-label={t("editor.back")}
            >
              <ChevronLeft size={21} />
            </button>
          ) : null}
        </MobileEditorToolbarPortal>
        <MobileEditorToolbarPortal location="trailing">
          {compactMobileEditing ? (
            <div className="flex items-center gap-1">
              <SyncStatusBadge
                noteId={activeNote.id}
                saving={syncStatus === "saving"}
              />
              <Button
                data-mobile-note-menu-trigger
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  const nextOpen = !showMobileMenu;
                  if (nextOpen)
                    window.dispatchEvent(new CustomEvent("nowen:close-search"));
                  setShowMobileMenu(nextOpen);
                  setShowMobileMoveMenu(false);
                }}
                aria-label={t("common.more")}
              >
                <MoreHorizontal size={17} />
              </Button>
            </div>
          ) : null}
        </MobileEditorToolbarPortal>
        <motion.div
          ref={editorPaneRootRef}
          key={activeNote.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
          className="flex-1 flex flex-col bg-app-bg overflow-hidden transition-colors relative"
        >
      {/* 笔记切换 loading 遮罩 */}
          <AnimatePresence>
            {noteLoading && (
              <motion.div
                key={`note-loading-${noteLoadingState.requestId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.14,
                  ease: "easeOut",
                }}
                className="absolute inset-0 z-50"
              >
                <NoteLoadingSkeleton
                  mode="overlay"
                  state={noteLoadingState}
                  onRetry={() => {
                    void retryNoteLoad();
                  }}
                  onBack={() => actions.setMobileView("list")}
                  loadingLabel={t("editor.noteLoading")}
                  errorTitle={t("noteList.loadErrorTitle")}
                  errorDescription={t("noteList.loadErrorDesc")}
                  retryLabel={t("noteList.retryLoad")}
                />
              </motion.div>
            )}
          </AnimatePresence>
      {/* Mobile Editor Header — iOS 风格双行结构
          第 1 行：返回 + 面包屑（笔记本路径）+ 同步状态
          第 2 行：当前笔记标题（截断）+ 收藏 + 更多
          说明：
            - 小屏宽度有限，原来一行塞 5 个图标按钮已挤压，且看不到笔记本路径与标题；
            - 赞/踩按钮低频加载，挪进 ⋯ 菜单；菜单项反映当前状态；
            - Presence 头像在小屏意义不大，移动端不渲染；桌面端保留。 */}
          <header
            data-mobile-editor-compact={compactMobileEditing ? "true" : "false"}
            className={cn(
              "flex flex-col border-b border-app-border bg-app-surface/50 md:hidden",
              compactMobileEditing && "hidden",
            )}
            style={{ paddingTop: "var(--safe-area-top)" }}
          >
        {/* 第 1 行：返回 + 面包屑 + 同步 */}
            <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
              <button
                data-adaptive-editor-back
                onClick={() => actions.setMobileView("list")}
                className="flex items-center text-accent-primary py-1 px-1 -ml-1 rounded-lg active:bg-app-hover shrink-0"
                aria-label={t("editor.back")}
              >
                <ChevronLeft size={22} />
              </button>
          {/* 面包屑：完整路径，最后一段加粗强调，超长可滚动避免截断成 "..."
              点击调起"移动到笔记本"菜单（与桌面端面包屑可点击的语义一致） */}
              <button
                onClick={() => {
                  setShowMobileMenu(true);
                  setShowMobileMoveMenu(true);
                }}
                className="flex-1 min-w-0 flex items-center gap-1 text-xs text-tx-tertiary active:bg-app-hover rounded-md px-1.5 py-1 overflow-hidden"
                title={t("editor.moveToNotebook")}
              >
                {mobileTitlePinned ? (
                  <span className="min-w-0 truncate text-sm font-semibold text-tx-primary">
                    {activeNote.title || t("editor.untitled")}
                  </span>
                ) : currentPath.length > 0 ? (
                  <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                    {currentPath.map((nb, idx) => {
                      const isLast = idx === currentPath.length - 1;
                      return (
                        <React.Fragment key={nb.id}>
                          {idx > 0 && (
                            <ChevronRight
                              size={10}
                              className="text-tx-tertiary/60 shrink-0"
                            />
                          )}
                          <span
                            className={cn(
                              "flex min-w-0 items-center gap-0.5",
                              isLast
                                ? "text-tx-secondary font-medium"
                                : "shrink-0",
                            )}
                          >
                            <span className="leading-none">
                              {getNotebookIcon(nb.icon)}
                            </span>
                            <span
                              className={cn(
                                "truncate",
                                isLast ? "max-w-[120px]" : "max-w-[64px]",
                              )}
                            >
                              {nb.name}
                            </span>
                          </span>
                        </React.Fragment>
                      );
                    })}
                  </span>
                ) : (
                  <span className="shrink-0 leading-none">
                    {getNotebookIcon()}
                  </span>
                )}
              </button>
              <div className="shrink-0">
                <SyncIndicator
                  syncStatus={syncStatus}
                  lastSyncedAt={lastSyncedAt}
                  onManualSync={handleManualSync}
                />
              </div>
              {/* 多设备同步状态：与上面的"保存状态"分开显示。
              本地写入成功就是"已保存"，同步失败只叫"等待同步"，
              绝不能让一次网络抖动显示成"保存失败"。
              Android 保留轻量文字，未开启同步时不渲染。 */}
              {!compactMobileEditing && (
                <SyncStatusBadge
                  noteId={activeNote.id}
                  saving={syncStatus === "saving"}
                />
              )}
              <span
                className="flex shrink-0 items-center gap-0.5"
                aria-hidden="true"
              >
                {activeNote.isLocked || isViewLocked ? (
                  <Lock
                    size={12}
                    className={
                      activeNote.isLocked
                        ? "text-orange-500"
                        : "text-tx-tertiary"
                    }
                  />
                ) : null}
                {activeNote.isPinned ? (
                  <Pin
                    size={12}
                    className="text-accent-primary fill-accent-primary"
                  />
                ) : null}
                {activeNote.isFavorite ? (
                  <Star size={12} className="text-amber-400 fill-amber-400" />
                ) : null}
              </span>
              <Button
                data-mobile-note-menu-trigger
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  const nextOpen = !showMobileMenu;
                  if (nextOpen)
                    window.dispatchEvent(new CustomEvent("nowen:close-search"));
                  setShowMobileMenu(nextOpen);
                  setShowMobileMoveMenu(false);
                }}
                aria-label={t("common.more")}
              >
                <MoreHorizontal size={17} />
              </Button>
            </div>
          </header>

          {/* Mobile document actions popover: triggers live in breadcrumb or compact editor toolbar. */}
          <div
            className="absolute right-2 top-[calc(var(--safe-area-top)+2.75rem)] z-[60] shrink-0 md:hidden"
            ref={mobileMenuRef}
          >
            <Button
              data-mobile-note-menu-trigger
              variant="ghost"
              size="icon"
              className="hidden"
              onClick={() => {
                const nextOpen = !showMobileMenu;
                if (nextOpen)
                  window.dispatchEvent(new CustomEvent("nowen:close-search"));
                setShowMobileMenu(nextOpen);
                setShowMobileMoveMenu(false);
              }}
            >
              <MoreHorizontal size={16} />
            </Button>
            {/* 更多操作下拉菜单 */}
            <AnimatePresence>
              {showMobileMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute top-0 right-0 mt-1 w-56 max-h-[calc(100dvh-9rem)] bg-app-elevated border border-app-border rounded-lg shadow-xl z-50 py-1 overflow-x-hidden overflow-y-auto overscroll-contain"
                  style={{
                    maxHeight: `calc(${noteMenuViewport.height}px - 9rem - env(safe-area-inset-bottom, 0px))`,
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  {/* 置顶 / 取消置顶 */}
                  {!Capacitor.isNativePlatform() &&
                    activeNote.contentFormat !== "plaintext" && (
                      <button
                        onClick={beginEncryption}
                        disabled={
                          effectiveLocked ||
                          !canEditActiveNote ||
                          syncStatus === "saving"
                        }
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                      >
                        <Lock size={15} className="text-tx-tertiary" />
                        <span>{t("encryptedConversion.title")}</span>
                      </button>
                    )}
                  <button
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("nowen:open-search"),
                      );
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Search size={15} className="text-tx-tertiary" />
                    <span>{t("editor.searchInNote")}</span>
                  </button>
                  <button
                    onClick={() => {
                      toggleFavorite();
                      setShowMobileMenu(false);
                    }}
                    disabled={isTrashed}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    <Star
                      size={15}
                      className={cn(
                        activeNote.isFavorite
                          ? "text-amber-400 fill-amber-400"
                          : "text-tx-tertiary",
                      )}
                    />
                    <span>
                      {activeNote.isFavorite
                        ? t("editor.unfavoriteTooltip")
                        : t("editor.favoriteTooltip")}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      toggleLock();
                      setShowMobileMenu(false);
                    }}
                    disabled={isTrashed}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    {effectiveLocked ? (
                      <Lock size={15} className="text-orange-500" />
                    ) : (
                      <Unlock size={15} className="text-tx-tertiary" />
                    )}
                    <span>
                      {effectiveLocked
                        ? t("editor.unlockTooltip")
                        : t("editor.lockTooltip")}
                    </span>
                  </button>
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  <button
                    onClick={() => {
                      togglePin();
                      setShowMobileMenu(false);
                    }}
                    disabled={!!activeNote.isLocked || isTrashed}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    <Pin
                      size={15}
                      className={cn(
                        activeNote.isPinned
                          ? "text-accent-primary fill-accent-primary"
                          : "text-tx-tertiary",
                      )}
                    />
                    <span>
                      {activeNote.isPinned
                        ? t("editor.unpinTooltip")
                        : t("editor.pinTooltip")}
                    </span>
                  </button>
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  {/* 移动笔记本 */}
                  <button
                    onClick={() => setShowMobileMoveMenu(!showMobileMoveMenu)}
                    disabled={isTrashed}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    <FolderInput size={15} className="text-tx-tertiary" />
                    <span className="flex-1 text-left">
                      {t("editor.moveToNotebook")}
                    </span>
                    <ChevronRight size={14} className="text-tx-tertiary" />
                  </button>
                  {/* 移动笔记本子菜单 */}
                  <AnimatePresence>
                    {showMobileMoveMenu && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden border-t border-b border-app-border bg-app-bg/50"
                      >
                        <div className="max-h-56 overflow-auto py-1 px-1">
                          {notebookTree.map((nb) => (
                            <MoveTreeItem
                              key={nb.id}
                              notebook={nb}
                              depth={0}
                              currentId={activeNote.notebookId}
                              onSelect={(id) => {
                                handleMoveToNotebook(id);
                                setShowMobileMenu(false);
                                setShowMobileMoveMenu(false);
                              }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* 大纲 */}
                  <button
                    onClick={() => {
                      setShowMobileOutline(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <ListTree size={15} className="text-tx-tertiary" />
                    <span>{t("editor.showOutline")}</span>
                  </button>
                  <NoteThemeMenuSelect
                    noteId={activeNote.id}
                    disabled={!canWriteNote(activeNote)}
                  />
                  <CjkTypographyMenuActions
                    mobile
                    disabled={
                      !canEditActiveNote ||
                      effectiveLocked ||
                      isTrashed ||
                      modeSwitching ||
                      noteIsFullHtmlDoc
                    }
                    onAction={applyCjkTypography}
                  />
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  {/* AI 生成标题 */}
                  {isFeatureEnabled("ai") && (
                  <button
                    onClick={() => {
                      handleAITitle();
                      setShowMobileMenu(false);
                    }}
                    disabled={
                      aiTitleLoading ||
                      !activeNote.contentText ||
                      effectiveLocked
                    }
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    {aiTitleLoading ? (
                      <Loader2
                        size={15}
                        className="animate-spin text-violet-500"
                      />
                    ) : (
                      <Type size={15} className="text-violet-500" />
                    )}
                    <span>{t("editor.aiGenerateTitle")}</span>
                  </button>
                  )}
                  {/* AI 推荐标签 */}
                  {isFeatureEnabled("ai") && (
                  <button
                    onClick={() => {
                      handleAITags();
                      setShowMobileMenu(false);
                    }}
                    disabled={
                      aiTagsLoading ||
                      !activeNote.contentText ||
                      effectiveLocked
                    }
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    {aiTagsLoading ? (
                      <Loader2
                        size={15}
                        className="animate-spin text-violet-500"
                      />
                    ) : (
                      <TagIcon size={15} className="text-violet-500" />
                    )}
                    <span>{t("editor.aiSuggestTags")}</span>
                  </button>
                  )}
                  {/* AI 总结 */}
                  {isFeatureEnabled("ai") && (
                  <button
                    onClick={() => {
                      handleAISummary();
                      setShowMobileMenu(false);
                    }}
                    disabled={
                      aiSummaryLoading ||
                      !activeNote.contentText ||
                      effectiveLocked
                    }
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    {aiSummaryLoading ? (
                      <Loader2
                        size={15}
                        className="animate-spin text-violet-500"
                      />
                    ) : (
                      <Sparkles size={15} className="text-violet-500" />
                    )}
                    <span>{t("editor.aiSummary")}</span>
                  </button>
                  )}
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  {/* 分享 */}
                  {isFeatureEnabled("sharing") && (
                  <button
                    onClick={() => {
                      setShowShareModal(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Share2 size={15} className="text-emerald-500" />
                    <span>{t("editor.shareNote")}</span>
                  </button>
                  )}
                  {/* 版本历史 */}
                  <button
                    onClick={() => {
                      setShowVersionHistory(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <History size={15} className="text-violet-500" />
                    <span>{t("editor.versionHistory")}</span>
                  </button>
                  {/* 评论 */}
                  {isFeatureEnabled("sharing") && (
                  <button
                    onClick={() => {
                      setShowCommentPanel(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <MessageCircle size={15} className="text-blue-500" />
                    <span>{t("editor.noteComments")}</span>
                  </button>
                  )}
                  {/* 反向链接 BACKLINKS-02 */}
                  <button
                    onClick={() => {
                      setShowBacklinksPanel(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Link2 size={15} className="text-emerald-500" />
                    <span>反向链接</span>
                    {!backlinksLoading &&
                      backlinksCount !== null &&
                      backlinksCount > 0 && (
                        <span className="ml-auto text-xs text-tx-tertiary">
                          {backlinksCount}
                        </span>
                      )}
                  </button>
                  {/* 附件目录 */}
                  <button
                    onClick={() => {
                      setShowAttachmentsPanel(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Paperclip size={15} className="text-amber-500" />
                    <span>{t("editor.attachments")}</span>
                  </button>
                  {canSplitDocument && onSplitDocument && (
                    <button
                      onClick={() => {
                        onSplitDocument();
                        setShowMobileMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                    >
                      <Scissors size={15} className="text-accent-primary" />
                      <span>拆分文档</span>
                    </button>
                  )}
                  {/* HTML 预览 / 编辑切换（仅 HTML 片段笔记显示，完全克隆不支持编辑） */}
                  {noteIsHtml && !noteIsFullHtmlDoc && (
                    <>
                      <div className="h-px bg-app-border mx-2 my-0.5" />
                      <button
                        onClick={async () => {
                          setShowMobileMenu(false);
                          await handleToggleHtmlPreviewMode();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                      >
                        {htmlPreviewMode ? (
                          <Pencil size={15} className="text-amber-500" />
                        ) : (
                          <Eye size={15} className="text-blue-500" />
                        )}
                        <span>
                          {htmlPreviewMode
                            ? t("editor.htmlPreview.switchToEdit")
                            : t("editor.htmlPreview.switchToPreview")}
                        </span>
                      </button>
                    </>
                  )}
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  <button
                    onClick={() => {
                      setShowMobileMenu(false);
                      handlePrintNote();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Printer size={15} className="text-tx-tertiary" />
                    <span>{t("note.print")}</span>
                  </button>
                  {/* NOTE-IMAGE-EXPORT-01: 导出为图片 */}
                  <button
                    onClick={() => {
                      setShowMobileMenu(false);
                      handleExportNoteImage("png");
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Image size={15} className="text-tx-tertiary" />
                    <span>{t("note.exportAsPng")}</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowMobileMenu(false);
                      handleExportNoteImage("jpg");
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Image size={15} className="text-tx-tertiary" />
                    <span>{t("note.exportAsJpg")}</span>
                  </button>
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  {/* 删除笔记 */}
                  <button
                    onClick={() => {
                      moveToTrash();
                      setShowMobileMenu(false);
                    }}
                    disabled={effectiveLocked}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 active:bg-red-50 dark:active:bg-red-900/20 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                    <span>{t("editor.trashTooltip")}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

      {/* Mobile Outline Panel (全屏覆盖) */}
          <AnimatePresence>
            {showMobileOutline && (
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed inset-0 z-40 bg-app-surface flex flex-col md:hidden"
                style={{ paddingTop: "var(--safe-area-top)" }}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-tx-primary">
                    <ListTree size={16} className="text-accent-primary" />
                    <span>{t("editor.outline")}</span>
                  </div>
                  <button
                    onClick={() => setShowMobileOutline(false)}
                    className="p-1.5 rounded-md hover:bg-app-hover text-tx-secondary transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="py-2 px-2">
                    {headings.length === 0 ? (
                      <div className="px-3 py-12 text-center">
                        <p className="text-sm text-tx-tertiary">
                          {t("editor.noHeadings")}
                        </p>
                        <p className="text-xs text-tx-tertiary mt-1">
                          {t("editor.noHeadingsHint")}
                        </p>
                      </div>
                    ) : (
                      headings.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => {
                            scrollToRef.current?.(h.pos);
                            setShowMobileOutline(false);
                          }}
                          className={cn(
                            "w-full text-left px-4 py-2.5 text-sm transition-colors active:bg-app-hover rounded-lg",
                            h.level === 1 && "font-medium text-tx-primary",
                            h.level === 2 && "text-tx-secondary",
                            h.level === 3 && "text-tx-tertiary",
                          )}
                          style={{
                            paddingLeft: `${(h.level - 1) * 16 + 16}px`,
                          }}
                        >
                          <span
                            className={cn(
                              "inline-block w-2 h-2 rounded-full mr-2.5 shrink-0 align-middle",
                              h.level === 1 && "bg-accent-primary",
                              h.level === 2 && "bg-accent-primary/50",
                              h.level === 3 && "bg-tx-tertiary/50",
                            )}
                          />
                          {h.text || t("editor.untitled")}
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Desktop Editor Header */}
          <div className="hidden md:flex min-w-0 items-center justify-between gap-3 px-4 py-2 border-b border-app-border bg-app-surface/30 transition-colors">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <button
                  onClick={() => setShowMoveDropdown(!showMoveDropdown)}
                  className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-xs text-tx-tertiary hover:text-tx-secondary transition-colors rounded-md px-1.5 py-1 hover:bg-app-hover"
                  title={t("editor.moveToNotebook")}
                >
                  {currentPath.length > 0 ? (
                    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                      {currentPath.map((nb, idx) => {
                        const isLast = idx === currentPath.length - 1;
                  // 末段允许收缩并截断（min-w-0 + 不加 shrink-0），中间段保持紧凑不收缩
                  // 之前所有段都用 shrink-0 + truncate，导致 truncate 失效、文字与 emoji/箭头视觉重叠
                        return (
                          <React.Fragment key={nb.id}>
                            {idx > 0 && (
                              <ChevronRight
                                size={11}
                                className="text-tx-tertiary/60 shrink-0"
                              />
                            )}
                            <span
                              className={cn(
                                "flex items-center gap-1",
                                isLast
                                  ? "min-w-0 text-tx-secondary font-medium"
                                  : "shrink-0",
                              )}
                            >
                              <span className="shrink-0 leading-none">
                                {getNotebookIcon(nb.icon)}
                              </span>
                              <span
                                className={cn(
                                  "truncate",
                                  isLast ? "max-w-[180px]" : "max-w-[120px]",
                                )}
                              >
                                {nb.name}
                              </span>
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="shrink-0 leading-none">
                      {getNotebookIcon()}
                    </span>
                  )}
                  <ChevronDown size={12} className="shrink-0 ml-0.5" />
                </button>
                {showMoveDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowMoveDropdown(false)}
                    />
                    <div
                      ref={moveDropdownRef}
                      className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-zinc-950 border border-app-border rounded-lg shadow-xl z-50 py-1 max-h-96 overflow-auto"
                      style={{ animation: "contextMenuIn 0.12s ease-out" }}
                    >
                {/* ── P3：AI 建议归类 ──
                    放在顶部显眼位置；点击后加载中 → 展示建议 → 点击即移动。
                    建议不覆盖"全部笔记本"手选列表，用户两种动线共存。 */}
                      {isFeatureEnabled("ai") && (
                      <div className="px-2 pt-1 pb-0.5">
                        <button
                          onClick={handleAiClassify}
                          disabled={aiClassifyLoading}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 disabled:opacity-50 disabled:cursor-wait transition-colors"
                          title={
                            t("editor.aiClassifyTip") || "根据笔记内容推荐最合适的笔记本"
                          }
                        >
                          {aiClassifyLoading ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Sparkles size={12} />
                          )}
                          <span className="flex-1 text-left">
                            {aiClassifyLoading
                              ? t("editor.aiClassifyLoading") || "AI 正在分析…"
                              : t("editor.aiClassifyAction") || "AI 建议归类"}
                          </span>
                        </button>
                        {aiSuggestions && aiSuggestions.length > 0 && (
                          <div className="mt-1 pl-1 border-l-2 border-violet-200 dark:border-violet-500/30 ml-1.5 flex flex-col gap-0.5">
                            {aiSuggestions.map((s) => (
                              <button
                                key={s.notebookId}
                                onClick={() =>
                                  handleMoveToNotebook(s.notebookId)
                                }
                                className="group w-full flex items-start gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors text-left"
                                title={s.reason || s.path}
                              >
                                <FolderInput
                                  size={11}
                                  className="mt-0.5 shrink-0 text-violet-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate text-tx-primary group-hover:text-violet-600 dark:group-hover:text-violet-400">
                                      {s.path}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-violet-500/80 font-mono">
                                      {Math.round(s.confidence * 100)}%
                                    </span>
                                  </div>
                                  {s.reason && (
                                    <div className="text-[10px] text-tx-tertiary truncate mt-0.5">
                                      {s.reason}
                                    </div>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      )}
                      <div className="px-3 py-1.5 mt-1 text-[10px] font-medium text-tx-tertiary border-t border-b border-app-border">
                        {t("editor.moveToLabel")}
                      </div>
                      <div className="px-1 pb-1 pt-1">
                        {notebookTree.map((nb) => (
                          <MoveTreeItem
                            key={nb.id}
                            notebook={nb}
                            depth={0}
                            currentId={activeNote.notebookId}
                            onSelect={handleMoveToNotebook}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              {collabYDoc && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-accent-primary/20 bg-accent-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-accent-primary"
                  title="Live 协同编辑"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
                  Live
                </span>
              )}
              <NoteColorMarkPicker
                value={activeNote.colorMark}
                disabled={
                  effectiveLocked ||
                  activeNote.isTrashed === 1 ||
                  !canWriteNote(activeNote)
                }
                onChange={setNoteColorMark}
              />
              {activeNote.contentFormat === "plaintext" ? (
                <span className="text-xs text-tx-secondary">TXT</span>
              ) : (
                <button
                  type="button"
                  data-note-format-switch=""
                  disabled={
                    modeSwitching ||
                    effectiveLocked ||
                    noteIsHtml ||
                    !canWriteNote(activeNote)
                  }
                  onClick={async () => {
                    const targetFormat =
                      activeNote.contentFormat === "markdown"
                        ? "tiptap-json"
                        : "markdown";
                    const targetLabel =
                      targetFormat === "markdown"
                        ? t("note.format.markdown")
                        : t("note.format.richText");
                    const ok = await confirm({
                      title: t("note.format.convertTitle", {
                        target: targetLabel,
                      }),
                      description: t("note.format.convertDesc"),
                      confirmText: t("note.format.convertConfirm"),
                      cancelText: t("common.cancel", { defaultValue: "取消" }),
                    });
                    if (!ok) return;
                    await convertActiveNoteFormat({
                      noteId: activeNote.id,
                      targetFormat,
                    });
                  }}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    activeNote.contentFormat === "markdown"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15"
                      : "border-app-border bg-app-hover text-tx-tertiary hover:bg-app-active hover:text-tx-secondary",
                  )}
                  title={
                    activeNote.contentFormat === "markdown"
                      ? t("note.format.convertToRichText")
                      : t("note.format.convertToMarkdown")
                  }
                  aria-label={
                    activeNote.contentFormat === "markdown"
                      ? t("note.format.convertToRichText")
                      : t("note.format.convertToMarkdown")
                  }
                >
                  {activeNote.contentFormat === "markdown" ? (
                    <FileCode size={11} />
                  ) : (
                    <FileText size={11} />
                  )}
                  {activeNote.contentFormat === "markdown"
                    ? t("note.format.markdownShort")
                    : t("note.format.richTextShort")}
                </button>
              )}
            </div>

            {/* Sync Indicator + Grouped Actions */}
            <div className="flex shrink-0 items-center gap-1.5">
          {/* 同步状态 */}
              <SyncIndicator
                syncStatus={syncStatus}
                lastSyncedAt={lastSyncedAt}
                onManualSync={handleManualSync}
              />

              <div className="h-4 w-px shrink-0 bg-app-border" />

          {/* 编辑操作组 */}
              <div className="flex shrink-0 items-center gap-0.5 bg-app-hover/50 rounded-lg px-1 py-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={toggleLock}
                  title={
                    effectiveLocked
                      ? t("editor.unlockTooltip")
                      : t("editor.lockTooltip")
                  }
                >
                  {effectiveLocked ? (
                    <Lock
                      size={14}
                      className={
                        activeNote.isLocked
                          ? "text-orange-500"
                          : "text-tx-tertiary"
                      }
                    />
                  ) : (
                    <Unlock size={14} />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={togglePin}
                  title={
                    activeNote.isPinned
                      ? t("editor.unpinTooltip")
                      : t("editor.pinTooltip")
                  }
                >
                  <Pin
                    size={14}
                    className={cn(
                      activeNote.isPinned &&
                        "text-accent-primary fill-accent-primary",
                    )}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={toggleFavorite}
                  title={
                    activeNote.isFavorite
                      ? t("editor.unfavoriteTooltip")
                      : t("editor.favoriteTooltip")
                  }
                >
                  <Star
                    size={14}
                    className={cn(
                      activeNote.isFavorite && "text-amber-400 fill-amber-400",
                    )}
                  />
                </Button>
              </div>

          {/* 大纲 */}
              {isFeatureEnabled("sharing") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setShowShareModal(true)}
                  title={t("editor.shareNote")}
                >
                  <Share2 size={14} className="text-emerald-500" />
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="relative h-7 w-7 shrink-0"
                onClick={() => setShowBacklinksPanel(true)}
                title="反向链接"
              >
                <Link2 size={14} className="text-emerald-500" />
                {!backlinksLoading &&
                  backlinksCount !== null &&
                  backlinksCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[9px] leading-none text-white">
                      {backlinksCount > 99 ? "99+" : backlinksCount}
                    </span>
                  )}
              </Button>

              {noteIsHtml && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={handleToggleHtmlPreviewMode}
                  title={
                    htmlPreviewMode
                      ? t("editor.htmlPreview.switchToEditTooltip")
                      : t("editor.htmlPreview.switchToPreviewTooltip")
                  }
                  aria-label={
                    htmlPreviewMode
                      ? t("editor.htmlPreview.switchToEdit")
                      : t("editor.htmlPreview.switchToPreview")
                  }
                >
                  {htmlPreviewMode ? (
                    <Pencil size={14} className="text-amber-500" />
                  ) : (
                    <Eye size={14} className="text-blue-500" />
                  )}
                </Button>
              )}

              {isFeatureEnabled("ai") && (
                <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-violet-500/5 px-1 py-0.5 dark:bg-violet-500/10">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    onClick={handleAITitle}
                    disabled={
                      aiTitleLoading || !activeNote.contentText || effectiveLocked
                    }
                    title={t("editor.aiGenerateTitle")}
                  >
                    {aiTitleLoading ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-violet-500"
                      />
                    ) : (
                      <Type size={14} className="text-violet-500" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    onClick={handleAITags}
                    disabled={
                      aiTagsLoading || !activeNote.contentText || effectiveLocked
                    }
                    title={t("editor.aiSuggestTags")}
                  >
                    {aiTagsLoading ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-violet-500"
                      />
                    ) : (
                      <TagIcon size={14} className="text-violet-500" />
                    )}
                  </Button>
                </div>
              )}

              {state.editorFullscreen && (
                <Button
                  data-note-workspace-focus-exit=""
                  variant="ghost"
                  size="icon"
                  className="order-last h-7 w-7 shrink-0 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/15 hover:text-accent-primary"
                  onClick={exitEditorFullscreen}
                  title={t("workspaceLayout.exitFocus")}
                  aria-label={t("workspaceLayout.exitFocus")}
                >
                  <Minimize2 size={14} />
                </Button>
              )}

          {/* 编辑器模式切换（MD / Tiptap） */}
              {/*
            入口已对普通用户隐藏（见文件顶部 SHOW_EDITOR_MODE_TOGGLE 注释）。
            URL `?md=1|0` 仍然生效；toggleEditorMode 完整协议保留在下方。

            disabled 条件：
              - 仅 modeSwitching：正在切换中，避免重入。
            关于 collabSynced：
              早期版本曾在 `collabReady && !collabSynced` 时禁用按钮 + 显示"协同
              正在同步中"tooltip，但实测发现部分环境下 collabSynced 不可靠地停留在
              false（例如 realtime 未连通、provider 竟态、或服务端 y:sync 丢失），
              导致按钮永久灰灭、无法切回 RTE —— 这是比"误切丢字"更严重的体验问题。
              真正的保护放在入口 `toggleEditorMode` 开头（见上方 ① 入口）：
                if (collabReadyRef.current && !collabSyncedRef.current) {
                  toast.error(...); return;
                }
              按钮保持可点击，若 CRDT 仍未 sync 只弹 toast 不执行切换；sync 完成后
              再点即可顺利切换，永远不会陷入"按钮坏了"的死状态。
          */}
              {SHOW_EDITOR_MODE_TOGGLE &&
                activeNote.contentFormat !== "plaintext" && (
                  <button
                    onClick={toggleEditorMode}
                    disabled={modeSwitching}
                    title={
                      modeSwitching
                        ? t("editor.modeSwitch.switching")
                        : editorMode === "md"
                          ? t("editor.modeSwitch.toTiptap")
                          : t("editor.modeSwitch.toMd")
                    }
                    className={cn(
                      "flex items-center gap-1 h-7 px-1.5 rounded-md text-[10px] font-mono font-medium transition-colors border",
                      editorMode === "md"
                        ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30 hover:bg-accent-primary/15"
                        : "bg-app-hover text-tx-tertiary border-app-border hover:text-tx-secondary hover:bg-app-active",
                      modeSwitching && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <FileCode size={12} />
                    <span>{editorMode === "md" ? "MD" : "RTE"}</span>
                  </button>
                )}

              {!state.editorFullscreen && (
                <Button
                  data-editor-outline-toggle="desktop-toolbar"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-7 w-7 shrink-0",
                    showDesktopOutline &&
                      "bg-accent-primary/10 text-accent-primary",
                  )}
                  onClick={() => setShowOutline((open) => !open)}
                  title={
                    showDesktopOutline
                      ? t("editor.hideOutline")
                      : t("editor.showOutline")
                  }
                  aria-label={
                    showDesktopOutline
                      ? t("editor.hideOutline")
                      : t("editor.showOutline")
                  }
                  aria-pressed={showDesktopOutline}
                >
                  <ListTree size={14} />
                </Button>
              )}

              {(!userPrefs.enableNoteTabs ||
                state.openNoteTabs.length === 0 ||
                state.editorSplit) && (
                <EditorToolbarExpandSlot location="header" />
              )}
              <div
                data-editor-more-menu="desktop"
                className="relative shrink-0"
                ref={desktopMoreMenuRef}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowDesktopMoreMenu((open) => !open)}
                  title={t("tiptap.moreMenu") || "更多"}
                  aria-label={t("tiptap.moreMenu") || "更多"}
                >
                  <MoreHorizontal size={14} />
                </Button>
                <AnimatePresence>
                  {showDesktopMoreMenu && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute right-0 top-full z-50 mt-1 w-72 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-app-border bg-app-elevated py-1 shadow-xl"
                      style={{
                        maxHeight: `calc(${noteMenuViewport.height}px - 6rem - env(safe-area-inset-bottom, 0px))`,
                      }}
                    >
                      <div className="px-3 py-2 border-b border-app-border">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-tx-tertiary">
                          <span>
                            {activeNote.contentFormat === "plaintext"
                              ? t("note.format.plainText")
                              : activeNote.contentFormat === "markdown"
                                ? t("note.format.markdown")
                                : t("note.format.richText")}
                          </span>
                          {noteIsHtml && (
                            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-500">
                              HTML
                            </span>
                          )}
                        </div>
                        <div className="mt-1">
                          {isFeatureEnabled("collab") && (
                            <PresenceBar
                              users={presenceUsers}
                              isConnected={isConnected}
                            />
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setShowMoveDropdown(true);
                          setShowDesktopMoreMenu(false);
                        }}
                        disabled={isTrashed}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors disabled:opacity-40"
                      >
                        <FolderInput size={15} className="text-tx-tertiary" />
                        <span>{t("editor.moveToNotebook")}</span>
                      </button>
                      {!Capacitor.isNativePlatform() &&
                        activeNote.contentFormat !== "plaintext" && (
                          <button
                            onClick={beginEncryption}
                            disabled={
                              effectiveLocked ||
                              !canEditActiveNote ||
                              syncStatus === "saving"
                            }
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors disabled:opacity-40"
                          >
                            <Lock size={15} className="text-tx-tertiary" />
                            <span>{t("encryptedConversion.title")}</span>
                          </button>
                        )}
                      <button
                        onClick={() => {
                          setShowAttachmentsPanel(true);
                          setShowDesktopMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                      >
                        <Paperclip size={15} className="text-amber-500" />
                        <span>{t("editor.attachments")}</span>
                      </button>
                      <NoteThemeMenuSelect
                        noteId={activeNote.id}
                        disabled={!canWriteNote(activeNote)}
                      />
                      <CjkTypographyMenuActions
                        disabled={
                          !canEditActiveNote ||
                          effectiveLocked ||
                          isTrashed ||
                          modeSwitching ||
                          noteIsFullHtmlDoc
                        }
                        onAction={applyCjkTypography}
                      />
                      {canSplitDocument && onSplitDocument && (
                        <button
                          onClick={() => {
                            onSplitDocument();
                            setShowDesktopMoreMenu(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                        >
                          <Scissors size={15} className="text-accent-primary" />
                          <span>拆分文档</span>
                        </button>
                      )}

                      <div className="h-px bg-app-border mx-2 my-0.5" />
                      <button
                        onClick={() => {
                          setShowVersionHistory(true);
                          setShowDesktopMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                      >
                        <History size={15} className="text-violet-500" />
                        <span>{t("editor.versionHistory")}</span>
                      </button>
                      {isFeatureEnabled("sharing") && (
                      <button
                        onClick={() => {
                          setShowCommentPanel(true);
                          setShowDesktopMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                      >
                        <MessageCircle size={15} className="text-blue-500" />
                        <span>{t("editor.noteComments")}</span>
                      </button>
                      )}

                      <div className="h-px bg-app-border mx-2 my-0.5" />
                      <button
                        onClick={() => {
                          handlePrintNote();
                          setShowDesktopMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                      >
                        <Printer size={15} className="text-tx-tertiary" />
                        <span>{t("note.print")}</span>
                      </button>
                      <button
                        onClick={() => {
                          handleExportNoteImage("png");
                          setShowDesktopMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                      >
                        <Image size={15} className="text-tx-tertiary" />
                        <span>{t("note.exportAsPng")}</span>
                      </button>
                      <button
                        onClick={() => {
                          handleExportNoteImage("jpg");
                          setShowDesktopMoreMenu(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                      >
                        <Image size={15} className="text-tx-tertiary" />
                        <span>{t("note.exportAsJpg")}</span>
                      </button>

                      {noteIsHtml && (
                        <>
                          <div className="h-px bg-app-border mx-2 my-0.5" />
                          <button
                            onClick={async () => {
                              setShowDesktopMoreMenu(false);
                              await handleToggleHtmlPreviewMode();
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors"
                          >
                            {htmlPreviewMode ? (
                              <Pencil size={15} className="text-amber-500" />
                            ) : (
                              <Eye size={15} className="text-blue-500" />
                            )}
                            <span>
                              {htmlPreviewMode
                                ? t("editor.htmlPreview.switchToEdit")
                                : t("editor.htmlPreview.switchToPreview")}
                            </span>
                          </button>
                        </>
                      )}

                      <div className="h-px bg-app-border mx-2 my-0.5" />
                      {isFeatureEnabled("ai") && (
                      <button
                        onClick={() => {
                          handleAISummary();
                          setShowDesktopMoreMenu(false);
                        }}
                        disabled={
                          aiSummaryLoading ||
                          !activeNote.contentText ||
                          effectiveLocked
                        }
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors disabled:opacity-40"
                      >
                        {aiSummaryLoading ? (
                          <Loader2
                            size={15}
                            className="animate-spin text-violet-500"
                          />
                        ) : (
                          <Sparkles size={15} className="text-violet-500" />
                        )}
                        <span>{t("editor.aiSummary")}</span>
                      </button>
                      )}
                      {isFeatureEnabled("ai") && (
                      <button
                        onClick={() => {
                          handleAIMermaid("mermaid_mindmap");
                          setShowDesktopMoreMenu(false);
                        }}
                        disabled={
                          aiMermaidLoading ||
                          !activeNote.contentText ||
                          effectiveLocked
                        }
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-secondary hover:bg-app-hover transition-colors disabled:opacity-40"
                      >
                        {aiMermaidLoading ? (
                          <Loader2
                            size={15}
                            className="animate-spin text-violet-500"
                          />
                        ) : (
                          <Network size={15} className="text-violet-500" />
                        )}
                        <span>{t("editor.aiGenMindMap") || "AI 思维导图"}</span>
                      </button>
                      )}

                      <div className="h-px bg-app-border mx-2 my-0.5" />
                      <button
                        onClick={() => {
                          moveToTrash();
                          setShowDesktopMoreMenu(false);
                        }}
                        disabled={effectiveLocked}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40"
                      >
                        <Trash2 size={15} />
                        <span>{t("editor.trashTooltip")}</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {userPrefs.enableNoteTabs && !state.editorSplit && <NoteTabsBar />}

      {/* Editor (HTML 预览 / MD / Tiptap 按模式分派) + Outline */}
          <div className="flex-1 flex overflow-hidden">
            <div
              className="note-theme-surface flex-1 overflow-hidden relative"
              data-note-id={activeNote.id}
            >
          {/* Phase 2: 实时协作横幅（软锁 / 远程更新 / 远程删除）—— absolute 浮层，不占文档流，避免页面抖动 */}
              {false && pendingDraft ? (
                <div
                  className="absolute top-2 left-2 right-2 z-30 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 shadow-sm flex items-center justify-between gap-2"
                  role="alert"
                >
                  <div className="text-sm leading-snug">
                    {t("editor.draftFound") || "检测到未保存的修改"}
                    <span className="ml-2 opacity-70">
                      (
                      {new Date(
                        pendingDraft?.savedAt ?? Date.now(),
                      ).toLocaleString()}
                      )
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 px-2 text-xs"
                      onClick={handleRestoreDraft}
                    >
                      {t("editor.draftRestore") || "恢复"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={handleDiscardDraft}
                    >
                      {t("editor.draftDiscard") || "丢弃"}
                    </Button>
                  </div>
                </div>
              ) : null}
          {/* ErrorBoundary 包裹三种编辑器：切笔记为 key，崩溃后自动重置；
              底层还能打到 console 的 [EditorErrorBoundary] 日志与 window.__lastDirtyDoc */}
              <EditorErrorBoundary resetKey={activeNote.id}>
                {/* 文件夹同步的 PDF / DOCX 笔记默认直接显示原文件，并隐藏内部同步元数据。 */}
                {activeNote.contentFormat === "plaintext" ? (
                  <PlainTextEditor
                    key={`txt-${activeNote.id}`}
                    ref={editorHandleRef}
                    note={activeNote}
                    onUpdate={handleUpdate}
                    onLocalUpdate={handleLocalMirrorUpdate}
                    onHeadingsChange={setHeadings}
                    editable={
                      canEditActiveNote && !effectiveLocked && !modeSwitching
                    }
                  />
                ) : isFolderSyncAttachmentNote(activeNote.content) ? (
                  <FolderSyncAttachmentPreviewPane
                    key={`folder-sync-attachment-${activeNote.id}-${activeNote.version}`}
                    noteId={activeNote.id}
                    revision={activeNote.version}
                    content={activeNote.content}
                    onOpenAttachmentDirectory={() =>
                      setShowAttachmentsPanel(true)
                    }
                  />
                ) : activeNote.contentFormat === "markdown" ? (
                  <MarkdownEditor
                    // useYDoc only exposes the document after y:sync. Remount at that point so
                    // CodeMirror gains yCollab without disabling normal saves while unsynced.
                    key={
                      collabYDoc
                        ? `md-native-y-${activeNote.id}`
                        : `md-native-${activeNote.id}`
                    }
                    ref={editorHandleRef}
                    note={activeNote}
                    onUpdate={handleUpdate}
                    onLocalUpdate={handleLocalMirrorUpdate}
                    onTagsChange={handleTagsChange}
                    onHeadingsChange={setHeadings}
                    onEditorReady={handleEditorReady}
                    editable={
                      canEditActiveNote && !effectiveLocked && !modeSwitching
                    }
                    yDoc={collabYDoc}
                    awareness={collabProvider?.awareness ?? null}
                  />
                ) : shouldRenderHtmlPreview ? (
                  <HtmlPreviewPane
                    key={`html-${activeNote.id}`}
                    ref={editorHandleRef}
                    note={activeNote}
                    onUpdate={handleUpdate}
                    onLocalUpdate={handleLocalMirrorUpdate}
                    onTagsChange={handleTagsChange}
                    onHeadingsChange={setHeadings}
                    onEditorReady={handleEditorReady}
                    editable={false}
                  />
                ) : editorMode === "md" ? (
                  <MarkdownEditor
              // Phase 3: key 绑定 CRDT 启用态，切换 provider 时强制重建编辑器，
              // 避免 yCollab 扩展在运行时更换 yText 带来的状态错乱
                    key={
                      collabYDoc
                        ? `md-y-${activeNote.id}`
                        : `md-${activeNote.id}`
                    }
                    ref={editorHandleRef}
                    note={activeNote}
                    onUpdate={handleUpdate}
                    onTagsChange={handleTagsChange}
                    onHeadingsChange={setHeadings}
                    onEditorReady={handleEditorReady}
              // UX3：模式切换期间冻结编辑（避免用户在 mount→unmount 间隔里敲字，
              // 这段输入进不了任一编辑器的数据流，属于"黑洞输入"）。
                    editable={
                      canEditActiveNote && !effectiveLocked && !modeSwitching
                    }
                    yDoc={collabYDoc}
                    awareness={collabProvider?.awareness ?? null}
                  />
                ) : (
                  <PhaseAPerfProfiler>
                    <TiptapEditor
                      ref={editorHandleRef}
                      note={activeNote}
                      onUpdate={handleEditorUpdate}
                      onTagsChange={handleEditorTagsChange}
                      onHeadingsChange={setHeadings}
                      onEditorReady={handleEditorReady}
                      onOpenNote={handleEditorOpenNote}
                      editable={
                        canEditActiveNote && !effectiveLocked && !modeSwitching
                      }
                      searchQuery={state.searchQuery}
                    />
                  </PhaseAPerfProfiler>
                )}
              </EditorErrorBoundary>
              <NoteReadingPositionBridge
                noteId={activeNote.id}
                userId={selfUser?.userId || "local"}
                mode={
                  activeNote.contentFormat === "markdown" ||
                  (!shouldRenderHtmlPreview && editorMode === "md")
                    ? "markdown"
                    : shouldRenderHtmlPreview
                      ? "html"
                      : "richtext"
                }
                paused={noteLoading || modeSwitching}
              />
              {/*
            UX1/UX2：编辑器切换中 overlay。
            - 盖在当前编辑器上方，阻挡误点击 / 视觉提示"切换中"；
            - AnimatePresence 让进出过渡平滑，避免"咔"一下；
            - pointer-events-auto 既拦截点击也防止 Tiptap/CM6 的选区被破坏。
          */}
              <AnimatePresence>
                {modeSwitching && (
                  <motion.div
                    key="editor-mode-switching-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="absolute inset-0 z-20 flex items-center justify-center bg-app-bg/60 backdrop-blur-sm pointer-events-auto"
                  >
                    <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-app-elevated border border-app-border shadow-sm text-sm text-tx-secondary">
                      <Loader2
                        size={14}
                        className="animate-spin text-accent-primary"
                      />
                      <span>{t("editor.modeSwitch.switchingLabel")}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
      {/* 分享弹窗 */}
            {showShareModal && isFeatureEnabled("sharing") && (
              <ShareModal
                noteId={activeNote.id}
                noteTitle={activeNote.title}
                onClose={() => setShowShareModal(false)}
              />
            )}

      {/* 版本历史 */}
            {showVersionHistory && (
              <VersionHistoryPanel
                noteId={activeNote.id}
                noteTitle={activeNote.title}
                onRestore={(updated) => {
                  try {
                    editorHandleRef.current?.discardPending?.();
                  } catch {
                    /* ignore */
                  }
                  try {
                    clearDraft(updated.id);
                  } catch {
                    /* ignore */
                  }
                  skipNextSwitchFlushForNoteIdRef.current = updated.id;
                  actions.setActiveNote(updated);
                  actions.updateNoteInList({
                    id: updated.id,
                    title: updated.title,
                    contentText: updated.contentText,
                    updatedAt: updated.updatedAt,
                    version: updated.version,
                    isPinned: updated.isPinned,
                    isTrashed: updated.isTrashed,
                    notebookId: updated.notebookId,
                    workspaceId: updated.workspaceId,
                  });
                  actions.updateNoteTab({
                    id: updated.id,
                    title: updated.title,
                    notebookId: updated.notebookId,
                    workspaceId: updated.workspaceId,
                    contentFormat: updated.contentFormat,
                    isLocked: updated.isLocked,
                    isTrashed: updated.isTrashed,
                    updatedAt: updated.updatedAt,
                  });
                  actions.setSyncStatus("saved");
                  actions.setLastSynced(new Date().toISOString());
                }}
                onClose={() => setShowVersionHistory(false)}
              />
            )}

      {/* 评论面板 */}
            {showCommentPanel && isFeatureEnabled("sharing") && (
              <CommentPanel
                noteId={activeNote.id}
                noteTitle={activeNote.title}
                onClose={() => setShowCommentPanel(false)}
              />
            )}

            {/* 反向链接 BACKLINKS-02 */}
            {showBacklinksPanel && (
              <BacklinksPanel
                noteId={activeNote.id}
                noteTitle={activeNote.title}
                onClose={() => setShowBacklinksPanel(false)}
              />
            )}

      {/* 附件目录面板 */}
            {showAttachmentsPanel && (
              <NoteAttachmentsPanel
                noteId={activeNote.id}
                noteTitle={activeNote.title}
                onClose={() => setShowAttachmentsPanel(false)}
              />
            )}

      {/* Delete 键删除确认弹窗 */}
            <AnimatePresence>
              {showDeleteConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-app-surface border border-app-border rounded-xl shadow-2xl p-6 max-w-sm mx-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                        <Trash2 size={18} className="text-red-500" />
                      </div>
                      <h3 className="text-base font-semibold text-tx-primary">
                        {t("sidebar.deleteNoteTitle")}
                      </h3>
                    </div>
                    <p className="text-sm text-tx-secondary mb-5">
                      {t("sidebar.deleteNoteConfirm")}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-4 py-2 text-sm rounded-lg bg-app-hover text-tx-secondary hover:bg-app-active transition-colors"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          moveToTrash();
                        }}
                        className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                      >
                        {t("sidebar.confirmDeleteNote")}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* AI 总结弹窗 */}
            <AnimatePresence>
              {showSummaryDialog && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                  onClick={() => {
                    if (!aiSummaryLoading) setShowSummaryDialog(false);
                  }}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
                  >
                    {/* 标题栏 */}
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-app-border">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-violet-500" />
                        <h3 className="text-sm font-semibold text-tx-primary">
                          {t("editor.aiSummaryTitle") || "单篇笔记总结"}
                        </h3>
                      </div>
                      <button
                        onClick={() => {
                          if (!aiSummaryLoading) setShowSummaryDialog(false);
                        }}
                        className="p-1 rounded hover:bg-app-hover text-tx-secondary transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {/* 内容区 */}
                    <div className="flex-1 overflow-y-auto px-5 py-4">
                      {aiSummaryLoading ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-3">
                          <Loader2
                            size={24}
                            className="animate-spin text-violet-500"
                          />
                          <span className="text-sm text-tx-secondary">
                            {t("editor.aiSummaryGenerating") ||
                              "正在生成总结..."}
                          </span>
                        </div>
                      ) : (
                        <div className="text-sm text-tx-primary whitespace-pre-wrap leading-relaxed">
                          {aiSummaryResult}
                        </div>
                      )}
                    </div>
                    {/* 底部操作栏 */}
                    {!aiSummaryLoading && aiSummaryResult && (
                      <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-app-border">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSummaryCopy}
                          >
                            {t("editor.aiSummaryCopy") || "复制"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSummaryAppend}
                          >
                            {t("editor.aiSummaryAppend") || "追加到文末"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAISummary}
                          >
                            {t("editor.aiSummaryRegenerate") || "重新生成"}
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowSummaryDialog(false)}
                        >
                          {t("editor.aiSummaryClose") || "关闭"}
                        </Button>
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* AI Mermaid 预览弹窗 */}
            <MindMapEmbedInsertDialog
              open={
                showMindMapInsertDialog &&
                !!activeNote &&
                !effectiveLocked &&
                !isTrashed &&
                !noteIsFullHtmlDoc &&
                canEditActiveNote
              }
              workspaceId={activeNote?.workspaceId ?? null}
              onClose={() => setShowMindMapInsertDialog(false)}
              onInsert={(id) => {
                if (
                  !activeNote ||
                  activeNoteRef.current?.id !== activeNote.id ||
                  effectiveLocked ||
                  isTrashed ||
                  noteIsFullHtmlDoc ||
                  !canEditActiveNote
                )
                  return false;
                const markdown = `\n\n![[mindmap:${id}]]\n\n`;
                const editorHandle = editorHandleRef.current;
                const insertedAtCursor =
                  editorHandle?.insertMarkdownAtCursor?.(markdown) === true;
                const inserted =
                  insertedAtCursor ||
                  editorHandle?.appendMarkdown?.(markdown) === true;
                if (inserted) {
                  editorHandle?.flushSave?.();
                  toast.success("已插入思维导图");
                }
                return inserted;
              }}
            />
            <AnimatePresence>
              {showMermaidDialog && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                  onClick={() => {
                    if (!aiMermaidLoading) setShowMermaidDialog(false);
                  }}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
                  >
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-app-border">
                      <div className="flex items-center gap-2">
                        <Network size={16} className="text-violet-500" />
                        <h3 className="text-sm font-semibold text-tx-primary">
                          {aiMermaidType === "mermaid_mindmap"
                            ? "AI 思维导图"
                            : "AI 流程图"}
                        </h3>
                      </div>
                      <button
                        onClick={() => {
                          if (!aiMermaidLoading) setShowMermaidDialog(false);
                        }}
                        className="p-1 rounded hover:bg-app-hover text-tx-secondary transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4">
                      {aiMermaidLoading ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-3">
                          <Loader2
                            size={24}
                            className="animate-spin text-violet-500"
                          />
                          <span className="text-sm text-tx-secondary">
                            正在生成...
                          </span>
                        </div>
                      ) : aiMermaidResult ? (
                        <div className="rounded-lg border border-app-border overflow-hidden">
                          <MermaidView
                            source={aiMermaidResult}
                            debounceMs={0}
                          />
                        </div>
                      ) : null}
                    </div>
                    {!aiMermaidLoading && aiMermaidResult && (
                      <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-app-border">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(aiMermaidResult);
                              toast.success("已复制");
                            }}
                          >
                            复制源码
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleMermaidInsert}
                          >
                            插入笔记
                          </Button>
                          {aiMermaidType === "mermaid_mindmap" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleMermaidSaveAsMindMap}
                              disabled={mermaidSavingMindMap}
                            >
                              {mermaidSavingMindMap
                                ? "保存中..."
                                : "保存为思维导图"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAIMermaid(aiMermaidType)}
                          >
                            重新生成
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowMermaidDialog(false)}
                        >
                          关闭
                        </Button>
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
      {/* HTML 预览 → 编辑模式切换确认弹窗 */}
            <AnimatePresence>
              {showHtmlEditWarning && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                  onClick={() => setShowHtmlEditWarning(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-app-surface border border-app-border rounded-xl shadow-2xl p-6 max-w-sm mx-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <Pencil size={18} className="text-amber-500" />
                      </div>
                      <h3 className="text-base font-semibold text-tx-primary">
                        {t("editor.htmlPreview.editWarningTitle")}
                      </h3>
                    </div>
                    <p className="text-sm text-tx-secondary mb-5">
                      {t("editor.htmlPreview.editWarningMessage")}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowHtmlEditWarning(false)}
                        className="px-4 py-2 text-sm rounded-lg bg-app-hover text-tx-secondary hover:bg-app-active transition-colors"
                      >
                        {t("editor.htmlPreview.editWarningCancel")}
                      </button>
                      <button
                        onClick={() => {
                          setShowHtmlEditWarning(false);
                          setHtmlPreviewMode(false);
                        }}
                        className="px-4 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                      >
                        {t("editor.htmlPreview.editWarningConfirm")}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {showDesktopOutline && (
              <OutlinePanel
                headings={headings}
                width={outlineWidth}
                onSelect={(pos) => scrollToRef.current?.(pos)}
                onClose={() => setShowOutline(false)}
                onResizeStart={handleOutlineResizeStart}
                onResetWidth={handleOutlineWidthReset}
              />
            )}
          </div>
        </motion.div>
      </>
    </EditorToolbarHost>
  );
}

/* ===== 大纲面板 ===== */
function OutlinePanel({
  headings,
  width,
  onSelect,
  onClose,
  onResizeStart,
  onResetWidth,
}: {
  headings: NoteEditorHeading[];
  width: number;
  onSelect: (pos: number) => void;
  onClose: () => void;
  onResizeStart: (event: React.MouseEvent) => void;
  onResetWidth: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="relative hidden md:flex flex-none flex-col border-l border-app-border bg-app-surface/50 transition-colors"
      style={{ width: `${width}px` }}
    >
      <div
        onMouseDown={onResizeStart}
        onDoubleClick={onResetWidth}
        className="absolute inset-y-0 left-0 z-10 flex w-1 -translate-x-1/2 cursor-col-resize items-center justify-center hover:bg-accent-primary/30 active:bg-accent-primary/50 transition-colors group"
        title="拖拽调整大纲宽度 / 双击恢复默认"
      >
        <div className="h-8 w-[2px] rounded-full bg-transparent group-hover:bg-accent-primary/60 transition-colors" />
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border">
        <div className="flex items-center gap-1.5 text-xs font-medium text-tx-secondary">
          <ListTree size={13} className="text-accent-primary" />
          <span>{t("editor.outline")}</span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-secondary transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {headings.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-[11px] text-tx-tertiary">
                {t("editor.noHeadings")}
              </p>
              <p className="text-[10px] text-tx-tertiary mt-1">
                {t("editor.noHeadingsHint")}
              </p>
            </div>
          ) : (
            headings.map((h) => (
              <button
                key={h.id}
                onClick={() => onSelect(h.pos)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-app-hover truncate",
                  h.level === 1 && "font-medium text-tx-primary",
                  h.level === 2 && "text-tx-secondary",
                  h.level === 3 && "text-tx-tertiary",
                )}
                style={{ paddingLeft: `${(h.level - 1) * 12 + 12}px` }}
                title={h.text}
              >
                <span
                  className={cn(
                    "inline-block w-1.5 h-1.5 rounded-full mr-2 shrink-0 align-middle",
                    h.level === 1 && "bg-accent-primary",
                    h.level === 2 && "bg-accent-primary/50",
                    h.level === 3 && "bg-tx-tertiary/50",
                  )}
                />
                {h.text || t("editor.untitled")}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/* ===== 笔记本树构建（与 Sidebar.tsx 的 buildTree 完全一致） ===== */
function buildTree(notebooks: Notebook[]): Notebook[] {
  const map = new Map<string, Notebook>();
  const roots: Notebook[] = [];
  notebooks.forEach((nb) => map.set(nb.id, { ...nb, children: [] }));
  notebooks.forEach((nb) => {
    const node = map.get(nb.id)!;
    if (nb.parentId && map.has(nb.parentId)) {
      map.get(nb.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  // 按 sortOrder 稳定排序，确保拖拽后的新顺序立即反映到 UI
  const byOrder = (a: Notebook, b: Notebook) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const sortRecursive = (list: Notebook[]) => {
    list.sort(byOrder);
    list.forEach((n) => {
      if (n.children && n.children.length > 0) sortRecursive(n.children);
    });
  };
  sortRecursive(roots);
  return roots;
}

/* 从根到指定 id 的完整路径（含自身），用于面包屑展示 */
function findPathById(
  notebooks: Notebook[],
  id: string | null | undefined,
): Notebook[] {
  if (!id) return [];
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  const path: Notebook[] = [];
  let cursor: string | null | undefined = id;
  const visited = new Set<string>();
  while (cursor) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const nb = byId.get(cursor);
    if (!nb) break;
    path.unshift(nb);
    cursor = nb.parentId ?? null;
  }
  return path;
}

function getNotebookIcon(icon?: string | null): string {
  const value = (icon ?? "").trim();
  if (!value || value === "??" || value.includes("\uFFFD")) return "📒";
  return value;
}

/* ===== 编辑器顶部"移动笔记本"树形条目（与侧边栏目录结构保持一致） ===== */
function MoveTreeItem({
  notebook,
  depth,
  currentId,
  onSelect,
}: {
  notebook: Notebook;
  depth: number;
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const hasChildren = !!notebook.children && notebook.children.length > 0;
  // 默认展开：若自身或子孙中包含当前笔记，则展开；否则折叠
  const containsCurrent = useMemo(() => {
    const stack: Notebook[] = [notebook];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === currentId) return true;
      if (n.children) stack.push(...n.children);
    }
    return false;
  }, [notebook, currentId]);
  const [expanded, setExpanded] = useState(containsCurrent || depth === 0);
  const isCurrent = notebook.id === currentId;
  const { t } = useTranslation();

  return (
    <div>
      <button
        disabled={isCurrent}
        onClick={() => !isCurrent && onSelect(notebook.id)}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors",
          isCurrent
            ? "opacity-40 cursor-not-allowed text-tx-tertiary"
            : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer hover:text-tx-primary"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <span className="text-base shrink-0">
          {getNotebookIcon(notebook.icon)}
        </span>
        <span className="truncate flex-1 text-left">{notebook.name}</span>
        {isCurrent && (
          <span className="ml-auto text-[10px] text-tx-tertiary shrink-0">
            {t("common.current")}
          </span>
        )}
      </button>
      {hasChildren &&
        expanded &&
        notebook.children!.map((child) => (
          <MoveTreeItem
            key={child.id}
            notebook={child}
            depth={depth + 1}
            currentId={currentId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

/* ===== 同步状态指示器 ===== */
function SyncIndicator({
  syncStatus,
  lastSyncedAt,
  onManualSync,
}: {
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  onManualSync: () => void;
}) {
  const { t } = useTranslation();
  const android = isAndroidNativeRuntime();
  // 失败、排队和离线状态继续保留在同步状态机中，但不再主动展示为失败提示。
  // 手动同步入口仍保持可见，真正冲突继续走独立的冲突处理流程。
  const displayStatus: SyncStatus =
    syncStatus === "error" ||
    syncStatus === "queued" ||
    syncStatus === "offline"
      ? "idle"
      : syncStatus;
  const formatFullTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const getTooltip = () => {
    switch (displayStatus) {
      case "saving":
        return t("editor.saving");
      case "saved":
        return lastSyncedAt
          ? `${t("editor.allSaved")}：${formatFullTime(lastSyncedAt)}`
          : t("editor.allSaved");
      default:
        if (lastSyncedAt) {
          const diff = Date.now() - new Date(lastSyncedAt).getTime();
          if (diff < 10_000) return t("editor.justSaved");
          if (diff < 60_000)
            return t("editor.savedSecondsAgo", {
              count: Math.floor(diff / 1000),
            });
          if (diff < 3600_000)
            return t("editor.savedMinutesAgo", {
              count: Math.floor(diff / 60_000),
            });
          return t("editor.savedHoursAgo", {
            count: Math.floor(diff / 3600_000),
          });
        }
        return t("editor.clickToSync");
    }
  };

  return (
    <button
      onClick={onManualSync}
      disabled={syncStatus === "saving" || syncStatus === "offline"}
      title={getTooltip()}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 py-1 rounded-md text-[11px] transition-colors hover:bg-app-hover group"
    >
      <AnimatePresence mode="wait">
        {displayStatus === "saving" && (
          <motion.div
            key="saving"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, rotate: 360 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{
              rotate: { repeat: Infinity, duration: 1, ease: "linear" },
              opacity: { duration: 0.15 },
            }}
          >
            <RefreshCw size={13} className="text-accent-primary" />
          </motion.div>
        )}
        {displayStatus === "saved" && (
          <motion.div
            key="saved"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: [1.3, 1] }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.25 }}
          >
            <Check size={13} className="text-green-500" />
          </motion.div>
        )}
        {displayStatus === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Cloud
              size={13}
              className="text-tx-tertiary group-hover:text-tx-secondary transition-colors"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <span
        className={cn(
          android
            ? "whitespace-nowrap transition-colors"
            : "hidden whitespace-nowrap sm:inline transition-colors",
          displayStatus === "saving" && "text-accent-primary",
          displayStatus === "saved" && "text-green-500",
          displayStatus === "idle" &&
            "text-tx-tertiary group-hover:text-tx-secondary",
        )}
      >
        {displayStatus === "saving" && t("editor.savingStatus")}
        {displayStatus === "saved" && (
          <>
            {android ? "已保存到本机" : t("editor.savedStatus")}
            {!android && lastSyncedAt && (
              <span className="ml-1 opacity-70">
                · {new Date(lastSyncedAt).toLocaleTimeString()}
              </span>
            )}
          </>
        )}
        {displayStatus === "idle" &&
          (lastSyncedAt ? (
            <>
              {t("editor.synced")}
              <span className="ml-1 opacity-70">
                · {new Date(lastSyncedAt).toLocaleTimeString()}
              </span>
            </>
          ) : (
            t("editor.sync")
          ))}
      </span>
    </button>
  );
}
