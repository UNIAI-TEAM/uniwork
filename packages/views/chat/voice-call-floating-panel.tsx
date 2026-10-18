"use client";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Maximize2, Minimize2, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { VoiceCallFace, VoiceCallWorkspaceChip, useVoiceCallFaceIsSquare } from "./voice-call-face";

export type VoiceCallPanelMode = "expanded" | "minimized" | "fullscreen";

type DragHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

/** 44px round icon action on the dark call plane (expand, restore). */
const ROUND_ICON_ACTION = "size-11 shrink-0 rounded-full";
/** Header size controls stay bare until hovered. */
const HEADER_ACTION = cn(
  ROUND_ICON_ACTION,
  "border-transparent bg-transparent text-call-muted-foreground hover:text-foreground",
);
/* The answer and decline fills glow in their own colour, as the canvas draws them. */
const LABELED_ACTION_CLASS = {
  decline: "shadow-lg shadow-destructive-solid/35",
  accept: "shadow-lg shadow-success-solid/35",
  neutral: "border-transparent",
} as const;
const LABELED_ACTION_VARIANT = {
  decline: "destructiveSolid",
  accept: "successSolid",
  neutral: "meetingChip",
} as const;

/** Hang up: the handset turned down, the glyph every call surface uses for ending. */
export function VoiceCallHangupIcon({ className }: { className?: string }) {
  return <Phone aria-hidden className={cn("rotate-[135deg]", className)} />;
}

/** The call plane: a navy wash from the top, dark in both themes (see --call-plane in tokens.css). */
export const VOICE_CALL_PLANE =
  "rounded-2xl border border-meeting-bar-border bg-linear-to-b from-call-plane-raised to-call-plane shadow-floating";

/**
 * The status line is the panel's one live region and holds only the state
 * ("Đang gọi…", "Đã kết nối"). The running duration sits beside it as a
 * timer that is never announced, so a screen reader is not read a clock
 * every second.
 */
function VoiceCallStatusLine({
  statusLabel,
  duration,
  indicator,
  className,
}: {
  statusLabel: string;
  duration?: string;
  indicator?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 text-label text-call-muted-foreground", className)}>
      <span role="status" className="truncate">
        {statusLabel}
      </span>
      {duration ? (
        <>
          <span aria-hidden>·</span>
          <span
            role="timer"
            aria-live="off"
            aria-label={t("chat.voice_call_duration_label")}
            className="shrink-0 tabular-nums"
          >
            {duration}
          </span>
        </>
      ) : null}
      {indicator ? <span className="flex shrink-0">{indicator}</span> : null}
    </div>
  );
}

export function VoiceCallFloatingScrim({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6">
      <div className={cn("pointer-events-auto w-full max-w-[380px]", className)}>{children}</div>
    </div>
  );
}

/**
 * After the viewer changes the panel's size, focus lands on the control
 * that undoes it — the one they would press next — instead of on <body>.
 */
function useModeFocus(
  mode: VoiceCallPanelMode,
  targets: {
    expand: RefObject<HTMLButtonElement | null>;
    minimize: RefObject<HTMLButtonElement | null>;
    fullscreen: RefObject<HTMLButtonElement | null>;
  },
) {
  const previousRef = useRef(mode);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = mode;
    if (previous === mode) return;
    if (mode === "minimized") targets.expand.current?.focus();
    else if (mode === "expanded") {
      (previous === "fullscreen" ? targets.fullscreen : targets.minimize).current?.focus();
    }
    // Fullscreen: the dialog puts focus on its restore control itself.
  }, [mode, targets.expand, targets.minimize, targets.fullscreen]);
}

/** The pill's face; a live speaker wears the ring the canvas draws around it. */
function PillFace({ peerName, speaking }: { peerName: string; speaking?: boolean }) {
  const square = useVoiceCallFaceIsSquare();
  return (
    <span className="relative shrink-0">
      {speaking ? (
        <span
          aria-hidden
          className={cn("absolute -inset-0.75 border-2 border-call-ring", square ? "rounded-[17px]" : "rounded-full")}
        />
      ) : null}
      <VoiceCallFace peerName={peerName} size="pill" />
    </span>
  );
}

