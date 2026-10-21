"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@uniwork/ui/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniPanel } from "./ask-uni-panel";

/**
 * Wraps the main content so Ask UNI docks beside it (R10). The content sits in
 * the same panel whether the dock is open, full page or a phone sheet, so the
 * user's page is never remounted by it. `docked` is the ask_uni_stream flag:
 * off, the group is the same single panel and nothing else renders, so a flag
 * that flips after the shell mounted (config arrives late) only adds siblings.
 */
export function AskUniDock({ docked: enabledByFlag, children }: { docked: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { workspace } = useWorkspace();
  const enabled = !!useAiCapabilities(workspace.id).data?.enabled;
  const { open, fullPage, workspaceId, bindWorkspace, setOpen } = useAiPanelStore();
  useEffect(() => {
    if (enabledByFlag) bindWorkspace(workspace.id);
  }, [enabledByFlag, workspace.id, bindWorkspace]);
  // Until bindWorkspace runs, `open` may belong to the previous workspace.
  const show = enabledByFlag && open && enabled && workspaceId === workspace.id;
  const docked = show && !isMobile;
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
        <ResizablePanel
          id="content"
          minSize="30%"
          hidden={docked && fullPage}
          className="flex min-w-0 flex-col !overflow-hidden"
        >
          {children}
        </ResizablePanel>
        {docked ? (
          <>
            {!fullPage ? <ResizableHandle withHandle /> : null}
            <ResizablePanel
              id="ask-uni"
              minSize="400px"
              maxSize={fullPage ? undefined : "640px"}
              defaultSize="440px"
              className="min-w-0 !overflow-hidden border-l border-border"
            >
              <aside aria-label={t("ai.title")} className="h-full">
                <AskUniPanel />
              </aside>
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {enabledByFlag && isMobile ? (
        <Sheet open={show} onOpenChange={setOpen}>
          <SheetContent side="right" showCloseButton={false} closeLabel={t("ai.close")} className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-full">
            <SheetTitle className="sr-only">{t("ai.title")}</SheetTitle>
            <AskUniPanel />
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
