// "Tạo nhóm" from the new-message screen (MobNewChat board) and "Thêm" from a
// group's details (MobRoomInfo board): name the group and pick its members, or
// pick who joins an existing one. POST …/chat/groups opens the new group;
// POST …/rooms/{id}/members adds people and goes back. The server keeps the
// rules (at least two others, members of the workspace); the screen only
// says what it needs before the button wakes up.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatHeader } from "@/components/chat/chat-header";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { GroupPickRow } from "@/components/people/member-rows";
import { PersonAvatar } from "@/components/people/person-avatar";
import { ListLoadError, ListSkeleton } from "@/components/ui/list-states";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { useCreateGroup, useInviteGroupMembers } from "@/data/mutations/rooms";
import { nicknamesOptions, roomMembersOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { chatRoutes } from "@/lib/chat-routes";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";
import { toast } from "@/data/stores/toast-store";
import { pickerPeople } from "@/lib/contacts-display";
import { userKey } from "@/lib/user-id";

/** The fewest others a new group takes (chat.create_group_description). */
const GROUP_MIN_OTHERS = 2;

function NewGroup({ chat, roomId }: { chat: ChatWorkspace; roomId: string | null }) {
  const { t } = useTranslation();
  const createGroup = useCreateGroup(chat.wsId).mutateAsync;
  const inviteMembers = useInviteGroupMembers(chat.wsId, roomId ?? "").mutateAsync;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const members = useQuery(workspaceMembersOptions(chat.wsId));
  const inRoom = useQuery({ ...roomMembersOptions(chat.wsId, roomId ?? ""), enabled: roomId !== null });
  const nicknames = useQuery(nicknamesOptions(chat.wsId)).data;
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const already = useMemo(() => new Set((inRoom.data ?? []).map((m) => userKey(m.user_id))), [inRoom.data]);
  const people = useMemo(
    () => pickerPeople(members.data ?? [], { currentUserId: chat.userId, nicknames, query: q }),
    [members.data, nicknames, chat.userId, q],
  );
  const labelOf = (userId: string) =>
    people.find((p) => p.user_id === userId)?.label ?? (members.data ?? []).find((m) => m.user_id === userId)?.display_name ?? "";
  // Stable, so a row redraws only for its own presence or selection (member-rows.tsx).
  const toggle = useCallback(
    (userId: string) => setPicked((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId])),
    [],
  );
  const ready = roomId ? picked.length > 0 : name.trim().length > 0 && picked.length >= GROUP_MIN_OTHERS;

  // A recycling list (audit unvirtualized-secondary-lists): one stable cell renderer, the selection as a Set.
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const lastId = people.at(-1)?.user_id;
  const personKey = useCallback((person: (typeof people)[number]) => person.user_id, []);
  const renderPerson: ListRenderItem<(typeof people)[number]> = useCallback(
    ({ item }) => (
      <GroupPickRow
        person={item}
        last={item.user_id === lastId}
        isIn={already.has(userKey(item.user_id))}
        selected={pickedSet.has(item.user_id)}
        onToggle={toggle}
      />
    ),
    [lastId, already, pickedSet, toggle],
  );

  const submit = () => {
    if (!ready || busy) return;
    setBusy(true);
    const run = roomId
      ? inviteMembers(picked).then(() => router.back())
      : createGroup({ name: name.trim(), memberUserIds: picked }).then((room) => router.replace(chatRoutes.room(chat, room.id)));
    run.catch(() => toast.error(t("common.error"))).finally(() => setBusy(false));
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background">
      <ChatHeader title={t(roomId ? "chat.add_group_members_title" : "chat.create_group_title")} flat />
      {roomId ? null : (
        <View className="gap-1.5 px-4 pb-2 pt-1">
          <Text className="text-footnote font-semibold text-muted-foreground">{t("chat.group_name_label")}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("chat.group_name_placeholder")}
            placeholderTextColor={theme.mutedForeground}
            accessibilityLabel={t("chat.group_name_label")}
            maxLength={80}
            className="min-h-11 rounded-xl border border-border bg-background px-3 py-2.5 text-body text-foreground"
          />
        </View>
      )}
      <View className="px-4 py-2">
        <SearchField
          value={q}
          onChangeText={setQ}
          placeholder={t("chat.member_search_placeholder")}
          accessibilityLabel={t("chat.member_search_label")}
          autoCapitalize="none"
        />
      </View>
      {picked.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ height: 80, flexGrow: 0 }}
          contentContainerClassName="items-start gap-3 px-4 pb-2 pt-1"
          accessibilityLabel={t("chat.group_selected_members")}
        >
          {picked.map((userId) => (
            <Pressable
              key={userId}
              accessibilityRole="button"
              accessibilityLabel={t("chat.remove_member", { name: labelOf(userId) })}
              onPress={() => toggle(userId)}
              className="w-14 items-center gap-1"
            >
              <View>
                <PersonAvatar name={labelOf(userId)} size={48} seed={userId} />
                <View
                  className={cn(
                    "absolute -right-1 -top-1 h-5 w-5 items-center justify-center",
                    "rounded-full border-2 border-background bg-muted-foreground",
                  )}
                >
                  <Ionicons name="close" size={11} color={theme.background} />
                </View>
              </View>
              <Text className="text-meta text-foreground" numberOfLines={1}>
                {labelOf(userId)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View className="h-2 bg-muted" />
      <FlashList
        data={people}
        // The rows read the selection (a Set: one lookup per row); each reads its own presence.
        extraData={pickedSet}
        keyExtractor={personKey}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ disabled: true }}
        ListHeaderComponent={
          <Text accessibilityRole="header" className="px-4 pb-1.5 pt-3.5 text-footnote font-semibold text-muted-foreground">
            {t("chat.group_members_label")}
          </Text>
        }
        ListEmptyComponent={
          members.isPending ? (
            <ListSkeleton label={t("chat.loading_members")} />
          ) : members.isError ? (
            <ListLoadError title={t("chat.members_load_failed")} onRetry={() => void members.refetch()} />
          ) : null
        }
        renderItem={renderPerson}
      />
      <SafeAreaView edges={["bottom"]} className="border-t border-border bg-background px-4 pt-2.5">
        <Text className="pb-2 text-center text-footnote text-muted-foreground">
          {picked.length > 0
            ? t("chat.mobile.group_selected", { count: picked.length })
            : t(roomId ? "chat.add_group_members_hint" : "chat.mobile.group_members_hint")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready, busy }}
          onPress={submit}
          className={cn(
            "mb-2 min-h-12 flex-row items-center justify-center gap-2 rounded-full py-3",
            ready ? "bg-primary active:opacity-80" : "bg-muted",
          )}
        >
          {busy ? <ActivityIndicator accessibilityLabel={t("common.loading")} color={theme.primaryForeground} /> : null}
          <Text className={cn("text-body font-semibold", ready ? "text-primary-foreground" : "text-muted-foreground")}>
            {busy ? t(roomId ? "chat.inviting_members" : "chat.creating_group") : t(roomId ? "chat.invite_members" : "chat.start_group")}
          </Text>
        </Pressable>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

export default function NewGroupScreen() {
  const chat = useChatWorkspace();
  const { room } = useLocalSearchParams<{ room?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat ? <NewGroup chat={chat} roomId={room || null} /> : null}
    </>
  );
}
