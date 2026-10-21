// Carries out, once per link, what a deep link on the Chat tab asks for
// (lib/deep-link-target.ts decides; this only acts): open a room, open a DM
// once the person agrees (a link from a page, a message or another app must not
// create conversations on the account by itself; the app's own "Message" taps
// are vouched for in memory, lib/deep-link.ts › inAppDmHref, and open at once), show
// a ringing call's screen, answer it after the microphone primer when the
// notification's own Answer button opened the app (nativeCalls.takeAnsweredCall:
// a token only that PendingIntent carries, so no URL, page or other app can
// answer for the person), or — with the server's calls switch off, or a call
// already over — drop the phone's ringing notification and open the room where
// the call is logged.
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { callEngine } from "@/data/calls/call-store";
import { nativeCalls } from "@/data/calls/native-calls";
import { useResolveDM } from "@/data/mutations/rooms";
import { workspaceMembersOptions } from "@/data/queries/chat";
import { readMobileFlag } from "@/data/remote-config";
import { toast } from "@/data/stores/toast-store";
import { chatRoutes } from "@/lib/chat-routes";
import { takeInAppDm } from "@/lib/deep-link";
import { deepLinkKey, planDeepLink, type DeepLinkParams } from "@/lib/deep-link-target";
import { sameUser } from "@/lib/user-id";
import type { ChatWorkspace } from "./use-chat-workspace";

const CLEARED = { room: undefined, message: undefined, dm: undefined, call: undefined };

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
        // The ringing notification may have opened the app over the lock screen; no call shows now, so the lock comes back.
        nativeCalls.releaseLockScreen();
        toast.info(t("mobile.calls.disabled"));
        router.push(chatRoutes.room(chat, plan.roomId));
        return;
      case "ring": {
        // Answer explains and asks for the microphone before the call connects; a call ringing here meanwhile
        // (the app reconciling as it comes to the front) leaves that primer open.
        const open = nativeCalls.takeAnsweredCall(plan.callId)
          ? ensureCallPermissions(false, plan.callId).then(() => callEngine.joinFromPush(plan.roomId, plan.callId))
          : callEngine.ringFromPush(plan.roomId, plan.callId);
        void open.then((ringing) => {
          if (ringing) return;
          // Over (its end push not here yet): the phone's own ringing notification goes too. The app may be showing
          // over the lock screen for that ring; the call screen never came, so the room must not open past the lock
          // (the engine's sync only releases it on a change of call, and nothing changed).
          nativeCalls.cancelIncomingCall(plan.callId);
          nativeCalls.releaseLockScreen();
          router.push(chatRoutes.room(chat, plan.roomId));
        });
        return;
      }
      case "room":
        router.push(chatRoutes.room(chat, plan.roomId, plan.messageId));
        return;
      case "dm": {
        const open = () =>
          resolveDM(plan.userId)
            .then((resolved) => {
              if (resolved) router.push(chatRoutes.room(chat, resolved.id));
              else toast.error(t("chat.dm_failed"));
            })
            .catch(() => toast.error(t("chat.dm_failed")));
        // The person's own tap in the app (Contacts, room info): nothing to confirm.
        if (takeInAppDm(plan.userId)) {
          void open();
          return;
        }
        // Resolving may create the room, a write on the account: the person decides, knowing with whom.
        const member = qc.getQueryData(workspaceMembersOptions(chat.wsId).queryKey)?.find((m) => sameUser(m.user_id, plan.userId));
        const name = member?.display_name || member?.email;
        Alert.alert(t("mobile.security.dm_confirm_title"), name ? t("mobile.security.dm_confirm_body", { name }) : t("mobile.security.dm_confirm_body_unknown"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("mobile.security.dm_confirm_open"), onPress: () => void open() },
        ]);
        return;
      }
      default:
        return;
    }
  }, [chat, params, qc, t, resolveDM]);
}
