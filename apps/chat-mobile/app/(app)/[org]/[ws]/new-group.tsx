// "Tạo nhóm" from the new-message screen (MobNewChat board) and "Thêm" from a
// group's details (MobRoomInfo board): name the group and pick its members, or
// pick who joins an existing one. POST …/chat/groups opens the new group;
// POST …/rooms/{id}/members adds people and goes back. The server keeps the
// rules (at least two others, members of the workspace); the screen only
// says what it needs before the button wakes up.
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatHeader } from "@/components/chat/chat-header";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { PersonAvatar } from "@/components/people/person-avatar";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { chatApi } from "@/data/chat-api";
import { chatKeys } from "@/data/queries/chat-keys";
import { nicknamesOptions, roomMembersOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { chatRoutes } from "@/lib/chat-routes";
import { displayLabelForChatContact } from "@/lib/rooms-display";
import { foldedIncludes } from "@/lib/search-fold";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

/** The fewest others a new group takes (chat.create_group_description). */
const GROUP_MIN_OTHERS = 2;

function NewGroup({ chat, roomId }: { chat: ChatWorkspace; roomId: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const members = useQuery(workspaceMembersOptions(chat.wsId));
  const inRoom = useQuery({ ...roomMembersOptions(chat.wsId, roomId ?? ""), enabled: roomId !== null });
  const nicknames = useQuery(nicknamesOptions(chat.wsId)).data;
  const online = usePresenceStore((s) => s.onlineUserIds);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const already = useMemo(() => new Set((inRoom.data ?? []).map((m) => m.user_id.toUpperCase())), [inRoom.data]);
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((m) => m.user_id.toUpperCase() !== chat.userId.toUpperCase())
        .map((m) => ({ ...m, label: displayLabelForChatContact(m, nicknames) }))
        .filter((m) => foldedIncludes(m.label, q) || foldedIncludes(m.email, q))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [members.data, nicknames, chat.userId, q],
  );
  const labelOf = (userId: string) => people.find((p) => p.user_id === userId)?.label ?? (members.data ?? []).find((m) => m.user_id === userId)?.display_name ?? "";
  const toggle = (userId: string) => setPicked((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  const ready = roomId ? picked.length > 0 : name.trim().length > 0 && picked.length >= GROUP_MIN_OTHERS;

  const submit = () => {
    if (!ready || busy) return;
    setBusy(true);
    const run = roomId
      ? chatApi.inviteGroupMembers(chat.wsId, roomId, picked).then((room) => {
          if (!room) throw new Error("chat_group_invite_failed");
          void qc.invalidateQueries({ queryKey: chatKeys.roomMembers(chat.wsId, roomId) });
          void qc.invalidateQueries({ queryKey: chatKeys.rooms(chat.wsId) });
          router.back();
        })
      : chatApi.createGroup(chat.wsId, { name: name.trim(), member_user_ids: picked }).then((room) => {
          if (!room) throw new Error("chat_group_create_failed");
          void qc.invalidateQueries({ queryKey: chatKeys.rooms(chat.wsId) });
          router.replace(chatRoutes.room(chat, room.id));
        });
    run.catch(() => Alert.alert(t("common.error"))).finally(() => setBusy(false));
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background">
      <ChatHeader title={t(roomId ? "chat.add_group_members_title" : "chat.create_group_title")} flat />
      {roomId ? null : (
        <View className="gap-1.5 px-4 pb-2 pt-1">
          <Text className="text-[13px] font-semibold text-muted-foreground">{t("chat.group_name_label")}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("chat.group_name_placeholder")}
            placeholderTextColor={theme.mutedForeground}
            accessibilityLabel={t("chat.group_name_label")}
            maxLength={80}
            className="h-11 rounded-xl border border-border bg-background px-3 text-base text-foreground"
          />
        </View>
      )}
      <View className="px-4 py-2">
        <SearchField value={q} onChangeText={setQ} placeholder={t("chat.member_search_placeholder")} accessibilityLabel={t("chat.member_search_label")} autoCapitalize="none" />
      </View>
      {picked.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 80, flexGrow: 0 }} contentContainerClassName="items-start gap-3 px-4 pb-2 pt-1" accessibilityLabel={t("chat.group_selected_members")}>
          {picked.map((userId) => (
            <Pressable key={userId} accessibilityRole="button" accessibilityLabel={t("chat.remove_member", { name: labelOf(userId) })} onPress={() => toggle(userId)} className="w-14 items-center gap-1">
              <View>
                <PersonAvatar name={labelOf(userId)} size={48} seed={userId} />
                <View className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-muted-foreground">
                  <Ionicons name="close" size={11} color={theme.background} />
                </View>
              </View>
              <Text className="text-[11px] text-foreground" numberOfLines={1}>
                {labelOf(userId)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View className="h-2 bg-muted" />
      <FlatList
        data={people}
        // The rows read the selection and presence: a change re-renders them.
        extraData={[picked, already, online]}
        keyExtractor={(m) => m.user_id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <Text accessibilityRole="header" className="px-4 pb-1.5 pt-3.5 text-[13px] font-semibold text-muted-foreground">
            {t("chat.group_members_label")}
          </Text>
        }
        ListEmptyComponent={members.isPending ? <ActivityIndicator className="py-8" accessibilityLabel={t("chat.loading_members")} /> : null}
        renderItem={({ item, index }) => {
          const isIn = already.has(item.user_id.toUpperCase());
          const selected = picked.includes(item.user_id);
          const isOnline = Boolean(online[item.user_id.trim().toUpperCase()]);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected || isIn, disabled: isIn }}
              accessibilityLabel={[item.label, isIn ? t("chat.already_in_group") : null].filter(Boolean).join(", ")}
              disabled={isIn}
              onPress={() => toggle(item.user_id)}
              className="min-h-16 flex-row items-center gap-3 pl-4 active:bg-secondary"
            >
              <PersonAvatar name={item.label} size={44} online={isOnline} seed={item.user_id} />
              <View className={cn("min-w-0 flex-1 flex-row items-center gap-3 self-stretch py-2 pr-4", index < people.length - 1 && "border-b-hairline border-border")}>
                <View className="min-w-0 flex-1 gap-px">
                  <Text className="text-base font-display font-bold text-foreground" numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {isIn ? t("chat.already_in_group") : item.email}
                  </Text>
                </View>
                <View className={cn("h-6 w-6 items-center justify-center rounded-full border-2", selected || isIn ? "border-primary bg-primary" : "border-border")}>
                  {selected || isIn ? <Ionicons name="checkmark" size={15} color={theme.primaryForeground} /> : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <SafeAreaView edges={["bottom"]} className="border-t border-border bg-background px-4 pt-2.5">
        <Text className="pb-2 text-center text-[13px] text-muted-foreground">
          {picked.length > 0 ? t("chat.mobile.group_selected", { count: picked.length }) : t(roomId ? "chat.add_group_members_hint" : "chat.mobile.group_members_hint")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready, busy }}
          onPress={submit}
          className={cn("mb-2 h-12 flex-row items-center justify-center gap-2 rounded-full", ready ? "bg-primary active:opacity-80" : "bg-muted")}
        >
          {busy ? <ActivityIndicator color={theme.primaryForeground} /> : null}
          <Text className={cn("text-base font-semibold", ready ? "text-primary-foreground" : "text-muted-foreground")}>
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
