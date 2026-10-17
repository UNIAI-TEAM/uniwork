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
import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { initialOf } from "./chat-initials";

export type VoiceCallPanelMode = "expanded" | "minimized" | "fullscreen";

type DragHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

/** The same one-letter fallback every chat avatar uses, so a person looks alike in the list and in a call. */
export function voiceCallInitialOf(name: string): string {
  return initialOf(name);
}

const PEER_AVATAR_SIZE = { sm: "size-10", md: "size-18", lg: "size-24" } as const;
/* Two staggered rings on a slow 1.8s swell; ping's own 1s reads as alarm. */
const PULSE_DELAYS = ["0s", "0.9s"] as const;
/** 44px round icon action on the dark call plane (expand, restore). */
const ROUND_ICON_ACTION = "size-11 shrink-0 rounded-full";
/** Header size controls stay bare until hovered. */
const HEADER_ACTION = cn(ROUND_ICON_ACTION, "border-transparent bg-transparent text-muted-foreground hover:text-foreground");
const LABELED_ACTION_VARIANT = {
  decline: "destructiveSolid",
  accept: "successSolid",
  neutral: "meetingChip",
} as const;

export function VoiceCallPeerAvatar({
  peerName,
  size = "md",
  pulse,
  pulseTone = "brand",
}: {
  peerName: string;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  /** Incoming rings in the "answer" green, outgoing in the brand. */
  pulseTone?: "brand" | "success";
}) {
  const ringColor = pulseTone === "success" ? "border-success" : "border-brand";
  return (
    <div className={cn("relative shrink-0", PEER_AVATAR_SIZE[size])}>
      {/* The rings are the "it is ringing" signal: they swell out from behind
          the avatar, and under reduced motion a still halo stands in. */}
      {pulse ? (
        <>
          <span aria-hidden className={cn("absolute -inset-1.5 rounded-full border-2 opacity-50 motion-safe:hidden", ringColor)} />
          {PULSE_DELAYS.map((delay) => (
            <span
              key={delay}
              aria-hidden
              className={cn("absolute inset-[16%] rounded-full border-3 motion-safe:animate-ping motion-reduce:hidden", ringColor)}
              style={{ animationDuration: "1.8s", animationDelay: delay }}
            />
          ))}
        </>
      ) : null}
      <Avatar className={cn("relative", PEER_AVATAR_SIZE[size])}>
        <AvatarFallback
          className={cn(
            "bg-brand-subtle font-display font-bold text-brand-subtle-foreground",
            size === "lg" ? "text-display-sm" : "text-body",
          )}
        >
          {voiceCallInitialOf(peerName)}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

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
    <div className={cn("flex min-w-0 items-center gap-1.5 text-label text-muted-foreground", className)}>
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
      {indicator ? <span className="shrink-0">{indicator}</span> : null}
    </div>
  );
}

function VoiceCallPanelHeader({
  peerName,
  titleId,
  statusLabel,
  duration,
  indicator,
  pulse,
  actions,
  dragHandleProps,
  title,
}: {
  peerName: string;
  titleId?: string;
  statusLabel: string;
  duration?: string;
  indicator?: ReactNode;
  pulse?: boolean;
  actions?: ReactNode;
  dragHandleProps?: DragHandleProps;
  title?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center gap-2.5 border-b border-border py-3 pr-2 pl-4",
        dragHandleProps && "cursor-grab touch-none select-none pt-4.5 active:cursor-grabbing",
      )}
      {...dragHandleProps}
    >
      {dragHandleProps ? (
        <span aria-hidden className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-faint-foreground/50" />
      ) : null}
      <VoiceCallPeerAvatar peerName={peerName} size="sm" pulse={pulse} />
      <div className="min-w-0 flex-1">
        {title ?? (
          <p id={titleId} className="truncate font-display text-body-lg font-bold text-foreground">
            {peerName}
          </p>
        )}
        <VoiceCallStatusLine
          statusLabel={statusLabel}
          duration={duration}
          indicator={indicator}
          className="mt-0.5"
        />
      </div>
      {actions}
    </div>
  );
}

