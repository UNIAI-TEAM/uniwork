"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { HeaderActionsFill, useHeaderActionsSlotAvailable } from "../../layout/header-actions-slot";
import { DesktopOpenAction, type DesktopOpenActionProps, type DesktopOpenOutcome, type OfficeSaveCoordinatorLike, type OfficeSaveStateLike } from "../desktop-open-action";

/** What the page hands the frame for "Open in desktop app" (apps/web/platform/office-frame/desktop-open-props.ts). */
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
 * cluster (or a slim bar above the frame when the page
 * has no header slot). The frame has no save coordinator, so a small adapter
 * stands in for one: only its dirty fields and `save` are read by the action.
 */
export function FrameDesktopOpenAction({ desktopOpen, documentId, workspaceId, dirty, save, requestRef }: FrameDesktopOpenActionProps) {
  const headerSlot = useHeaderActionsSlotAvailable();
  const latest = useRef({ dirty, save });
  latest.current = { dirty, save };
  const coordinator = useMemo<OfficeSaveCoordinatorLike>(() => ({
    getState: (): OfficeSaveStateLike => {
      const isDirty = latest.current.dirty;
      return { state: isDirty ? "dirty" : "saved", dirtyGeneration: isDirty ? 1 : 0, lastSavedGeneration: 0 };
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
