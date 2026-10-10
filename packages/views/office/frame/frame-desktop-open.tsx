"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import type { SaveCoordinatorState } from "@uniwork/core/office";
import { HeaderActionsFill, useHeaderActionsSlotAvailable } from "../../layout/header-actions-slot";
import { DesktopOpenAction, type DesktopOpenActionProps, type DesktopOpenOutcome } from "../desktop-open-action";
import type { OfficeSaveCoordinatorLike } from "../office-shell";

/** What the page hands the frame for "Open in desktop app": the same wiring the G3 host uses. */
export type FrameDesktopOpenProps = Omit<DesktopOpenActionProps, "documentId" | "dirty" | "saveCoordinator" | "placement">;

interface FrameDesktopOpenActionProps {
  desktopOpen: FrameDesktopOpenProps;
  documentId: string;
  workspaceId: string;
  dirty: boolean;
  /** The frame's own save; resolves true once the bytes are a new version. */
  save: () => Promise<boolean>;
  /** Filled with the button's flow so the frame's `app.open` request can run it. */
  requestRef?: MutableRefObject<(() => Promise<DesktopOpenOutcome>) | null>;
}

/**
 * `DesktopOpenAction` for a genoffice module frame, in the page header's action
 * cluster like the G3 editor's (or a slim bar above the frame when the page
 * has no header slot). The frame has no save coordinator, so a small adapter
 * stands in for one: only its dirty fields and `save` are read by the action.
 */
export function FrameDesktopOpenAction({ desktopOpen, documentId, workspaceId, dirty, save, requestRef }: FrameDesktopOpenActionProps) {
  const headerSlot = useHeaderActionsSlotAvailable();
  const latest = useRef({ dirty, save });
  latest.current = { dirty, save };
  const coordinator = useMemo<OfficeSaveCoordinatorLike>(() => ({
    getState: (): SaveCoordinatorState => {
      const isDirty = latest.current.dirty;
      return {
        state: isDirty ? "dirty" : "saved",
        identity: { deploymentId: "frame", accountId: "frame", organizationId: "frame", workspaceId, documentId, generation: 0, baseVersionId: "frame", baseRevision: "0" },
        dirtyGeneration: isDirty ? 1 : 0,
        lastSavedGeneration: 0,
        activeIntentId: null,
        error: null,
      };
    },
    save: async () => ({ accepted: await latest.current.save() }),
  }), [documentId, workspaceId]);
  const action = <DesktopOpenAction {...desktopOpen} documentId={documentId} dirty={dirty} saveCoordinator={coordinator} requestRef={requestRef} />;
  if (headerSlot) return <HeaderActionsFill actions={action} />;
  return (
    <div className="flex items-center justify-end gap-2 border-b border-border bg-background px-3 py-1.5" data-office-frame-toolbar>
      {action}
    </div>
  );
}
