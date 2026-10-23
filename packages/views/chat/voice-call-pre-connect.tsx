"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { VoiceCallCallerBadge, VoiceCallFace, VoiceCallWorkspaceChip, useVoiceCallFaceIsSquare } from "./voice-call-face";
import { VOICE_CALL_PLANE, VoiceCallFloatingScrim } from "./voice-call-floating-panel";

/* Two staggered rings on a slow 1.8s swell; ping's own 1s reads as alarm. */
const PULSE_DELAYS = ["0s", "0.9s"] as const;

/** The ringing face: rings swell out from behind it, and under reduced motion a still halo stands in. */
function RingingFace({ peerName, tone }: { peerName: string; tone?: "incoming" | "outgoing" }) {
  const square = useVoiceCallFaceIsSquare();
  const ring = tone === "incoming" ? "border-call-ring/70" : "border-call-speaking/70";
  // The rings keep the face's shape: a squircle's corner scales with its box.
  const halo = square ? "rounded-[34px]" : "rounded-full";
  const shape = square ? "rounded-[20px]" : "rounded-full";
  return (
    <div className="relative mt-4.5 flex size-30 items-center justify-center">
      {tone ? (
        <>
          <span aria-hidden className={cn("absolute inset-1.5 border-2 opacity-50 motion-safe:hidden", ring, halo)} />
          {PULSE_DELAYS.map((delay) => (
            <span
              key={delay}
              aria-hidden
              // Ping swells to twice its size: from 64px it ends at the 1.35× of the 96px face the canvas draws.
              className={cn("absolute inset-7 border-3 motion-safe:animate-ping motion-reduce:hidden", ring, shape)}
              style={{ animationDuration: "1.8s", animationDelay: delay }}
            />
          ))}
        </>
      ) : null}
      <VoiceCallFace peerName={peerName} size="lg" />
      <VoiceCallCallerBadge />
    </div>
  );
}

/**
 * The call card before (and after) the media connects: the workspace, who,
 * the state in one line, anything to know first, and the big actions. Dark
 * in both themes — the plane is painted here and its content reads the dark
 * palette (see --call-plane in tokens.css).
 */
export function PreConnectFloatingCall({
  peerName,
  statusLabel,
  pulse,
  alert = false,
  notice,
  description,
  badge,
  children,
}: {
  peerName: string;
  statusLabel: string;
  /** It is ringing: the face pulses, teal for a call coming in, blue for one going out. */
  pulse?: "incoming" | "outgoing";
  /**
   * An incoming call interrupts: the panel is an alert dialog and takes
   * focus itself — not its answer button — so a stray Space or Enter
   * cannot pick up the call and open the microphone.
   */
  alert?: boolean;
  /** Something to know before acting: a recording in progress, a blocked mic. */
  notice?: ReactNode;
  /** What the alert dialog says when it takes focus; the status line by default. */
  description?: string;
  /** The ended card: how it ended, as a small mark on the face (and a smaller face). */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  const ended = badge !== undefined;

  useEffect(() => {
    if (!alert) return;
    rootRef.current?.focus();
  }, [alert]);

  return (
    <VoiceCallFloatingScrim className="max-w-[336px]">
      <div
        ref={rootRef}
        role={alert ? "alertdialog" : "region"}
        aria-modal={alert ? false : undefined}
        aria-label={alert ? peerName : t("chat.voice_call_region_label", { name: peerName, status: statusLabel })}
        aria-describedby={alert ? descriptionId : undefined}
        tabIndex={alert ? -1 : undefined}
        className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto", VOICE_CALL_PLANE)}
      >
        <div className={cn("dark flex flex-col items-center px-5 pt-4.5 text-center text-foreground", ended ? "pb-5.5" : "pb-6")}>
          {alert ? (
            <span id={descriptionId} className="sr-only">
              {description ?? statusLabel}
            </span>
          ) : null}
          <VoiceCallWorkspaceChip className="self-start" />
          {ended ? (
            <div className="relative mt-4">
              <VoiceCallFace peerName={peerName} size="md" />
              {badge}
            </div>
          ) : (
            <RingingFace peerName={peerName} tone={pulse} />
          )}
          <h2 className="mt-3.5 w-full font-display text-title-lg font-bold break-words text-foreground">{peerName}</h2>
          <p
            role="status"
            className={cn("mt-1 text-body text-pretty", ended ? "min-h-10 text-foreground/90" : "text-call-muted-foreground")}
          >
            {statusLabel}
          </p>
          {notice ? <div className="mt-4.5 w-full">{notice}</div> : null}
          <div
            className={cn(
              "flex flex-wrap justify-center gap-y-4",
              ended ? "mt-4.5 gap-x-14" : notice ? "mt-6 gap-x-16" : "mt-7 gap-x-16",
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </VoiceCallFloatingScrim>
  );
}
