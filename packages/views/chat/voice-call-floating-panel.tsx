"use client";

import { type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export type VoiceCallPanelMode = "expanded" | "minimized";

export function voiceCallInitialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return trimmed.charAt(0).toUpperCase();
}

function VoiceCallPeerAvatar({
  peerName,
  size = "md",
  pulse,
}: {
  peerName: string;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}) {
  const px = size === "sm" ? 40 : size === "lg" ? 96 : 72;

  return (
    <div className="relative shrink-0" style={{ width: px, height: px }}>
      {pulse ? (
        <span
          className="absolute inset-0 animate-ping rounded-full bg-primary/15 motion-reduce:animate-none"
          aria-hidden
        />
      ) : null}
      <Avatar className="relative size-full text-body" style={{ width: px, height: px }}>
        <AvatarFallback className="bg-primary/10 text-primary">
          {voiceCallInitialOf(peerName)}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

export function VoiceCallFloatingScrim({ children }: { children: ReactNode }) {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-40 bg-background/35 backdrop-blur-[2px]"
        aria-hidden
      />
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
  onToggleMode,
  allowMinimize = true,
  pulse,
  footer,
  children,
}: {
  peerName: string;
  statusLabel: string;
  mode: VoiceCallPanelMode;
  onToggleMode: () => void;
  allowMinimize?: boolean;
  pulse?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  if (mode === "minimized") {
    return (
      <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
        <div className="flex max-w-[min(100vw-2rem,320px)] items-center gap-3 rounded-full border border-border bg-surface px-3 py-2 shadow-[var(--menu-shadow)]">
          <VoiceCallPeerAvatar peerName={peerName} size="sm" pulse={pulse} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-foreground">{peerName}</p>
            <p className="truncate text-caption tabular-nums text-muted-foreground">{statusLabel}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full"
            aria-label={t("chat.voice_call_expand")}
            onClick={onToggleMode}
          >
            <Maximize2 aria-hidden className="size-4" />
          </Button>
          {footer}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--menu-shadow)]",
        allowMinimize ? "" : "w-full",
      )}
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <VoiceCallPeerAvatar peerName={peerName} size="sm" pulse={pulse} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-body font-semibold text-foreground">{peerName}</p>
          <p className="mt-0.5 truncate text-caption tabular-nums text-muted-foreground">{statusLabel}</p>
        </div>
        {allowMinimize ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full"
            aria-label={t("chat.voice_call_minimize")}
            onClick={onToggleMode}
          >
            <Minimize2 aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
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
  const toneClass =
    tone === "decline"
      ? "bg-destructive text-white hover:bg-destructive/90"
      : tone === "accept"
        ? "bg-success text-white hover:bg-success/90"
        : "bg-muted text-foreground hover:bg-muted/80";

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
