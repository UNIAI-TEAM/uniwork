// The contacts tab's strip of the people online, above the A–Z list; each face
// opens the DM. The only part of the tab that reads the whole presence set.
// Moved out of the route file, which only composes.
import { shortNameOf } from "@uniwork/core/chat/initials";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import type { ContactRow } from "@/lib/contacts-display";
import { userKey } from "@/lib/user-id";

export function OnlineStrip({ people, onPress }: { people: ContactRow[]; onPress: (row: ContactRow) => void }) {
  const { t } = useTranslation();
  // The workspace's one heartbeat (use-chat-realtime.ts) and user.presence frames keep this set.
  const online = usePresenceStore((s) => s.onlineUserIds);
  const rows = useMemo(() => people.filter((row) => online[userKey(row.user_id)]), [people, online]);
  if (rows.length === 0) return null;
  return (
    <View className="pb-3 pt-2">
      <View className="flex-row items-center gap-1.5 px-4">
        <View className="h-2 w-2 rounded-full bg-success-solid" />
        <Text accessibilityRole="header" className="text-footnote font-semibold text-muted-foreground">
          {`${t("chat.presence_online")} · ${rows.length}`}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 pt-2.5">
        {rows.map((row) => (
          <Pressable
            key={row.user_id}
            onPress={() => onPress(row)}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}, ${t("chat.presence_online")}`}
            className="w-16 items-center gap-1 rounded-lg active:bg-secondary"
          >
            <PersonAvatar name={row.label} avatarUrl={row.avatar_url} size={52} online seed={row.user_id} />
            <Text numberOfLines={1} className="max-w-16 text-caption text-muted-foreground">
              {shortNameOf(row.label)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View className="mt-3 h-2 bg-muted" />
    </View>
  );
}
