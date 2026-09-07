"use client";

import {
  VoiceCallControlRow,
  VoiceCallFloatingPanel,
  VoiceCallFloatingScrim,
} from "./voice-call-floating-panel";

export function PreConnectFloatingCall({
  peerName,
  statusLabel,
  pulse,
  children,
}: {
  peerName: string;
  statusLabel: string;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <VoiceCallFloatingScrim>
      <VoiceCallFloatingPanel
        peerName={peerName}
        statusLabel={statusLabel}
        mode="expanded"
        allowResize={false}
        pulse={pulse}
      >
        <VoiceCallControlRow>{children}</VoiceCallControlRow>
      </VoiceCallFloatingPanel>
    </VoiceCallFloatingScrim>
  );
}
