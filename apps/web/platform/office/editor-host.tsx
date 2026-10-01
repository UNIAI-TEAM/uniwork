"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComponentType } from "react";
import type { Document } from "@uniwork/core/types/document";
import type { OfficeCapabilityEntry, OfficeHost, SaveCoordinatorState, StableSnapshot } from "@uniwork/core/office";
import { registerLeaveGuard } from "@uniwork/views/navigation";
import { DesktopOpenAction, OfficeShell, type OfficeChannel, type OfficeInstallerURLs } from "@uniwork/views/office";
import { DraftRecoveryPrompt, LeaveDialog } from "@uniwork/views/office/leave-dialog";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { useTranslation } from "react-i18next";
import { createOfficeEditorSession, type OfficeEditorSession, type OfficeRecoveryState } from "./editor-host-core";
import { getPublicConfig } from "@uniwork/core/api/endpoints/config";
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
  installerURLs?: OfficeInstallerURLs;
  officeDeploymentId?: string;
}

export interface OfficeFormatAdapter<TSnapshot = unknown> {
  session: OfficeEditorSession<TSnapshot>;
  editorView: ReactNode;
  capability: OfficeCapabilityEntry;
  onRecoverSnapshot?: (snapshot: StableSnapshot<TSnapshot>) => Promise<void> | void;
}

function stateIsDirty(state: SaveCoordinatorState): boolean {
  return state.dirtyGeneration > state.lastSavedGeneration || state.state === "dirty" || state.state === "saving" || state.state === "error" || state.state === "conflict";
}

function documentFormat(document: Document): OfficeCapabilityEntry["format"] {
  const filename = document.file?.filename.toLowerCase() ?? "";
  const mime = document.file?.mime_type.toLowerCase() ?? "";
  if (mime.includes("wordprocessingml.document") || filename.endsWith(".docx")) return "docx";
  if (mime.includes("spreadsheetml.sheet") || filename.endsWith(".xlsx")) return "xlsx";
  if (mime.includes("presentationml.presentation") || filename.endsWith(".pptx")) return "pptx";
  if (mime === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (mime === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) return "md";
  if (mime === "text/html" || filename.endsWith(".html") || filename.endsWith(".htm")) return "html";
  return "docx";
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
  installerURLs = { dev: "", beta: "", stable: "" },
  officeDeploymentId,
}: OfficeEditorHostProps<TSnapshot>) {
  const { t } = useTranslation();
  const activeSession = formatAdapter?.session ?? session;
  const activeEditorView = formatAdapter?.editorView ?? editorView;
  const activeCapability = formatAdapter?.capability ?? capability;
  const activeRecoverSnapshot = formatAdapter?.onRecoverSnapshot ?? onRecoverSnapshot;
  const [coordinatorState, setCoordinatorState] = useState<SaveCoordinatorState | null>(() => activeSession?.coordinator.getState() ?? null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [recovery, setRecovery] = useState<OfficeRecoveryState<TSnapshot> | null>(null);
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null);
  const checkpointGeneration = useRef(0);
  const checkpointPending = useRef(0);
  const recoveryRef = useRef(activeSession);
  recoveryRef.current = activeSession;
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
    return activeSession.coordinator.subscribe(setCoordinatorState);
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession) {
      setRecovery(null);
      return;
    }
    let active = true;
    setRecovery(null);
    void activeSession.recoverDraft().then((result) => {
      if (!active) return;
      setRecovery(result.status === "missing" ? null : result);
    });
    return () => { active = false; };
  }, [activeSession]);

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

  useEffect(() => () => {
    void recoveryRef.current?.dispose();
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

  return (
    <div className={className} data-office-editor-host data-office-format={document.file?.mime_type ?? "unknown"}>
      <OfficeShell
        title={document.title}
        breadcrumbs={breadcrumbs}
        editor={activeEditorView && effectiveCapability.status === "available" ? activeEditorView : (
          <Alert data-testid="office-host-unbound">
            <AlertTitle>{!activeSession && !activeCapability ? t("office.editor.capability_unavailable") : t("office.editor.capability_unknown")}</AlertTitle>
            <AlertDescription>{!activeSession && !activeCapability
              ? t("office.editor.editor_pending", { format: effectiveCapability.format })
              : t("office.editor.capability_hint")}</AlertDescription>
          </Alert>
        )}
        saveCoordinator={activeSession?.coordinator}
        saveState={coordinatorState}
        editorReady={Boolean(activeSession && !readonly && effectiveCapability.status === "available")}
        desktopAction={activeSession && !readonly ? (
          <DesktopOpenAction
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
            installerURLs={installerURLs}
            loadInstallerURLs={async () => (await getPublicConfig(document.organization_id)).office_installer_urls ?? { dev: "", beta: "", stable: "" }}
            launch={launchOfficeDeepLink}
          />
        ) : null}
        className="min-h-[20rem]"
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
  );
}

export type OfficeDocumentEditorHost = ComponentType<OfficeEditorHostProps>;

export const createWebOfficeEditorHost = createOfficeEditorSession;
