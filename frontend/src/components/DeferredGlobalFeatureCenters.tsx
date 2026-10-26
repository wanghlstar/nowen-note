import React from "react";

import { isFeatureEnabled } from "@/lib/featureRegistry";
import AIProfileSwitcherBridge from "./AIProfileSwitcherBridge";
import EmbeddingIndexTaskCopyBridge from "./EmbeddingIndexTaskCopyBridge";
import MarkdownExperienceBridge from "./MarkdownExperienceBridge";
import MindMapAppearanceBridge from "./MindMapAppearanceBridge";
import TaskDataTransferBridgeV2 from "./TaskDataTransferBridgeV2";
import SystemFullDataTransferBridge from "./SystemFullDataTransferBridge";
import BackupWebDavBridge from "./BackupWebDavBridge";
import NoteImageExportCenter from "./NoteImageExportCenter";
import DocxImportCenter from "./DocxImportCenter";
import PublicSpaceLauncher from "./PublicSpaceLauncher";
import NoteTransferCenter from "./NoteTransferCenter";
import RoundTripImportBatchCenter from "./RoundTripImportBatchCenter";
import RoundTripPermissionMappingCenter from "./RoundTripPermissionMappingCenter";
import RoundTripPermissionExportCenter from "./RoundTripPermissionExportCenter";
import SiyuanImportProgressBridge from "./SiyuanImportProgressBridge";

/**
 * Low-frequency authenticated feature centers.
 *
 * These components mostly subscribe to explicit import/export/transfer events or reconcile editor
 * DOM after it mounts. Keeping them in one asynchronous boundary prevents AI profile management,
 * CodeMirror integration, JSZip, image export, migration, mind-map and backup UI dependencies from
 * joining the login chunk.
 *
 * P1 centers are gated by the feature registry (Lite profile): disabled modules mount nothing.
 * Mapping: AIProfileSwitcher/EmbeddingIndexTaskCopy → ai; MindMapAppearance → mindmap;
 * TaskDataTransferV2 → tasks; DocxImport/Siyuan/RoundTrip 系列/NoteTransfer/SystemFullData
 * → importCenter; PublicSpaceLauncher → sharing. MarkdownExperience/BackupWebDav/NoteImageExport
 * are P0.
 */
export default function DeferredGlobalFeatureCenters() {
  return (
    <>
      {isFeatureEnabled("ai") && <AIProfileSwitcherBridge />}
      {isFeatureEnabled("ai") && <EmbeddingIndexTaskCopyBridge />}
      <MarkdownExperienceBridge />
      {isFeatureEnabled("mindmap") && <MindMapAppearanceBridge />}
      {isFeatureEnabled("tasks") && <TaskDataTransferBridgeV2 />}
      {isFeatureEnabled("importCenter") && <SystemFullDataTransferBridge />}
      <BackupWebDavBridge />
      <NoteImageExportCenter />
      {isFeatureEnabled("importCenter") && <DocxImportCenter />}
      {isFeatureEnabled("sharing") && <PublicSpaceLauncher />}
      {isFeatureEnabled("importCenter") && <NoteTransferCenter />}
      {isFeatureEnabled("importCenter") && <RoundTripImportBatchCenter />}
      {isFeatureEnabled("importCenter") && <RoundTripPermissionMappingCenter />}
      {isFeatureEnabled("importCenter") && <RoundTripPermissionExportCenter />}
      {isFeatureEnabled("importCenter") && <SiyuanImportProgressBridge />}
    </>
  );
}
