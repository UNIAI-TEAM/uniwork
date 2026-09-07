"use client";

import { useParticipants } from "@livekit/components-react";
import { Hand } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingCaptionsOverlay } from "./meeting-captions";
import { useMeetingSignals } from "./use-meeting-signals";

const DOCK_HIDE_DELAY_MS = 750;
const DOCK_INTERACTION_GRACE_MS = 2800;
const DOCK_ANIM_MS = 280;
const FOOTER_EDGE_PAD_PX = 12;
const DOCK_RESERVE_BUFFER_PX = 8;
const MIN_DOCK_RESERVE_PX = 80;
const COLLAPSED_RESERVE_MIN_PX = 8;

function MeetingHandsBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { hands } = useMeetingSignals();
  const participants = useParticipants();

  if (hands.length === 0) return null;

  const names = hands.map((identity) => {
    const participant = participants.find((p) => p.identity === identity);
    return participant?.name || participant?.identity || identity;
  });

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none flex w-fit max-w-[min(100%,48rem)] items-center gap-2 rounded-xl bg-warning/95 px-3 py-2 text-label font-medium text-background shadow-sm backdrop-blur-sm",
        className,
      )}
      data-testid="meeting-hands-banner"
    >
      <Hand aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 truncate">
        {t("meetings.handsRaised", { count: hands.length })}
        {": "}
        {names.join(", ")}
      </span>
    </div>
  );
}

function isWithin(node: RefObject<HTMLElement | null>, target: Node | null): boolean {
  return target != null && (node.current?.contains(target) ?? false);
}

function reserveTotal(contentPx: number, collapsed = false): number {
  if (collapsed && contentPx <= 0) return COLLAPSED_RESERVE_MIN_PX;
  const edge = collapsed ? 8 : FOOTER_EDGE_PAD_PX;
  const buffer = collapsed ? 4 : DOCK_RESERVE_BUFFER_PX;
  return contentPx + edge + buffer;
}

