// The channel directory (spec §2.1, MobChannels board): the workspace's
// public channels the reader has not joined; a tap joins one and opens it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { RoomAvatar } from "@/components/chat/room-avatar";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { joinChannel } from "@/data/chat-actions";
import { discoverableChannelsOptions } from "@/data/queries/chat";
import { chatRoutes } from "@/lib/chat-routes";
import { foldedIncludes } from "@/lib/search-fold";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

function ChannelDirectory({ chat }: { chat: ChatWorkspace }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const channels = useQuery(discoverableChannelsOptions(chat.wsId));
  const [q, setQ] = useState("");
  const [joining, setJoining] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const shown = useMemo(
    () => (channels.data ?? []).filter((c) => foldedIncludes(c.name, q) || foldedIncludes(c.topic ?? "", q)),
    [channels.data, q],
  );

  const join = (roomId: string, name: string) => {
    setJoining(roomId);
    joinChannel(qc, chat.wsId, roomId)
      .then(() => router.replace(chatRoutes.room(chat, roomId)))
      .catch(() => Alert.alert(t("chat.channel.join_failed", { name })))
      .finally(() => setJoining(null));
  };

  return (
    <View className="flex-1 bg-background">
      <ChatHeader title={t("chat.channel.directory_title")} />
      <View className="px-4 py-2">
        <SearchField value={q} onChangeText={setQ} placeholder={t("chat.channel.directory_search")} accessibilityLabel={t("chat.channel.directory_search")} />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pt-1"
        onRefresh={() => {
          setPulling(true);
          void channels.refetch().finally(() => setPulling(false));
        }}
        refreshing={pulling}
        ListEmptyComponent={
          channels.isPending ? (
            <ActivityIndicator className="py-8" accessibilityLabel={t("chat.channel.directory_loading")} />
          ) : channels.isError ? (
            <Text className="px-4 py-8 text-center text-sm text-muted-foreground">{t("chat.channel.directory_load_failed")}</Text>
          ) : (
            <View className="gap-1 px-8 py-8">
              <Text className="text-center text-base font-bold text-foreground">
                {q.trim() ? t("chat.channel.directory_no_match_title", { query: q.trim() }) : t("chat.channel.directory_none_title")}
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                {q.trim() ? t("chat.channel.directory_no_match_hint") : t("chat.channel.directory_none_hint")}
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.channel.join_named", { name: item.name })}
            accessibilityState={{ busy: joining === item.id }}
            disabled={joining !== null}
            onPress={() => join(item.id, item.name)}
            className="min-h-[68px] flex-row items-center gap-3 pl-4 active:bg-secondary"
          >
            <RoomAvatar mark={{ kind: "channel" }} size={44} seed={item.id} />
            <View
              className={cn(
                "min-w-0 flex-1 flex-row items-center gap-3 self-stretch py-2 pr-4",
                index < shown.length - 1 && "border-b-hairline border-border",
              )}
            >
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base font-bold text-foreground" numberOfLines={1}>
                  #{item.name}
                </Text>
                <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                  {item.topic || t("chat.channel.topic_empty")}
                </Text>
              </View>
              {joining === item.id ? (
                <View className="h-[34px] w-[88px] items-center justify-center rounded-full bg-muted">
                  <ActivityIndicator color={theme.primary} />
                </View>
              ) : (
                <View className="h-[34px] justify-center rounded-full bg-tint-blue px-3.5">
                  <Text className="text-sm font-semibold text-primary">{t("chat.channel.join")}</Text>
                </View>
              )}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

export default function ChannelsScreen() {
  const chat = useChatWorkspace();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {chat ? <ChannelDirectory chat={chat} /> : null}
    </>
  );
}
