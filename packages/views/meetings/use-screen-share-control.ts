"use client";
import { useState } from "react";
import { useRoomContext, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { markScreenShareStopByUser, screenShareErrorKey, screenShareSupported } from "./screen-share";

/**
 * The screen-share toggle with what the plain LiveKit toggle leaves out: it
 * says why a start failed (a closed picker is not a failure), names the next
 * action, and marks a stop as the viewer's own so it is not announced.
 */
export function useScreenShareControl() {
  const { t } = useTranslation();
  const room = useRoomContext();
  const [supported] = useState(screenShareSupported);
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    onDeviceError: (error) => {
      const key = screenShareErrorKey(error);
      if (key) toast.error(t(key));
    },
  });
  return {
    supported,
    enabled: screen.enabled,
    pending: screen.pending,
    label: screen.enabled ? t("meetings.stopShare") : t("meetings.share"),
    toggle: () => {
      if (screen.enabled) markScreenShareStopByUser(room);
      void screen.toggle();
    },
  };
}
