"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  VoiceCallControlRow,
  VoiceCallFloatingPanel,
  VoiceCallFloatingScrim,
} from "./voice-call-floating-panel";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();

  useEffect(() => {
    if (!alert) return;
    rootRef.current?.focus();
  }, [alert]);

  return (
    <VoiceCallFloatingScrim>
      {alert ? (
        <div
          ref={rootRef}
          role="alertdialog"
          aria-modal={false}
          aria-label={peerName}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className="rounded-2xl"
        >
          <span id={descriptionId} className="sr-only">
            {description ?? statusLabel}
          </span>
          <VoiceCallFloatingPanel
            peerName={peerName}
            statusLabel={statusLabel}
            mode="expanded"
            allowResize={false}
            landmark={false}
            pulse={pulse}
            notice={notice}
          >
            <VoiceCallControlRow>{children}</VoiceCallControlRow>
          </VoiceCallFloatingPanel>
        </div>
      ) : (
        <VoiceCallFloatingPanel
          peerName={peerName}
          statusLabel={statusLabel}
          mode="expanded"
          allowResize={false}
          pulse={pulse}
          notice={notice}
        >
          <VoiceCallControlRow>{children}</VoiceCallControlRow>
        </VoiceCallFloatingPanel>
      )}
    </VoiceCallFloatingScrim>
  );
}
