"use client";

import { LiveKitRoom, RoomAudioRenderer, TrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";

export type VoiceCallOverlayState =
  | { status: "idle" }
  | {
      status: "incoming";
      callId: string;
      matrixRoomId: string;
      peerName: string;
    }
  | {
      status: "active";
      callId: string;
      matrixRoomId: string;
      peerName: string;
      token: string;
      url: string;
      outgoing: boolean;
    };

function VoiceCallSession({
  peerName,
  outgoing,
  onEnd,
}: {
  peerName: string;
  outgoing: boolean;
  onEnd: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-[var(--menu-shadow)]">
      <RoomAudioRenderer />
      <div className="min-w-0">
        <p className="truncate text-body font-medium text-foreground">{peerName}</p>
        <p className="text-caption text-muted-foreground">
          {outgoing ? t("chat.voice_call_calling") : t("chat.voice_call_connected")}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <TrackToggle
          source={Track.Source.Microphone}
          showIcon
          className="inline-flex size-10 items-center justify-center rounded-lg border border-border bg-background"
        />
        <Button type="button" variant="destructive" size="icon" aria-label={t("chat.voice_call_end")} onClick={onEnd}>
          <PhoneOff aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function VoiceCallOverlay({
  state,
  onAccept,
  onDecline,
  onEnd,
}: {
  state: VoiceCallOverlayState;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
}) {
  const { t } = useTranslation();

  if (state.status === "incoming") {
    return (
      <Dialog open onOpenChange={(open) => !open && onDecline()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("chat.voice_call_incoming_title")}</DialogTitle>
            <DialogDescription>
              {t("chat.voice_call_incoming_body", { name: state.peerName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onDecline}>
              {t("chat.voice_call_decline")}
            </Button>
            <Button type="button" onClick={onAccept}>
              {t("chat.voice_call_accept")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (state.status !== "active") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-sm">
        <LiveKitRoom
          serverUrl={state.url}
          token={state.token}
          connect
          audio
          video={false}
          onDisconnected={onEnd}
        >
          <VoiceCallSession peerName={state.peerName} outgoing={state.outgoing} onEnd={onEnd} />
        </LiveKitRoom>
      </div>
    </div>
  );
}
