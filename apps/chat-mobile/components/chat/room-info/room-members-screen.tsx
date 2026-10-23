// "Thành viên" of a conversation, every one of them (its details show the
// first few, then "Xem tất cả" opens this): a search over names and emails
// above a recycling FlashList (audit unvirtualized-secondary-lists — a
// default channel holds the whole workspace, up to a thousand people, which
// the details' ScrollView used to map in full). A tap on someone else opens
// what can be done with them (a DM, report, block), as in the details.
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { router } from "expo-router";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { RoomMemberRow } from "@/components/people/member-rows";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { inAppDmHref } from "@/lib/deep-link";
import { filterRoomMembers, roomMemberRows, type RoomMemberListRow } from "@/lib/room-member-list";
import { ChatHeader } from "../chat-header";
import { MemberSafetySheet, type SafetyPerson } from "../room-safety";
import type { ChatWorkspace } from "../use-chat-workspace";
import { useRoomContext } from "../use-room-context";

const keyOf = (row: RoomMemberListRow) => row.userId;
// A search that still matches the person on top must not scroll the matches above them out of view.
const PINNED_TO_TOP = { disabled: true } as const;
const LIST_PADDING = { paddingHorizontal: 20, paddingBottom: 40 } as const;

export function RoomMembersScreen({ chat, roomId }: { chat: ChatWorkspace; roomId: string }) {
  const { t } = useTranslation();
  const room = useRoomContext(chat, roomId);
  const [query, setQuery] = useState("");
  // The list narrows after the keystroke, not in it.
  const typed = useDeferredValue(query);
  const [menu, setMenu] = useState<SafetyPerson | null>(null);
  const you = t("chat.you");
  const all = useMemo(() => roomMemberRows(room.members, chat.userId, you, room.nameContext), [room.members, chat.userId, you, room.nameContext]);
  const rows = useMemo(() => filterRoomMembers(all, typed), [all, typed]);
  const lastKey = rows.at(-1)?.userId;
  const renderItem: ListRenderItem<RoomMemberListRow> = useCallback(
    ({ item }) => (
      <RoomMemberRow
        userId={item.userId}
        name={item.name}
        email={item.email}
        admin={item.admin}
        last={item.userId === lastKey}
        onOpen={item.self ? undefined : setMenu}
      />
    ),
    [lastKey],
  );

  return (
    <View className="flex-1 bg-background">
      <ChatHeader title={all.length > 0 ? `${t("chat.members_title")} · ${all.length}` : t("chat.members_title")} centered flat />
      <View className="px-5 pb-2">
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("chat.search_members")}
          accessibilityLabel={t("chat.workspace_members_search")}
        />
      </View>
      <FlashList
        data={rows}
        keyExtractor={keyOf}
        renderItem={renderItem}
        maintainVisibleContentPosition={PINNED_TO_TOP}
        contentContainerStyle={LIST_PADDING}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID="room-members"
        ListEmptyComponent={
          typed.trim() ? <Text className="px-1 py-6 text-center text-callout text-muted-foreground">{t("chat.mention_no_results")}</Text> : null
        }
      />
      <MemberSafetySheet
        wsId={chat.wsId}
        person={menu}
        onClose={() => setMenu(null)}
        onMessage={(person) => router.push(inAppDmHref(chat, person.userId))}
      />
    </View>
  );
}
