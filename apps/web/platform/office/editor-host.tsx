"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ComponentType } from "react";
import type { Document } from "@uniwork/core/types/document";
import type { OfficeCapabilityEntry, OfficeHost, SaveCoordinatorState, StableSnapshot } from "@uniwork/core/office";
import { registerLeaveGuard } from "@uniwork/views/navigation";
import { OfficeShell } from "@uniwork/views/office";
import { DraftRecoveryPrompt, LeaveDialog } from "@uniwork/views/office/leave-dialog";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { useTranslation } from "react-i18next";
import { createOfficeEditorSession, type OfficeEditorSession, type OfficeRecoveryState } from "./editor-host-core";
export * from "./editor-host-core";

export interface OfficeEditorHostProps<TSnapshot = unknown> {
  document: Document;
  wsId: string;
  readonly: boolean;
  session?: OfficeEditorSession<TSnapshot>;
  editorView?: ReactNode;
  host?: OfficeHost;
  capability?: OfficeCapabilityEntry;
  /** Applies a recovered snapshot to the format editor model. */
  onRecoverSnapshot?: (snapshot: StableSnapshot<TSnapshot>) => Promise<void> | void;
  breadcrumbs?: { label: ReactNode; href?: string }[];
  className?: string;
}

function stateIsDirty(state: SaveCoordinatorState): boolean {
  return state.dirtyGeneration > state.lastSavedGeneration || state.state === "dirty" || state.state === "saving" || state.state === "error" || state.state === "conflict";
}

/** The platform-owned browser host. Consumers inject the engine/editor handle;
 * the host owns lifecycle, durable checkpoints, recovery, and navigation. */
export function OfficeEditorHost<TSnapshot = unknown>({
  document,
  readonly,
  session,
  editorView,
  capability,
  onRecoverSnapshot,
  breadcrumbs = [],
  className,
}: OfficeEditorHostProps<TSnapshot>) {
  const { t } = useTranslation();
  const [coordinatorState, setCoordinatorState] = useState<SaveCoordinatorState | null>(() => session?.coordinator.getState() ?? null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [recovery, setRecovery] = useState<OfficeRecoveryState<TSnapshot> | null>(null);
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null);
  const checkpointGeneration = useRef(0);
  const recoveryRef = useRef(session);
  recoveryRef.current = session;

  useEffect(() => {
    if (!session) return;
    setCoordinatorState(session.coordinator.getState());
    return session.coordinator.subscribe(setCoordinatorState);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void session.recoverDraft().then((result) => { if (active && result.status !== "missing") setRecovery(result); });
    return () => { active = false; };
  }, [session]);

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
    if (!session || readonly) return;
    const timer = window.setInterval(() => {
      const generation = session.editor.getDirtyGeneration();
      if (generation <= checkpointGeneration.current) return;
      checkpointGeneration.current = generation;
      session.coordinator.markDirty(generation);
      void session.checkpoint().catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [readonly, session]);

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
    if (!session) return false;
    const result = await session.coordinator.save("dialog");
    return Boolean(result.accepted) && !stateIsDirty(session.coordinator.getState());
  };
  const keepDraftAndLeave = async () => {
    if (!session) return false;
    try {
      await session.checkpoint();
      return true;
    } catch {
      return false;
    }
  };
  const discardAndLeave = async () => {
    if (!session) return true;
    try {
      await session.discardDraft();
      return true;
    } catch {
      return false;
    }
  };
  const recoverDraft = async () => {
    if (!session || recovery?.status !== "recovered") return false;
    await onRecoverSnapshot?.(recovery.snapshot);
    return true;
  };

  return (
    <div className={className} data-office-editor-host data-office-format={document.file?.mime_type ?? "unknown"}>
      <OfficeShell
        title={document.title}
        breadcrumbs={breadcrumbs}
        editor={editorView ?? (
          <Alert data-testid="office-host-unbound">
            <AlertTitle>{t("office.editor.capability_unknown")}</AlertTitle>
            <AlertDescription>{t("office.editor.capability_hint")}</AlertDescription>
          </Alert>
        )}
        saveCoordinator={session?.coordinator}
        saveState={coordinatorState}
        editorReady={Boolean(session && !readonly)}
        className="min-h-[20rem]"
      />
      {session && recovery && recovery.status !== "missing" ? (
        <DraftRecoveryPrompt
          open
          metadata={"metadata" in recovery ? recovery.metadata : null}
          conflict={recovery.status === "conflict"}
          onRecover={recoverDraft}
          onDiscard={async () => { const ok = await session.discardDraft(); if (ok) setRecovery(null); return ok; }}
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
