// "+" on the Chat tab (spec §2.1): message a colleague (resolveDMRoom opens
// the DM, creating it on first use) or browse the workspace's channels.
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, TextInput, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { RoomAvatar } from "@/components/chat/room-avatar";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { Text } from "@/components/ui/text";
import { resolveDMRoom } from "@/data/chat-actions";
import { nicknamesOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { chatRoutes } from "@/lib/chat-routes";
import { displayLabelForChatContact } from "@/lib/rooms-display";
import { foldedIncludes } from "@/lib/search-fold";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

function NewChat({ chat }: { chat: ChatWorkspace }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const members = useQuery(workspaceMembersOptions(chat.wsId));
  const nicknames = useQuery(nicknamesOptions(chat.wsId)).data;
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
      <FlatList
        data={people}
        keyExtractor={(m) => m.user_id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="gap-2 pb-2">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(chatRoutes.channels(chat))}
              className="min-h-14 flex-row items-center gap-3 px-4 active:bg-secondary"
            >
              <Ionicons name="compass-outline" size={24} color={theme.primary} />
              <Text className="text-base font-medium text-primary">{t("chat.channel.directory_title")}</Text>
            </Pressable>
            <View className="px-4">
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder={t("chat.member_search_placeholder")}
                placeholderTextColor={theme.mutedForeground}
                accessibilityLabel={t("chat.member_search_label")}
                autoCorrect={false}
                autoCapitalize="none"
                className="h-11 rounded-lg bg-secondary px-3 text-base text-foreground"
              />
            </View>
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
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("chat.start_dm")}: ${item.label}`}
            disabled={opening !== null}
            onPress={() => open(item.user_id)}
            className="min-h-16 flex-row items-center gap-3 px-4 py-2 active:bg-secondary"
          >
            <RoomAvatar mark={{ kind: "dm", label: item.label, online: false }} size={40} />
            <View className="flex-1">
              <Text className="text-base text-foreground">{item.label}</Text>
              {item.email ? <Text className="text-xs text-muted-foreground">{item.email}</Text> : null}
            </View>
            {opening === item.user_id ? <ActivityIndicator /> : null}
          </Pressable>
        )}
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
