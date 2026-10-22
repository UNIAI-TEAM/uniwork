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

// The library writes touch-action: pan-y on the group and on each panel's inner
// div, after any style prop, which would switch off pinch and double-tap zoom
// for every page inside. Only the separator keeps its own touch-action: none.
const TOUCH_AUTO = "!touch-auto";

/**
 * Wraps the main content so Ask UNI docks beside it (R10). The content sits in
 * the same panel whether the dock is open, full page or a phone sheet, so the
 * user's page is never remounted by it. `enabled` is the ask_uni_stream flag:
 * off, the group is the same single panel and nothing else renders, so a flag
 * that flips after the shell mounted (config arrives late) only adds siblings.
 */
export function AskUniDock({ enabled: enabledByFlag, children }: { enabled: boolean; children: ReactNode }) {
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
      <ResizablePanelGroup orientation="horizontal" className={`min-h-0 min-w-0 flex-1 ${TOUCH_AUTO}`}>
        <ResizablePanel
          id="content"
          minSize="30%"
          hidden={docked && fullPage}
          className={`flex min-w-0 flex-col !overflow-hidden ${TOUCH_AUTO}`}
        >
          {children}
        </ResizablePanel>
        {docked ? (
          <>
            {!fullPage ? <ResizableHandle withHandle aria-label={t("ai.resize")} /> : null}
            <ResizablePanel
              id="ask-uni"
              minSize="400px"
              maxSize={fullPage ? undefined : "640px"}
              defaultSize="440px"
              className={`min-w-0 !overflow-hidden border-l border-border ${TOUCH_AUTO}`}
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
