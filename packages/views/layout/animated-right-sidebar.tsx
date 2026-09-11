"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PanelRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizablePanelRef,
  type ResizablePanelSize,
} from "@uniwork/ui/components/ui/resizable";
import {
  Sheet,
  SheetContent,
} from "@uniwork/ui/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { UI_EASE_OUT, UI_MOTION_DURATION } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";

const SIDEBAR_SETTLE_MS = UI_MOTION_DURATION.standard * 1000 + 80;

/** Shared state for detail-page sidebars; desktop panels and mobile sheets stay separate. */
export function useAnimatedRightSidebar(defaultOpen = true) {
  const panelRef = useResizablePanelRef();
  const isMobile = useIsMobile();
  const [desktopOpen, setDesktopOpen] = useState(defaultOpen);
  const [desktopVisualOpen, setDesktopVisualOpen] = useState(defaultOpen);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleTargetRef = useRef<boolean | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [isMobile]);

  useEffect(
    () => () => {
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    },
    [],
  );

  const beginDesktopToggle = useCallback((nextOpen: boolean) => {
    toggleTargetRef.current = nextOpen;
    setMotionEnabled(true);
    setDesktopOpen(nextOpen);
    setDesktopVisualOpen(nextOpen);

    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = setTimeout(() => {
      toggleTargetRef.current = null;
      settleTimeoutRef.current = null;
      setMotionEnabled(false);
    }, SIDEBAR_SETTLE_MS);
  }, []);

  const toggle = useCallback(() => {
    if (isMobile) {
      setMobileOpen((open) => !open);
      return;
    }

    const panel = panelRef.current;
    if (!panel) return;
    const nextOpen = panel.isCollapsed();
    beginDesktopToggle(nextOpen);
    window.requestAnimationFrame(() => {
      if (nextOpen) panel.expand();
      else panel.collapse();
    });
  }, [beginDesktopToggle, isMobile, panelRef]);

  const handleResize = useCallback((size: ResizablePanelSize) => {
    const nextOpen = size.asPercentage > 0 || size.inPixels > 0;
    if (toggleTargetRef.current === null) {
      setDesktopOpen(nextOpen);
      setDesktopVisualOpen(nextOpen);
      return;
    }
    setDesktopOpen(toggleTargetRef.current);
  }, []);

  return {
    panelRef,
    isMobile,
    open: isMobile ? mobileOpen : desktopOpen,
    desktopVisualOpen,
    motionEnabled,
    mobileOpen,
    setMobileOpen,
    toggle,
    handleResize,
  };
}

export type AnimatedRightSidebarController = ReturnType<
  typeof useAnimatedRightSidebar
>;

export function RightSidebarToggle({
  controller,
  label,
}: {
  controller: AnimatedRightSidebarController;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={controller.open ? "secondary" : "ghost"}
            size="icon-sm"
            className={controller.open ? undefined : "text-muted-foreground"}
            onClick={controller.toggle}
            aria-label={label}
            aria-expanded={controller.open}
          />
        }
      >
        <PanelRight aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function AnimatedRightSidebar({
  open,
  motionEnabled,
  children,
}: {
  open: boolean;
  motionEnabled: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <motion.div
      initial={false}
      animate={{ opacity: open ? 1 : 0, x: open || reduceMotion ? 0 : 12 }}
      transition={
        motionEnabled
          ? {
              duration: UI_MOTION_DURATION.standard,
              ease: UI_EASE_OUT,
            }
          : { duration: 0 }
      }
      className={cn(
        "h-full min-w-0 overflow-x-hidden",
        !open && "pointer-events-none",
      )}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedRightSidebarLayout({
  controller,
  main,
  sidebar,
  sidebarLabel,
  sidebarDefaultSize = "28%",
  sidebarMinSize = "18%",
  sidebarMaxSize = "42%",
  className,
}: {
  controller: AnimatedRightSidebarController;
  main: ReactNode;
  sidebar: ReactNode;
  sidebarLabel: string;
  sidebarDefaultSize?: number | string;
  sidebarMinSize?: number | string;
  sidebarMaxSize?: number | string;
  className?: string;
}) {
  if (controller.isMobile) {
    return (
      <div className={cn("flex min-h-0 flex-1", className)}>
        <div className="min-h-0 min-w-0 flex-1">{main}</div>
        <Sheet
          open={controller.mobileOpen}
          onOpenChange={controller.setMobileOpen}
        >
          <SheetContent
            side="right"
            closeLabel={sidebarLabel}
            className="w-[min(20rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain p-0"
          >
            {sidebar}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      data-right-sidebar-layout="true"
      data-right-sidebar-motion={
        controller.motionEnabled ? "enabled" : undefined
      }
      className={cn("min-h-0 flex-1", className)}
    >
      <ResizablePanel id="content" minSize="40%" className="min-w-0">
        {main}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="sidebar"
        data-right-sidebar-panel="true"
        panelRef={controller.panelRef}
        defaultSize={sidebarDefaultSize}
        minSize={sidebarMinSize}
        maxSize={sidebarMaxSize}
        collapsible
        groupResizeBehavior="preserve-pixel-size"
        onResize={controller.handleResize}
        className="min-w-0 border-l border-border"
      >
        <AnimatedRightSidebar
          open={controller.desktopVisualOpen}
          motionEnabled={controller.motionEnabled}
        >
          {sidebar}
        </AnimatedRightSidebar>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
