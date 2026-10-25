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
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniPanel } from "./ask-uni-panel";

// The library writes touch-action: pan-y on the group and on each panel's inner
// div, after any style prop, which would switch off pinch and double-tap zoom
// for every page inside. Only the separator keeps its own touch-action: none.
const TOUCH_AUTO = "!touch-auto";
// One desktop card: rounded, a full-strength 1px edge, a light shadow. Panels clip what they hold, so the
// 8px around a card is inside its panel and the shadow has room; the handle between two panels is the gap.
const CARD = "lg:overflow-clip lg:rounded-lg lg:border lg:border-surface-border lg:bg-page-canvas lg:shadow-sm";

/**
 * Wraps the main content so Ask UNI docks beside it (R10). The content sits in
 * the same panel whether the dock is open or a phone sheet, so the
 * user's page is never remounted by it. `enabled` is the ask_uni_stream flag:
 * off, the group is the same single panel and nothing else renders, so a flag
 * that flips after the shell mounted (config arrives late) only adds siblings.
 * `framed` (the workspace shell) draws the content and the dock as two cards
 * on the app plane on desktop; without it they stay one surface split by a line.
 */
export function AskUniDock({
  enabled: enabledByFlag,
  framed = false,
  children,
}: {
  enabled: boolean;
  framed?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { workspace } = useWorkspace();
  const enabled = !!useAiCapabilities(workspace.id).data?.enabled;
  const { open, workspaceId, bindWorkspace, setOpen } = useAiPanelStore();
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
          className={cn("flex min-w-0 flex-col !overflow-hidden", TOUCH_AUTO, framed && "lg:pb-2", framed && !docked && "lg:pr-2")}
        >
          {/* The wrapper is there whether the dock is open or not, so opening it never remounts the page. */}
          {framed ? <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", CARD)}>{children}</div> : children}
        </ResizablePanel>
        {docked ? (
          <>
            <ResizableHandle withHandle aria-label={t("ai.resize")} className={framed ? "lg:w-2" : undefined} />
            <ResizablePanel
              id="ask-uni"
              minSize="400px"
              maxSize="640px"
              defaultSize="440px"
              className={cn("min-w-0 !overflow-hidden border-l border-border", TOUCH_AUTO, framed && "lg:border-l-0 lg:pr-2 lg:pb-2")}
            >
              <aside aria-label={t("ai.title")} className={cn("h-full", framed && CARD)}>
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
