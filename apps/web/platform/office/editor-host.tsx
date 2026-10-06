"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ComponentType } from "react";
import type { Document } from "@uniwork/core/types/document";
import { detectDesktopPlatform, DESKTOP_PLATFORMS, type DesktopPlatformHints, type OfficeInstallerOption, type OfficeCapabilityEntry, type OfficeHost, type SaveCoordinatorState, type StableSnapshot } from "@uniwork/core/office";
import { registerLeaveGuard } from "@uniwork/views/navigation";
import { DesktopOpenAction, OfficeShell, OfficeTooLargeProvider, type OfficeChannel } from "@uniwork/views/office";
import { useOfficeFormatName } from "@uniwork/views/office/editor-slot";
import { DraftRecoveryPrompt, LeaveDialog } from "@uniwork/views/office/leave-dialog";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { createOfficeEditorSession, type OfficeEditorSession, type OfficeRecoveryState } from "./editor-host-core";
import { downloadOfficeDesktopBundle, getOfficeDesktopDownload } from "@uniwork/core/api/endpoints/office-desktop";
import { downloadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import { listDocumentVersions } from "@uniwork/core/api/endpoints/documents-versions";
import { launchOfficeDeepLink } from "./desktop-handoff";
export * from "./editor-host-core";

export interface OfficeEditorHostProps<TSnapshot = unknown> {
  document: Document;
  wsId: string;
  readonly: boolean;
  /**
   * The 0Xb format seam. A format adapter owns the engine-backed EditorHandle,
   * the real save transport, and the editor view; this host then composes them
   * with the shared coordinator and protected browser draft lifecycle.
   */
  formatAdapter?: OfficeFormatAdapter<TSnapshot>;
  session?: OfficeEditorSession<TSnapshot>;
  editorView?: ReactNode;
  host?: OfficeHost;
  capability?: OfficeCapabilityEntry;
  /** Applies a recovered snapshot to the format editor model. */
  onRecoverSnapshot?: (snapshot: StableSnapshot<TSnapshot>) => Promise<void> | void;
  breadcrumbs?: { label: ReactNode; href?: string }[];
  className?: string;
  officeChannel?: OfficeChannel;
  installers?: OfficeInstallerOption[];
  officeDeploymentId?: string;
}

export interface OfficeFormatAdapter<TSnapshot = unknown> {
  session: OfficeEditorSession<TSnapshot>;
  editorView: ReactNode;
  capability: OfficeCapabilityEntry;
  onRecoverSnapshot?: (snapshot: StableSnapshot<TSnapshot>) => Promise<void> | void;
  /** Optional renderer readiness; existing format adapters keep their behavior. */
  viewReadiness?: { getSnapshot(): boolean; subscribe(listener: () => void): () => void };
}

const assumeViewReady = () => true;
const subscribeUnboundView = () => () => undefined;

function stateIsDirty(state: SaveCoordinatorState): boolean {
  return state.dirtyGeneration > state.lastSavedGeneration || state.state === "dirty" || state.state === "saving" || state.state === "error" || state.state === "conflict";
}

/**
 * The engine format a document routes to, or `"unknown"` when nothing about
 * its file identifies one. Routing is never by elimination: the router turns
 * `unknown` - and the formats no web host can open (pptx, pdf, xls, odt) -
 * into the typed unsupported state instead of guessing a host for a different
 * format. The server detects the Q7 conversion sources too
 * (server/internal/service/document_office_capability.go) and never edits them
 * in place, so a web host must not open an `.xls`/`.odt` as something else.
 */
export function detectDocumentFormat(document: Document): OfficeCapabilityEntry["format"] | "unknown" {
  const filename = document.file?.filename.toLowerCase() ?? "";
  const mime = document.file?.mime_type.toLowerCase() ?? "";
  if (mime.includes("wordprocessingml.document") || filename.endsWith(".docx")) return "docx";
  if (mime.includes("spreadsheetml.sheet") || filename.endsWith(".xlsx")) return "xlsx";
  if (mime.includes("presentationml.presentation") || filename.endsWith(".pptx")) return "pptx";
  if (mime === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (mime === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) return "md";
  if (mime === "text/html" || filename.endsWith(".html") || filename.endsWith(".htm")) return "html";
  if (mime === "application/vnd.ms-excel" || filename.endsWith(".xls")) return "xls";
  if (mime === "application/vnd.oasis.opendocument.text" || filename.endsWith(".odt")) return "odt";
  return "unknown";
}

/** The capability-hint default for the coordinator when no adapter is bound.
 *  Routing never uses this: `detectDocumentFormat` decides the host, so an
 *  unrecognised file reaches the typed unsupported state, not DocxHost. */
export function documentFormat(document: Document): OfficeCapabilityEntry["format"] {
  const detected = detectDocumentFormat(document);
  return detected === "unknown" ? "docx" : detected;
}

/** The platform-owned browser host. Consumers inject the engine/editor handle;
 * the host owns lifecycle, durable checkpoints, recovery, and navigation. */
export function OfficeEditorHost<TSnapshot = unknown>({
  document,
  readonly,
  formatAdapter,
  session,
  editorView,
  capability,
  onRecoverSnapshot,
  breadcrumbs = [],
  className,
  officeChannel = "stable",
  installers,
  officeDeploymentId,
}: OfficeEditorHostProps<TSnapshot>) {
  const { t } = useTranslation();
  const formatName = useOfficeFormatName();
  const activeSession = formatAdapter?.session ?? session;
  const activeEditorView = formatAdapter?.editorView ?? editorView;
  const activeCapability = formatAdapter?.capability ?? capability;
  const activeRecoverSnapshot = formatAdapter?.onRecoverSnapshot ?? onRecoverSnapshot;
  const viewReady = useSyncExternalStore(formatAdapter?.viewReadiness?.subscribe ?? subscribeUnboundView, formatAdapter?.viewReadiness?.getSnapshot ?? assumeViewReady, assumeViewReady);
  const [coordinatorState, setCoordinatorState] = useState<SaveCoordinatorState | null>(() => activeSession?.coordinator.getState() ?? null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [recovery, setRecovery] = useState<OfficeRecoveryState<TSnapshot> | null>(null);
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null);
  const checkpointGeneration = useRef(0);
  const checkpointPending = useRef(0);
  const recoveryRef = useRef(activeSession);
  recoveryRef.current = activeSession;
  // Bumped on every transition to `saved`. A recovery read that started before
  // the bump describes a draft the Save already consumed, so its result is
  // dropped however the coordinator state reads by the time it resolves (the
  // 2s checkpoint timer can flip `saved` back to `dirty` in between, which is
  // why a plain `state === "saved"` check missed the note/page-ops flows).
  const saveEpoch = useRef(0);
  const effectiveCapability = useMemo<OfficeCapabilityEntry>(() => activeCapability ?? ({
    format: documentFormat(document),
    operation: "open",
    host: "web",
    engineBuild: "unknown",
    contractRevision: "unknown",
    status: "unknown",
    reason: t("office.editor.capability_hint"),
    fidelityWarnings: [],
  }), [activeCapability, document, t]);

  useEffect(() => {
    activeSession?.coordinator.setCapability(effectiveCapability);
  }, [activeSession, effectiveCapability]);

  useEffect(() => {
    if (!activeSession) {
      setCoordinatorState(null);
      return;
    }
    setCoordinatorState(activeSession.coordinator.getState());
    // Bump the save epoch synchronously on the publish that reports `saved`,
    // not in a post-commit effect: a recovery read resolving in the same
    // microtask batch as the save must still see the bumped epoch.
    return activeSession.coordinator.subscribe((next) => {
      if (next.state === "saved") saveEpoch.current += 1;
      setCoordinatorState(next);
    });
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession) {
      setRecovery(null);
      return;
    }
    let active = true;
    setRecovery(null);
    const epochAtRead = saveEpoch.current;
    void activeSession.recoverDraft().then((result) => {
      if (!active) return;
      // A Save that landed while recovery was reading has already discarded the
      // durable draft; showing the offer now would resurrect a record the
      // coordinator deleted. The dialog follows the store, not this late read.
      if (result.status !== "missing" && saveEpoch.current !== epochAtRead) return;
      setRecovery(result.status === "missing" ? null : result);
    });
    return () => { active = false; };
  }, [activeSession]);

  // Save success is the only event that removes the durable draft underneath an
  // open recovery prompt (the coordinator discards it in the same settle). Once
  // the coordinator reports `saved`, the offer it was showing no longer exists,
  // so the "Draft found" dialog closes instead of lingering as a stale prompt.
  useEffect(() => {
    if (coordinatorState?.state !== "saved") return;
    setRecovery(null);
  }, [coordinatorState?.state]);

  const dirty = Boolean(coordinatorState && stateIsDirty(coordinatorState));
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!activeSession || readonly) return;
    const timer = window.setInterval(() => {
      const generation = activeSession.editor.getDirtyGeneration();
      if (generation <= checkpointGeneration.current || generation <= checkpointPending.current) return;
      checkpointPending.current = generation;
      activeSession.coordinator.markDirty(generation);
      void activeSession.checkpoint().then(() => {
        checkpointGeneration.current = Math.max(checkpointGeneration.current, generation);
      }).catch(() => undefined).finally(() => {
        if (checkpointPending.current === generation) checkpointPending.current = 0;
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeSession, readonly]);

  useEffect(() => {
    if (!dirty) return;
    return registerLeaveGuard(() => new Promise<boolean>((resolve) => {
      leaveResolver.current?.(false);
      leaveResolver.current = resolve;
      setLeaveOpen(true);
    }));
  }, [dirty]);

  // React dev (StrictMode) replays mount -> cleanup -> mount on the SAME
  // session. Disposing synchronously would hand the replayed mount a dead
  // editor (xlsx_editor_disposed); the replay re-arms this flag before the
  // microtask runs, so only a real unmount releases the session.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const closing = recoveryRef.current;
      queueMicrotask(() => {
        if (!mountedRef.current) void closing?.dispose();
      });
    };
  }, []);

  const finishLeave = (allowed: boolean) => {
    leaveResolver.current?.(allowed);
    leaveResolver.current = null;
    setLeaveOpen(false);
  };
  const saveAndLeave = async () => {
    if (!activeSession) return false;
    const result = await activeSession.coordinator.save("dialog");
    return Boolean(result.accepted) && !stateIsDirty(activeSession.coordinator.getState());
  };
  const keepDraftAndLeave = async () => {
    if (!activeSession) return false;
    try {
      await activeSession.checkpoint();
      return true;
    } catch {
      return false;
    }
  };
  const discardAndLeave = async () => {
    if (!activeSession) return true;
    try {
      await activeSession.discardDraft();
      return true;
    } catch {
      return false;
    }
  };
  const recoverDraft = async () => {
    if (!activeSession || recovery?.status !== "recovered" || !activeRecoverSnapshot) return false;
    await activeRecoverSnapshot(recovery.snapshot);
    return true;
  };

  // The header split button and the inline too-large notice are two mounts of
  // the same launch-ticket action, so both get one prop set.
  const renderDesktopAction = (placement: "header" | "inline") => activeSession && !readonly ? (
    <DesktopOpenAction
      placement={placement}
      documentId={document.id}
      deploymentId={officeDeploymentId}
      savedVersion={document.current_version}
      dirty={dirty}
      saveCoordinator={activeSession.coordinator}
      versionAfterSave={async (outcome) => {
        const versionId = outcome.receipt?.versionId;
        if (!versionId) return null;
        try {
          const page = await listDocumentVersions(document.id, { limit: 100 });
          const committed = page.versions.find((version) => version.id === versionId);
          return committed?.version ?? null;
        } catch {
          return null;
        }
      }}
      channel={officeChannel}
      installers={installers}
      loadInstallers={async () => {
        const profile = await getOfficeDesktopDownload(document.organization_id, officeChannel);
        return { installers: profile?.installers ?? [], supportedPlatforms: profile?.supported_platforms ?? DESKTOP_PLATFORMS };
      }}
      loadPlatformHint={async () => {
        const data = (navigator as Navigator & { userAgentData?: DesktopPlatformHints["userAgentData"] & { getHighEntropyValues?: (keys: string[]) => Promise<{ architecture?: string; bitness?: string }> } }).userAgentData;
        let entropy: { architecture?: string; bitness?: string } = {};
        try { entropy = await data?.getHighEntropyValues?.(["architecture", "bitness"]) ?? {}; } catch { /* Reduced UA remains a safe uncertain hint. */ }
        return detectDesktopPlatform({ userAgent: navigator.userAgent, userAgentData: data ? { platform: data.platform, mobile: data.mobile, ...entropy } : undefined });
      }}
      downloadInstaller={async (platform) => {
        const blob = await downloadOfficeDesktopBundle(document.organization_id, officeChannel, platform);
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement("a");
        link.href = url; link.download = "UniWork-Office.zip";
        window.document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
      launch={launchOfficeDeepLink}
    />
  ) : null;
  const downloadDocument = async () => {
    const blob = await downloadDocumentFile(document.id);
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url; link.download = document.file?.filename ?? document.title;
    window.document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tooLarge = { desktopAction: renderDesktopAction("inline"), onDownload: downloadDocument };

  return (
    <OfficeTooLargeProvider value={tooLarge}>
<div
      className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}
      data-office-editor-host
      data-office-format={document.file?.mime_type ?? "unknown"}
    >
      <OfficeShell
        title={document.title}
        breadcrumbs={breadcrumbs}
        // The document page owns the one header; the shell's save + desktop
        // cluster renders there through the page's header-actions slot.
        embedded
        editor={activeEditorView && (effectiveCapability.status === "available" || (readonly && effectiveCapability.status === "readonly")) ? activeEditorView : (
          // The shell no longer pads the editor area (UNI-933 F1), so a message keeps its own margin.
          <Alert data-testid="office-host-unbound" className="m-4 w-auto border-border">
            <AlertTitle>{!activeSession && !activeCapability ? t("office.editor.capability_unavailable") : t("office.editor.capability_unknown")}</AlertTitle>
            <AlertDescription>{!activeSession && !activeCapability
              ? t("office.editor.editor_pending", { format: formatName(effectiveCapability.format) })
              : t("office.editor.capability_hint")}</AlertDescription>
          </Alert>
        )}
        saveCoordinator={activeSession?.coordinator}
        saveState={coordinatorState}
        editorReady={Boolean(activeSession && viewReady && !readonly && effectiveCapability.status === "available")}
        // Lane additive (UNI-928 md/html END): only the text formats quiet the
        // Save when clean; every other format keeps the primary button.
        saveQuietWhenClean={effectiveCapability.format === "md" || effectiveCapability.format === "html"}
        desktopAction={renderDesktopAction("header")}
        className="h-full min-h-0"
      />
      {activeSession && !readonly && recovery && recovery.status !== "missing" ? (
        <DraftRecoveryPrompt
          open
          metadata={"metadata" in recovery ? recovery.metadata : null}
          conflict={recovery.status === "conflict"}
          recoverable={recovery.status === "recovered" && Boolean(activeRecoverSnapshot)}
          onRecover={recoverDraft}
          onDiscard={async () => { const ok = await activeSession.discardDraft(); if (ok) setRecovery(null); return ok; }}
          onKeep={async () => true}
          onOpenChange={(open) => { if (!open) setRecovery(null); }}
        />
      ) : null}
      <LeaveDialog
        open={leaveOpen}
        dirty={dirty}
        saving={coordinatorState?.state === "saving"}
        onOpenChange={(open) => { if (!open) finishLeave(false); }}
        onSave={async () => { const ok = await saveAndLeave(); if (ok) finishLeave(true); return ok; }}
        onKeepDraft={async () => { const ok = await keepDraftAndLeave(); if (ok) finishLeave(true); return ok; }}
        onDiscard={async () => { const ok = await discardAndLeave(); if (ok) finishLeave(true); return ok; }}
      />
    </div>
    </OfficeTooLargeProvider>
  );
}

export type OfficeDocumentEditorHost = ComponentType<OfficeEditorHostProps>;

export const createWebOfficeEditorHost = createOfficeEditorSession;
