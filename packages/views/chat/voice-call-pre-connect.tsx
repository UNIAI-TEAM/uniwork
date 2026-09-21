"use client";

import { useEffect, useRef } from "react";
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
  children,
}: {
  peerName: string;
  statusLabel: string;
  pulse?: boolean;
  /**
   * An incoming call interrupts: the panel is announced as an alert dialog
   * and focus lands on its last action (answer), so a keyboard or screen
   * reader user learns about the call the moment it rings.
   */
  alert?: boolean;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!alert) return;
    const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[buttons.length - 1]?.focus();
  }, [alert]);

  return (
    <VoiceCallFloatingScrim>
      <div
        ref={rootRef}
        role={alert ? "alertdialog" : "status"}
        aria-modal={alert ? false : undefined}
        aria-label={`${peerName} — ${statusLabel}`}
      >
        <VoiceCallFloatingPanel
          peerName={peerName}
          statusLabel={statusLabel}
          mode="expanded"
          allowResize={false}
          pulse={pulse}
        >
          <VoiceCallControlRow>{children}</VoiceCallControlRow>
        </VoiceCallFloatingPanel>
      </div>
    </VoiceCallFloatingScrim>
  );
}