export function VoiceCallFloatingPanel({
  peerName,
  statusLabel,
  duration,
  indicator,
  mode,
  onMinimize,
  onMaximize,
  speaking,
  footer,
  notice,
  live,
  children,
  panelRef,
  panelStyle,
  dragHandleProps,
  fullscreenAction,
  fullscreenAside,
}: {
  peerName: string;
  statusLabel: string;
  /** The running call time, shown beside the status but never announced. */
  duration?: string;
  /** Always-visible call state such as the recording badge, in every mode. */
  indicator?: ReactNode;
  mode: VoiceCallPanelMode;
  onMinimize?: () => void;
  onMaximize?: () => void;
  /** The other person is talking (1-1): the pill's face wears the speaking ring. */
  speaking?: boolean;
  footer?: ReactNode;
  /** Connection and device notices, pinned above the stage. */
  notice?: ReactNode;
  /**
   * Screen-reader-only announcers. Rendered inside the panel in every mode,
   * so they stay audible when fullscreen makes the rest of the page inert.
   */
  live?: ReactNode;
  children?: ReactNode;
  panelRef?: RefObject<HTMLDivElement | null>;
  panelStyle?: CSSProperties;
  dragHandleProps?: DragHandleProps;
  /** Fullscreen only: a header control before restore, and a panel beside the stage. */
  fullscreenAction?: ReactNode;
  fullscreenAside?: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const expandRef = useRef<HTMLButtonElement>(null);
  const minimizeRef = useRef<HTMLButtonElement>(null);
  const fullscreenRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  useModeFocus(mode, { expand: expandRef, minimize: minimizeRef, fullscreen: fullscreenRef });
  const regionLabel = t("chat.voice_call_region_label", { name: peerName, status: statusLabel });

  if (mode === "minimized") {
    return (
      <div
        ref={panelRef}
        role="region"
        aria-label={regionLabel}
        className="fixed right-4 bottom-4 z-50 w-[min(calc(100vw-2rem),380px)] sm:right-6 sm:bottom-6"
        style={panelStyle}
      >
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-full border border-meeting-bar-border bg-call-plane p-2 shadow-floating",
            dragHandleProps && "cursor-grab touch-none select-none active:cursor-grabbing",
          )}
          {...dragHandleProps}
        >
          {/* The call plane is dark in both themes; its content reads the
              dark palette (see --call-plane in tokens.css). */}
          <div className="dark contents text-foreground">
            <PillFace peerName={peerName} speaking={speaking} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body leading-[19px] font-semibold text-foreground">{peerName}</p>
              <VoiceCallStatusLine
                statusLabel={statusLabel}
                duration={duration}
                indicator={indicator}
                className="mt-0.5 text-caption"
              />
            </div>
            {onMaximize ? (
              <Button
                ref={expandRef}
                type="button"
                variant="meetingChip"
                size="icon"
                className={cn(ROUND_ICON_ACTION, "border-transparent")}
                aria-label={t("chat.voice_call_expand")}
                onClick={onMaximize}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Maximize2 aria-hidden className="size-4.5" />
              </Button>
            ) : null}
            {footer}
          </div>
        </div>
        {live}
      </div>
    );
  }

  if (mode === "fullscreen") {
    // A modal dialog: focus moves in and stays in, the page behind is inert,
    // and Escape only leaves fullscreen — it never hangs up.
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onMinimize?.();
        }}
      >
        <DialogContent
          showCloseButton={false}
          initialFocus={restoreRef}
          finalFocus={false}
          overlayClassName="bg-call-plane supports-backdrop-filter:backdrop-blur-none"
          className="top-0 left-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-call-plane p-0 ring-0 shadow-none sm:max-w-none"
        >
          <div className="dark contents text-foreground">
            <div className="flex h-17 shrink-0 items-center gap-3 border-b border-call-hairline pr-4 pl-5">
              <VoiceCallFace peerName={peerName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <DialogTitle className="truncate font-display text-title-sm leading-[22px] font-bold text-foreground">
                    {peerName}
                  </DialogTitle>
                  <VoiceCallWorkspaceChip size="sm" />
                </div>
                <VoiceCallStatusLine
                  statusLabel={statusLabel}
                  duration={duration}
                  indicator={indicator}
                  className="mt-0.5"
                />
              </div>
              {fullscreenAction}
              {onMinimize ? (
                <Button
                  ref={restoreRef}
                  type="button"
                  variant="meetingChip"
                  size="icon"
                  className={cn(ROUND_ICON_ACTION, "border-transparent")}
                  aria-label={t("chat.voice_call_restore")}
                  onClick={onMinimize}
                >
                  <Minimize2 aria-hidden className="size-4.5" />
                </Button>
              ) : null}
            </div>
            {children ? (
              <div className="flex min-h-0 flex-1 gap-4 px-4 pt-4">
                {/* Below sm the side panel takes the stage's place instead of squeezing it. */}
                <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-3", fullscreenAside && "max-sm:hidden")}>
                  {/* The notices render nothing while all is well, so they add no gap. */}
                  {notice}
                  {children}
                </div>
                {fullscreenAside}
              </div>
            ) : null}
            {footer ? <div className="relative flex min-h-29 shrink-0 items-center justify-center px-4">{footer}</div> : null}
            {live}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={regionLabel}
      className={cn(
        // The footer (hang up) stays reachable on a short landscape phone:
        // the panel caps at the viewport and only its body scrolls.
        "fixed right-4 bottom-4 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),380px)] flex-col overflow-hidden sm:right-6 sm:bottom-6",
        VOICE_CALL_PLANE,
      )}
      style={panelStyle}
    >
      <div className="dark contents text-foreground">
        <div
          className={cn(
            "relative flex shrink-0 items-center gap-2.5 border-b border-call-hairline pt-4.5 pr-2.5 pb-3.5 pl-4",
            dragHandleProps && "cursor-grab touch-none select-none active:cursor-grabbing",
          )}
          {...dragHandleProps}
        >
          {dragHandleProps ? (
            <span
              aria-hidden
              className="absolute top-1.75 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-call-muted-foreground/30"
            />
          ) : null}
          <VoiceCallFace peerName={peerName} size="sm" />
          <div className="min-w-0 flex-1">
            <p id={titleId} className="truncate font-display text-body-lg leading-5 font-bold text-foreground">
              {peerName}
            </p>
            <VoiceCallStatusLine statusLabel={statusLabel} duration={duration} indicator={indicator} className="mt-0.5" />
          </div>
          {onMinimize || onMaximize ? (
            <div className="flex shrink-0 items-center" onPointerDown={(event) => event.stopPropagation()}>
              {onMinimize ? (
                <Button
                  ref={minimizeRef}
                  type="button"
                  variant="meetingChip"
                  size="icon"
                  className={HEADER_ACTION}
                  aria-label={t("chat.voice_call_minimize")}
                  onClick={onMinimize}
                >
                  <Minimize2 aria-hidden className="size-4.5" />
                </Button>
              ) : null}
              {onMaximize ? (
                <Button
                  ref={fullscreenRef}
                  type="button"
                  variant="meetingChip"
                  size="icon"
                  className={HEADER_ACTION}
                  aria-label={t("chat.voice_call_fullscreen")}
                  onClick={onMaximize}
                >
                  <Maximize2 aria-hidden className="size-4.5" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {notice || children ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {notice}
            {children}
          </div>
        ) : null}
        {footer ? <div className="shrink-0 border-t border-call-hairline px-5 pt-4 pb-5">{footer}</div> : null}
        {live}
      </div>
    </div>
  );
}

/** A round action with its word under it: answer, decline, call back, close. */
export function VoiceCallLabeledAction({
  label,
  ariaLabel,
  onClick,
  tone,
  icon,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  tone: "decline" | "accept" | "neutral";
  icon: ReactNode;
}) {
  // The -solid fills are measured under --on-solid in both themes; the plain
  // signal colours are pastel in dark mode and fail AA under white.
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant={LABELED_ACTION_VARIANT[tone]}
        size="icon"
        className={cn("size-16 rounded-full", LABELED_ACTION_CLASS[tone])}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {icon}
      </Button>
      <span className="text-label font-medium text-call-muted-foreground" aria-hidden>
        {label}
      </span>
    </div>
  );
}