export function MeetingStageFooter({
  stageContentRef,
  captionsOn,
  captionsInterim,
  captionsLastFinal,
  controlBar,
  className,
  onReserveHeightChange,
}: {
  stageContentRef: RefObject<HTMLDivElement | null>;
  captionsOn: boolean;
  captionsInterim: string;
  captionsLastFinal: string;
  controlBar: ReactNode;
  className?: string;
  onReserveHeightChange?: (heightPx: number) => void;
}) {
  const autoHide = useMeetingRoomPreferencesStore((s) => s.controlBarAutoHide);
  const { handRaised, hands } = useMeetingSignals();
  const [revealed, setRevealed] = useState(!autoHide);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dockShellRef = useRef<HTMLDivElement>(null);
  const interactUntilRef = useRef(0);
  const expandedReserveRef = useRef(reserveTotal(MIN_DOCK_RESERVE_PX));
  const collapsedReserveRef = useRef(reserveTotal(0));
  const appliedReserveRef = useRef(0);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!autoHide || handRaised || Date.now() < interactUntilRef.current) return;
    hideTimer.current = setTimeout(() => setRevealed(false), DOCK_HIDE_DELAY_MS);
  }, [autoHide, clearHideTimer, handRaised]);

  const showDock = useCallback(() => {
    clearHideTimer();
    setRevealed(true);
  }, [clearHideTimer]);

  const markInteraction = useCallback(() => {
    interactUntilRef.current = Date.now() + DOCK_INTERACTION_GRACE_MS;
    showDock();
  }, [showDock]);

  const pointerInDockZone = useCallback(
    (target: Node | null) =>
      isWithin(stageContentRef, target) || isWithin(stackRef, target),
    [stageContentRef],
  );

  const measureReserves = useCallback(() => {
    const stack = measureRef.current;
    const dock = dockShellRef.current;
    if (!stack || !dock) return;

    const dockHeight = dock.scrollHeight;
    let overhead = 0;
    for (const child of stack.children) {
      if (child === dock) continue;
      overhead += (child as HTMLElement).getBoundingClientRect().height;
    }
    const gapPx = Number.parseFloat(getComputedStyle(stack).rowGap) || 8;
    const gaps = Math.max(0, stack.children.length - 1) * gapPx;
    const expandedContent = Math.max(overhead + gaps + dockHeight, MIN_DOCK_RESERVE_PX);
    const collapsedContent = Math.max(overhead + gaps, 0);

    expandedReserveRef.current = reserveTotal(expandedContent);
    collapsedReserveRef.current = reserveTotal(collapsedContent, true);
  }, []);

  const applyReserve = useCallback(
    (hidden: boolean) => {
      if (!onReserveHeightChange) return;
      const next = !autoHide
        ? expandedReserveRef.current
        : hidden
          ? collapsedReserveRef.current
          : expandedReserveRef.current;
      if (next === appliedReserveRef.current) return;
      appliedReserveRef.current = next;
      onReserveHeightChange(next);
    },
    [autoHide, onReserveHeightChange],
  );

  useEffect(() => {
    if (!autoHide) {
      clearHideTimer();
      setRevealed(true);
      return;
    }
    if (handRaised) {
      showDock();
      return;
    }
    scheduleHide();
    return clearHideTimer;
  }, [autoHide, clearHideTimer, handRaised, scheduleHide, showDock]);

  useEffect(() => {
    if (!autoHide) return;

    const onMove = (event: MouseEvent) => {
      if (pointerInDockZone(event.target as Node)) {
        showDock();
      } else if (!handRaised && Date.now() >= interactUntilRef.current) {
        scheduleHide();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (isWithin(stackRef, target)) {
        markInteraction();
        return;
      }
      if (!pointerInDockZone(target) && !handRaised && Date.now() >= interactUntilRef.current) {
        scheduleHide();
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, [
    autoHide,
    handRaised,
    markInteraction,
    pointerInDockZone,
    scheduleHide,
    showDock,
  ]);

  const dockHidden = autoHide && !revealed;
  const dockHiddenRef = useRef(dockHidden);
  dockHiddenRef.current = dockHidden;

  // Derive reserve from intrinsic sizes (scrollHeight + siblings), not live stack height during animation.
  useEffect(() => {
    const stack = measureRef.current;
    const dock = dockShellRef.current;
    if (!stack || !dock || !onReserveHeightChange) return;

    const refresh = () => {
      measureReserves();
      applyReserve(autoHide && dockHiddenRef.current);
    };

    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(stack);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [applyReserve, autoHide, captionsOn, hands.length, measureReserves, onReserveHeightChange]);

  // Swap reserve once when visibility toggles so padding animates in sync with the dock.
  useEffect(() => {
    applyReserve(dockHidden);
  }, [applyReserve, dockHidden]);

  return (
    <div
      ref={stackRef}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-2 sm:pb-3",
        className,
      )}
      data-dock-hidden={dockHidden || undefined}
      onMouseEnter={showDock}
      onMouseLeave={scheduleHide}
      onFocusCapture={markInteraction}
      onPointerDown={markInteraction}
      onBlurCapture={(event) => {
        if (!stackRef.current?.contains(event.relatedTarget as Node)) scheduleHide();
      }}
    >
      <div
        ref={measureRef}
        className="flex w-fit max-w-full flex-col items-center gap-2 sm:gap-2.5"
      >
        <MeetingHandsBanner />
        {captionsOn ? (
          <MeetingCaptionsOverlay interim={captionsInterim} lastFinal={captionsLastFinal} embedded />
        ) : null}
        <div
          ref={dockShellRef}
          className={cn(
            "pointer-events-auto w-fit max-w-full origin-bottom transition-[max-height,transform,opacity,margin] ease-out motion-reduce:transition-none",
            dockHidden
              ? "pointer-events-none max-h-0 translate-y-2 scale-95 opacity-0"
              : "max-h-24 translate-y-0 scale-100 opacity-100",
          )}
          style={{ transitionDuration: `${DOCK_ANIM_MS}ms` }}
          data-testid="meeting-control-dock"
        >
          {controlBar}
        </div>
      </div>
    </div>
  );
}
