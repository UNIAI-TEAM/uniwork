"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { VoiceCallFloatingScrim, VoiceCallPeerAvatar } from "./voice-call-floating-panel";

/**
 * The call card before (and after) the media connects: who, the state in one
 * line, anything to know first, and the big actions. Dark in both themes —
 * the plane is painted here in the page theme and its content reads the dark
 * palette (see --surface-emphasis in tokens.css).
 */
export function PreConnectFloatingCall({
  peerName,
  statusLabel,
  pulse,
  alert = false,
  notice,
  description,
  children,
}: {
  peerName: string;
  statusLabel: string;
  pulse?: boolean;
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
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();

  useEffect(() => {
    if (!alert) return;
    rootRef.current?.focus();
  }, [alert]);

  return (
    <VoiceCallFloatingScrim>
      <div
        ref={rootRef}
        role={alert ? "alertdialog" : "region"}
        aria-modal={alert ? false : undefined}
        aria-label={alert ? peerName : t("chat.voice_call_region_label", { name: peerName, status: statusLabel })}
        aria-describedby={alert ? descriptionId : undefined}
        tabIndex={alert ? -1 : undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-meeting-bar-border bg-surface-emphasis shadow-floating"
      >
        <div className="dark flex flex-col items-center px-5 pt-7 pb-6 text-center text-foreground">
          {alert ? (
            <span id={descriptionId} className="sr-only">
              {description ?? statusLabel}
            </span>
          ) : null}
          <VoiceCallPeerAvatar peerName={peerName} size="lg" pulse={pulse} pulseTone={alert ? "success" : "brand"} />
          <p className="mt-5 w-full font-display text-title-lg font-bold break-words text-foreground">{peerName}</p>
          <p role="status" className="mt-1 text-body text-pretty text-muted-foreground">
            {statusLabel}
          </p>
          {notice ? <div className="mt-4 w-full text-left">{notice}</div> : null}
          <div className="mt-6 flex flex-wrap justify-center gap-x-14 gap-y-4">{children}</div>
        </div>
      </div>
    </VoiceCallFloatingScrim>
  );
}
