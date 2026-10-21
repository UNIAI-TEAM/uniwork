// Carries out, once per link, what a deep link on the Chat tab asks for
// (lib/deep-link-target.ts decides; this only acts): open a room or a DM, show
// a ringing call's screen, answer it from the notification's Answer button
// after the microphone primer, or — with the server's calls switch off, or a
// call already over — drop the phone's ringing notification and open the room
// where the call is logged.
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { callEngine } from "@/data/calls/call-store";
import { nativeCalls } from "@/data/calls/native-calls";
import { useResolveDM } from "@/data/mutations/rooms";
import { readMobileFlag } from "@/data/remote-config";
import { toast } from "@/data/stores/toast-store";
import { chatRoutes } from "@/lib/chat-routes";
import { deepLinkKey, planDeepLink, type DeepLinkParams } from "@/lib/deep-link-target";
import type { ChatWorkspace } from "./use-chat-workspace";

const CLEARED = { room: undefined, message: undefined, dm: undefined, call: undefined, answer: undefined };

export function useDeepLinkTarget(chat: ChatWorkspace | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const resolveDM = useResolveDM(chat?.wsId ?? "").mutateAsync;
  const params = useLocalSearchParams<DeepLinkParams & Record<string, string>>();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const key = deepLinkKey(params);
    if (!key) {
      handled.current = null;
      return;
    }
    if (!chat || handled.current === key) return;
    handled.current = key;
    router.setParams(CLEARED);
    const plan = planDeepLink(params, readMobileFlag(qc, "unichat_mobile_calls"));
    switch (plan.kind) {
      case "calls-off":
        nativeCalls.cancelIncomingCall(plan.callId);
        toast.info(t("mobile.calls.disabled"));
        router.push(chatRoutes.room(chat, plan.roomId));
        return;
      case "ring":
      case "answer": {
        // Answer explains and asks for the microphone before the call connects; a call ringing here meanwhile
        // (the app reconciling as it comes to the front) leaves that primer open.
        const open =
          plan.kind === "answer"
            ? ensureCallPermissions(false, plan.callId).then(() => callEngine.joinFromPush(plan.roomId, plan.callId))
            : callEngine.ringFromPush(plan.roomId, plan.callId);
        void open.then((ringing) => {
          if (ringing) return;
          // Over (its end push not here yet): the phone's own ringing notification goes too.
          nativeCalls.cancelIncomingCall(plan.callId);
          router.push(chatRoutes.room(chat, plan.roomId));
        });
        return;
      }
      case "room":
        router.push(chatRoutes.room(chat, plan.roomId, plan.messageId));
        return;
      case "dm":
        resolveDM(plan.userId)
          .then((resolved) => {
            if (resolved) router.push(chatRoutes.room(chat, resolved.id));
            else toast.error(t("chat.dm_failed"));
          })
          .catch(() => toast.error(t("chat.dm_failed")));
        return;
      default:
        return;
    }
  }, [chat, params, qc, t, resolveDM]);
}
