// One row of the calls tab (app/(app)/[org]/[ws]/(tabs)/calls.tsx): who, which
// way, how it went and when, a tap opens the room at the log; the phone button
// calls back, voice or video as the logged call was, while the server's kill
// switch leaves calling on. Moved out of the route file, which only composes.
import { Ionicons } from "@expo/vector-icons";
import { voiceCallKindFromServer } from "@uniwork/core/chat/voice-call-kind";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { useLargeText } from "@/components/ui/a11y";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { callEngine } from "@/data/calls/call-store";
import type { CallLog } from "@/data/queries/call-logs";
import { useMobileFlag } from "@/data/remote-config";
import { callLogTitle, callLogView, formatCallClock, formatCallTime } from "@/lib/call-log-display";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Inset past the avatar, as a phone's call list draws it. */
export function CallLogSeparator() {
  return <Separator className="ml-[72px] w-auto" />;
}

export function CallLogRow({
  log,
  userId,
  nicknames,
  onPress,
}: {
  log: CallLog;
  userId: string;
  nicknames: Record<string, string>;
  onPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  // The server's kill switch (data/remote-config.ts): off keeps the history, hides calling back.
  const callsOn = useMobileFlag("unichat_mobile_calls");
  const view = callLogView(log, userId);
  const title = callLogTitle(log, nicknames);
  const label = t(view.labelKey, view.labelParams);
  const time = formatCallClock(log.ended_at, i18n.language);
  // The day header is not part of the row, so the spoken label keeps the date of an earlier day.
  const spokenTime = formatCallTime(log.ended_at, i18n.language);
  const tone = view.missed ? theme.destructive : theme.mutedForeground;
  const direction = t(view.direction === "outgoing" ? "mobile.calls.outgoing" : "mobile.calls.incoming");
  // At the accessibility text sizes the name and the outcome take two lines each and the time moves under them.
  const large = useLargeText();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, direction, label, spokenTime].filter(Boolean).join(", ")}
      className="min-h-[64px] flex-row items-center gap-3 py-2.5 pl-4 pr-1 active:bg-secondary"
    >
      <PersonAvatar
        name={title}
        size={44}
        squircle={log.room_kind !== "dm"}
        seed={log.room_kind === "dm" ? (log.peer_user_id ?? log.room_id) : log.room_id}
      />
      <View className="flex-1 gap-0.5" testID="call-log-text">
        <Text numberOfLines={large ? 2 : 1} className={cn("text-body font-semibold", view.missed ? "text-destructive" : "text-foreground")}>
          {title}
        </Text>
        <View className="flex-row items-center gap-1">
          <Ionicons
            name={view.direction === "outgoing" ? "arrow-up-outline" : "arrow-down-outline"}
            size={14}
            color={tone}
            style={{ transform: [{ rotate: "45deg" }] }}
          />
          <Ionicons name={log.video ? "videocam-outline" : "call-outline"} size={14} color={tone} />
          <Text numberOfLines={large ? 2 : 1} className={cn("flex-1 text-callout", view.missed ? "text-destructive" : "text-muted-foreground")}>
            {label}
          </Text>
        </View>
        {large ? (
          <Text className="text-footnote text-muted-foreground" testID="call-log-time">
            {time}
          </Text>
        ) : null}
      </View>
      {large ? null : (
        <Text className="text-footnote text-muted-foreground" testID="call-log-time">
          {time}
        </Text>
      )}
      {callsOn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("chat.voice_call_call_back")} ${title}`}
          testID="calls-row-callback"
          hitSlop={4}
          onPress={() =>
            void ensureCallPermissions(log.video).then(() =>
              callEngine.startCall(log.room_id, title, voiceCallKindFromServer(log.room_kind), { withCamera: log.video }),
            )
          }
          className="h-11 w-11 items-center justify-center rounded-full active:bg-secondary"
        >
          <Ionicons name={log.video ? "videocam-outline" : "call-outline"} size={22} color={theme.primary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
