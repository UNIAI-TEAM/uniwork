"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePush } from "@uniwork/core/notifications/push";
import { showWebNotification, useHostFocus, useWebNotificationPermission } from "@uniwork/core/platform";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";

/** Realtime fallback for an open browser; a subscribed browser is notified by the push lane. */
export function useCallNotification(state: VoiceCallOverlayState, href: string): void {
  const { t } = useTranslation();
  const focused = useHostFocus();
  const permission = useWebNotificationPermission();
  const push = usePush();
  const callId = state.status === "incoming" ? state.callId : null;
  const caller = state.status === "incoming" ? state.callerName ?? state.peerName : "";
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!callId || focused || permission !== "granted" || push.isLoading || push.subscribed || seen.current === callId) return;
    seen.current = callId;
    const notification = showWebNotification({
      slug: "", itemId: `call:${callId}`, issueKey: callId, href,
      title: t("notifications.kind.chat_call_incoming", { actor: caller }),
      body: t("notifications.browser.call_hint"),
    });
    // A call that ended, was answered elsewhere or is now visible must stop ringing outside the page.
    return () => notification?.close();
  }, [callId, caller, focused, href, permission, push.isLoading, push.subscribed, t]);
}