export function VoiceCallFloatingScrim({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6">
      <div className="pointer-events-auto w-full max-w-[380px]">{children}</div>
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

export function VoiceCallFloatingPanel({
  peerName,
  statusLabel,
  duration,
  indicator,
  mode,
  onMinimize,
  onMaximize,
  allowResize = true,
  landmark = true,
  pulse,
  footer,
  notice,
  live,
  children,
  panelRef,
  panelStyle,
  dragHandleProps,
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
  allowResize?: boolean;
  /** False when a wrapper already names the panel (the incoming alert dialog). */
  landmark?: boolean;
  pulse?: boolean;
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
        className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6"
        style={panelStyle}
      >
        <div
          className={cn(
            "flex max-w-[min(100vw-2rem,380px)] items-center gap-2.5 rounded-full border border-meeting-bar-border bg-surface-emphasis p-2 shadow-floating",
            dragHandleProps && "cursor-grab touch-none select-none active:cursor-grabbing",
          )}
          {...dragHandleProps}
        >
          {/* The emphasis plane is painted here in the page theme; its content
              reads the dark palette (see --surface-emphasis in tokens.css). */}
          <div className="dark contents text-foreground">
            <VoiceCallPeerAvatar peerName={peerName} size="sm" pulse={pulse} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold text-foreground">{peerName}</p>
              <VoiceCallStatusLine
                statusLabel={statusLabel}
                duration={duration}
                indicator={indicator}
                className="text-caption"
              />
            </div>
            {allowResize ? (
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

  const headerActions =
    allowResize && (onMinimize || onMaximize) ? (
      <div
        className="flex shrink-0 items-center gap-0.5"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {mode === "expanded" && onMinimize ? (
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
        {mode === "expanded" && onMaximize ? (
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
        {mode === "fullscreen" && onMinimize ? (
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
    ) : null;

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
          overlayClassName="bg-surface-emphasis supports-backdrop-filter:backdrop-blur-none"
          className="top-0 left-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-surface-emphasis p-0 ring-0 shadow-none sm:max-w-none"
        >
          <div className="dark contents text-foreground">
            <VoiceCallPanelHeader
              peerName={peerName}
              statusLabel={statusLabel}
              duration={duration}
              indicator={indicator}
              pulse={pulse}
              actions={headerActions}
              title={
                <DialogTitle className="truncate font-display text-title leading-normal font-bold text-foreground">
                  {peerName}
                </DialogTitle>
              }
            />
            {notice ? <div className="shrink-0 px-4 pt-4">{notice}</div> : null}
            {/* The same stage the meeting room uses, on the call's dark plane. */}
            {children ? (
              <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto rounded-2xl bg-meeting-stage px-4 py-6 ring-1 ring-border sm:px-8">
                  <div className="flex w-full max-w-5xl flex-1 flex-col items-center justify-center">{children}</div>
                </div>
              </div>
            ) : null}
            {footer ? <div className="shrink-0 px-4 py-6 sm:px-8">{footer}</div> : null}
            {live}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div
      ref={allowResize ? panelRef : undefined}
      role={landmark ? "region" : undefined}
      aria-label={landmark ? regionLabel : undefined}
      className={cn(
        // The footer (hang up) stays reachable on a short landscape phone:
        // the panel caps at the viewport and only its body scrolls.
        "flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-meeting-bar-border bg-surface-emphasis shadow-floating",
        allowResize
          ? "fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),380px)] sm:bottom-6 sm:right-6"
          : "w-full",
      )}
      style={allowResize ? panelStyle : undefined}
    >
      <div className="dark contents text-foreground">
        <VoiceCallPanelHeader
          peerName={peerName}
          titleId={titleId}
          statusLabel={statusLabel}
          duration={duration}
          indicator={indicator}
          pulse={pulse}
          actions={headerActions}
          dragHandleProps={allowResize ? dragHandleProps : undefined}
        />
        {notice || children ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {notice}
            {children}
          </div>
        ) : null}
        {footer ? <div className="shrink-0 border-t border-border px-5 pt-4 pb-5">{footer}</div> : null}
        {live}
      </div>
    </div>
  );
}

export function VoiceCallLabeledAction({
  label,
  ariaLabel,
  onClick,
  tone,
  icon,
  compact = false,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  tone: "decline" | "accept" | "neutral";
  icon: ReactNode;
  compact?: boolean;
}) {
  // The -solid fills are measured under --on-solid in both themes; the plain
  // signal colours are pastel in dark mode and fail AA under white.
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant={LABELED_ACTION_VARIANT[tone]}
        size="icon"
        className={cn("rounded-full", compact ? "size-14" : "size-16", tone === "neutral" && "border-transparent")}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {icon}
      </Button>
      <span className="text-label font-medium text-muted-foreground" aria-hidden>
        {label}
      </span>
    </div>
  );
}

export function VoiceCallControlRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>;
}
