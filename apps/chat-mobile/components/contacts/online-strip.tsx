// The contacts tab's strip of the people online, above the A–Z list; each face
// opens the DM. The only part of the tab that reads the whole presence set.
// A horizontal FlashList (audit P2 Perf): a workspace with hundreds online
// mounts the faces in view, not one 52 pt avatar per person.
// Moved out of the route file, which only composes.
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { shortNameOf } from "@uniwork/core/chat/initials";
import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import type { ContactRow } from "@/lib/contacts-display";
import { userKey } from "@/lib/user-id";

const keyOf = (row: ContactRow) => row.user_id;

const OnlineFace = memo(function OnlineFace({ row, onPress }: { row: ContactRow; onPress: (row: ContactRow) => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={`${row.label}, ${t("chat.presence_online")}`}
      className="mr-2 w-16 items-center gap-1 rounded-lg active:bg-secondary"
    >
      <PersonAvatar name={row.label} avatarUrl={row.avatar_url} size={52} online seed={row.user_id} />
      <Text numberOfLines={1} className="max-w-16 text-caption text-muted-foreground">
        {shortNameOf(row.label)}
      </Text>
    </Pressable>
  );
});

export function OnlineStrip({ people, onPress }: { people: readonly ContactRow[]; onPress: (row: ContactRow) => void }) {
  const { t } = useTranslation();
  // The workspace's one heartbeat (use-chat-realtime.ts) and user.presence frames keep this set.
  const online = usePresenceStore((s) => s.onlineUserIds);
  const rows = useMemo(() => people.filter((row) => online[userKey(row.user_id)]), [people, online]);
  const renderItem: ListRenderItem<ContactRow> = useCallback(({ item }) => <OnlineFace row={item} onPress={onPress} />, [onPress]);
  if (rows.length === 0) return null;
  return (
    <View className="pb-3 pt-2">
      <View className="flex-row items-center gap-1.5 px-4">
        <View className="h-2 w-2 rounded-full bg-success-solid" />
        <Text accessibilityRole="header" className="text-footnote font-semibold text-muted-foreground">
          {`${t("chat.presence_online")} · ${rows.length}`}
        </Text>
      </View>
      <FlashList
        horizontal
        data={rows}
        keyExtractor={keyOf}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10 }}
      />
      <View className="mt-3 h-2 bg-muted" />
    </View>
  );
}
