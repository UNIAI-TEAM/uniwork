// A message of mine that stops trying (refused, or its file gone) while its
// conversation is open is felt (data/haptics.ts › failure) and said to a screen
// reader once: its bubble turns to "Chưa gửi được" in place, which neither a
// glance at the keyboard nor VoiceOver/TalkBack would otherwise notice. A
// message that was already failed when the screen opened says nothing.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo } from "react-native";
import { haptics } from "@/components/ui/haptics";
import type { TimelineMessage } from "@/lib/timeline-display";

export function useSendFailureFeedback(messages: readonly TimelineMessage[]): void {
  const { t } = useTranslation();
  // clientMsgId → whether it was failed when last seen; undefined before the first look.
  const seen = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    const now = new Map<string, boolean>();
    let newlyFailed = false;
    for (const message of messages) {
      if (!message.pending) continue;
      const failed = message.pending.status === "failed";
      now.set(message.pending.clientMsgId, failed);
      if (failed && seen.current?.get(message.pending.clientMsgId) === false) newlyFailed = true;
    }
    seen.current = now;
    if (!newlyFailed) return;
    haptics.failure();
    AccessibilityInfo.announceForAccessibility(t("chat.send_failed"));
  }, [messages, t]);
}
