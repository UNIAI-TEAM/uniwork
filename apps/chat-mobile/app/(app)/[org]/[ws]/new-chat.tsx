// "+" on the Chat tab (spec §2.1, MobNewChat board): message a colleague
// (resolveDMRoom opens the DM, creating it on first use) or browse the
// workspace's channels.
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { PersonAvatar } from "@/components/people/person-avatar";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { resolveDMRoom } from "@/data/chat-actions";
import { nicknamesOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { chatRoutes } from "@/lib/chat-routes";
import { displayLabelForChatContact } from "@/lib/rooms-display";
import { foldedIncludes } from "@/lib/search-fold";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

function NewChat({ chat }: { chat: ChatWorkspace }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const members = useQuery(workspaceMembersOptions(chat.wsId));
  const nicknames = useQuery(nicknamesOptions(chat.wsId)).data;
  const online = usePresenceStore((s) => s.onlineUserIds);
  const [q, setQ] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((m) => m.user_id.toUpperCase() !== chat.userId.toUpperCase())
        .map((m) => ({ ...m, label: displayLabelForChatContact(m, nicknames) }))
        .filter((m) => foldedIncludes(m.label, q) || foldedIncludes(m.email, q))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [members.data, nicknames, chat.userId, q],
  );

  const open = (userId: string) => {
    setOpening(userId);
    resolveDMRoom(qc, chat.wsId, userId)
      .then((room) => {
        if (room) router.replace(chatRoutes.room(chat, room.id));
        else Alert.alert(t("chat.dm_failed"));
      })
      .catch(() => Alert.alert(t("chat.dm_failed")))
      .finally(() => setOpening(null));
  };

  return (
    <View className="flex-1 bg-background">
      <ChatHeader title={t("chat.start_dm_title")} />
      <View className="px-4 py-2">
        <SearchField
          value={q}
          onChangeText={setQ}
          placeholder={t("chat.member_search_placeholder")}
          accessibilityLabel={t("chat.member_search_label")}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        data={people}
        keyExtractor={(m) => m.user_id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(chatRoutes.channels(chat))}
              className="min-h-[60px] flex-row items-center gap-3 px-4 active:bg-secondary"
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-tint-blue">
                <Ionicons name="compass-outline" size={22} color={theme.tintBlueForeground} />
              </View>
              <Text className="flex-1 text-base font-semibold text-primary">{t("chat.channel.directory_title")}</Text>
            </Pressable>
            <View className="mt-1 h-2 bg-muted" />
            <Text accessibilityRole="header" className="px-4 pb-1.5 pt-3.5 text-[13px] font-semibold text-muted-foreground">
              {t("chat.workspace_members")}
            </Text>
          </View>
        }
        ListEmptyComponent={
          members.isPending ? (
            <ActivityIndicator className="py-8" accessibilityLabel={t("chat.loading_members")} />
          ) : (
            <Text className="px-4 py-8 text-center text-sm text-muted-foreground">
              {q.trim() ? t("chat.workspace_members_no_match", { query: q.trim() }) : t("chat.workspace_members_none")}
            </Text>
          )
        }
        renderItem={({ item, index }) => {
          const isOnline = Boolean(online[item.user_id.trim().toUpperCase()]);
          const busy = opening === item.user_id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={[`${t("chat.start_dm")}: ${item.label}`, isOnline ? t("chat.presence_online") : null].filter(Boolean).join(", ")}
              accessibilityState={{ busy }}
              disabled={opening !== null}
              onPress={() => open(item.user_id)}
              className={cn("min-h-16 flex-row items-center gap-3 pl-4 active:bg-secondary", busy && "bg-muted")}
            >
              <PersonAvatar name={item.label} size={44} online={isOnline} />
              <View
                className={cn(
                  "min-w-0 flex-1 flex-row items-center gap-3 self-stretch py-2 pr-4",
                  index < people.length - 1 && "border-b-hairline border-border",
                )}
              >
                <View className="min-w-0 flex-1 gap-px">
                  <Text className="text-base font-bold text-foreground" numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.email ? (
                    <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                      {item.email}
                    </Text>
                  ) : null}
                </View>
                {busy ? <ActivityIndicator color={theme.primary} /> : null}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

export default function NewChatScreen() {
  const chat = useChatWorkspace();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat ? <NewChat chat={chat} /> : null}
    </>
  );
}
