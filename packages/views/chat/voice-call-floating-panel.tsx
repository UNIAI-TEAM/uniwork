"use client";

import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { initialOf } from "./chat-initials";

export type VoiceCallPanelMode = "expanded" | "minimized" | "fullscreen";

/** The same one-letter fallback every chat avatar uses, so a person looks alike in the list and in a call. */
export function voiceCallInitialOf(name: string): string {
  return initialOf(name);
}

const PEER_AVATAR_SIZE = { sm: "size-10", md: "size-18", lg: "size-24" } as const;

function VoiceCallPeerAvatar({
  peerName,
  size = "md",
  pulse,
}: {
  peerName: string;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}) {
  return (
    <div className={cn("relative shrink-0", PEER_AVATAR_SIZE[size])}>
      {/* The ring is the "it is ringing" signal; under reduced motion it
          stays as a still halo instead of pulsing. */}
      {pulse ? (
        <span
          className="absolute -inset-1 rounded-full bg-brand-subtle motion-safe:animate-ping"
          aria-hidden
        />
      ) : null}
      <Avatar className={cn("relative text-body", PEER_AVATAR_SIZE[size])}>
        <AvatarFallback className="bg-brand-subtle text-brand-subtle-foreground">
          {voiceCallInitialOf(peerName)}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

function VoiceCallPanelHeader({
  peerName,
  statusLabel,
  pulse,
  actions,
  dragHandleProps,
}: {
  peerName: string;
  statusLabel: string;
  pulse?: boolean;
  actions?: ReactNode;
  dragHandleProps?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b border-border px-4 py-3",
        dragHandleProps && "cursor-grab touch-none select-none active:cursor-grabbing",
      )}
      {...dragHandleProps}
    >
      <VoiceCallPeerAvatar peerName={peerName} size="sm" pulse={pulse} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="truncate text-body font-semibold text-foreground">{peerName}</p>
        <p className="mt-0.5 truncate text-caption tabular-nums text-muted-foreground" aria-live="polite">
          {statusLabel}
        </p>
      </div>
      {actions}
    </div>
  );
}

export function VoiceCallFloatingScrim({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6">
        <div className="pointer-events-auto w-full max-w-[380px]">{children}</div>
      </div>
    </>
  );
}

export function VoiceCallFloatingPanel({
  peerName,
  statusLabel,
  mode,
  onMinimize,
  onMaximize,
  allowResize = true,
  pulse,
  footer,
  children,
  panelRef,
  panelStyle,
  dragHandleProps,
}: {
  peerName: string;
  statusLabel: string;
  mode: VoiceCallPanelMode;
  onMinimize?: () => void;
  onMaximize?: () => void;
  allowResize?: boolean;
  pulse?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  panelRef?: RefObject<HTMLDivElement | null>;
  panelStyle?: CSSProperties;
  dragHandleProps?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}) {
  const { t } = useTranslation();

  if (mode === "minimized") {
    return (
      <div
        ref={panelRef}
        className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6"
        style={panelStyle}
      >
        <div
          className={cn(
            "flex max-w-[min(100vw-2rem,320px)] items-center gap-3 rounded-full border border-border bg-surface px-3 py-2 shadow-[var(--menu-shadow)]",
            dragHandleProps && "cursor-grab touch-none select-none active:cursor-grabbing",
          )}
          {...dragHandleProps}
        >
          <VoiceCallPeerAvatar peerName={peerName} size="sm" pulse={pulse} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-foreground">{peerName}</p>
            <p className="truncate text-caption tabular-nums text-muted-foreground">{statusLabel}</p>
          </div>
          {allowResize ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-full"
              aria-label={t("chat.voice_call_expand")}
              onClick={onMaximize}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Maximize2 aria-hidden className="size-4" />
            </Button>
          ) : null}
          {footer}
        </div>
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
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t("chat.voice_call_minimize")}
            onClick={onMinimize}
          >
            <Minimize2 aria-hidden className="size-4" />
          </Button>
        ) : null}
        {mode === "expanded" && onMaximize ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t("chat.voice_call_fullscreen")}
            onClick={onMaximize}
          >
            <Maximize2 aria-hidden className="size-4" />
          </Button>
        ) : null}
        {mode === "fullscreen" && onMinimize ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t("chat.voice_call_restore")}
            onClick={onMinimize}
          >
            <Minimize2 aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
    ) : null;

  if (mode === "fullscreen") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-app-shell">
        <VoiceCallPanelHeader
          peerName={peerName}
          statusLabel={statusLabel}
          pulse={pulse}
          actions={headerActions}
        />
        {/* The same stage the meeting room uses: a rail card on the shell. */}
        {children ? (
          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl bg-rail px-4 py-6 ring-1 ring-surface-border sm:px-8">
              <div className="flex w-full max-w-5xl flex-1 flex-col items-center justify-center">{children}</div>
            </div>
          </div>
        ) : null}
        {footer ? <div className="border-t border-border px-4 py-4 sm:px-8">{footer}</div> : null}
      </div>
    );
  }

  return (
    <div
      ref={allowResize ? panelRef : undefined}
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--menu-shadow)]",
        allowResize
          ? "fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),380px)] sm:bottom-6 sm:right-6"
          : "w-full",
      )}
      style={allowResize ? panelStyle : undefined}
    >
      <VoiceCallPanelHeader
        peerName={peerName}
        statusLabel={statusLabel}
        pulse={pulse}
        actions={headerActions}
        dragHandleProps={allowResize ? dragHandleProps : undefined}
      />
      {children ? <div className="px-4 py-4">{children}</div> : null}
      {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
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
  const toneClass =
    tone === "decline"
      ? "bg-destructive-solid text-on-solid hover:bg-destructive-solid hover:opacity-90"
      : tone === "accept"
        ? "bg-success-solid text-on-solid hover:bg-success-solid hover:opacity-90"
        : "bg-muted text-foreground hover:bg-surface-hover";

  const btnSize = compact ? "size-12" : "size-14";

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        size="icon-lg"
        className={cn("rounded-full border-0 shadow-[var(--menu-shadow)]", btnSize, toneClass)}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {icon}
      </Button>
      <span className="text-caption font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

export function VoiceCallControlRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center gap-3">{children}</div>;
}
