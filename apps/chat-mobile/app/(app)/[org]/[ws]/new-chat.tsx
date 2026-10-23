// "+" on the Chat tab (spec §2.1, MobNewChat board): message a colleague
// (resolveDMRoom opens the DM, creating it on first use) or browse the
// workspace's channels.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { Pressable, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { useChatWorkspace, type ChatWorkspace } from "@/components/chat/use-chat-workspace";
import { DmPickRow } from "@/components/people/member-rows";
import { ListLoadError, ListSkeleton } from "@/components/ui/list-states";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { useResolveDM } from "@/data/mutations/rooms";
import { nicknamesOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { chatRoutes } from "@/lib/chat-routes";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { toast } from "@/data/stores/toast-store";
import { pickerPeople } from "@/lib/contacts-display";

function NewChat({ chat }: { chat: ChatWorkspace }) {
  const { t } = useTranslation();
  const resolveDM = useResolveDM(chat.wsId).mutateAsync;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const members = useQuery(workspaceMembersOptions(chat.wsId));
  const nicknames = useQuery(nicknamesOptions(chat.wsId)).data;
  const [q, setQ] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  const people = useMemo(
    () => pickerPeople(members.data ?? [], { currentUserId: chat.userId, nicknames, query: q }),
    [members.data, nicknames, chat.userId, q],
  );

  // Stable, so a row redraws only for its own presence or its own busy state (member-rows.tsx).
  const open = useCallback(
    (userId: string) => {
      setOpening(userId);
      resolveDM(userId)
        .then((room) => {
          if (room) router.replace(chatRoutes.room(chat, room.id));
          else toast.error(t("chat.dm_failed"));
        })
        .catch(() => toast.error(t("chat.dm_failed")))
        .finally(() => setOpening(null));
    },
    [resolveDM, chat, t],
  );

  // A recycling list (audit unvirtualized-secondary-lists) with one stable cell renderer.
  const lastId = people.at(-1)?.user_id;
  const personKey = useCallback((person: (typeof people)[number]) => person.user_id, []);
  const renderPerson: ListRenderItem<(typeof people)[number]> = useCallback(
    ({ item }) => (
      <DmPickRow person={item} last={item.user_id === lastId} busy={opening === item.user_id} disabled={opening !== null} onOpen={open} />
    ),
    [lastId, opening, open],
  );

  return (
    <View className="flex-1 bg-background">
      <ChatHeader title={t("chat.start_dm_title")} flat />
      <View className="px-4 py-2">
        <SearchField
          value={q}
          onChangeText={setQ}
          placeholder={t("chat.member_search_placeholder")}
          accessibilityLabel={t("chat.member_search_label")}
          autoCapitalize="none"
        />
      </View>
      <FlashList
        data={people}
        extraData={opening}
        keyExtractor={personKey}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ disabled: true }}
        ListHeaderComponent={
          <View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(chatRoutes.newGroup(chat))}
              className="min-h-[60px] flex-row items-center gap-3 px-4 active:bg-secondary"
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-tint-blue">
                <Ionicons name="people-outline" size={22} color={theme.tintBlueForeground} />
              </View>
              <Text className="flex-1 text-body font-semibold text-primary">{t("chat.create_group")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(chatRoutes.channels(chat))}
              className="min-h-[60px] flex-row items-center gap-3 px-4 active:bg-secondary"
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-tint-blue">
                <Ionicons name="globe-outline" size={22} color={theme.tintBlueForeground} />
              </View>
              <Text className="flex-1 text-body font-semibold text-primary">{t("chat.channel.directory_title")}</Text>
            </Pressable>
            <View className="mt-1 h-2 bg-muted" />
            <Text accessibilityRole="header" className="px-4 pb-1.5 pt-3.5 text-footnote font-semibold text-muted-foreground">
              {t("chat.workspace_members")}
            </Text>
          </View>
        }
        ListEmptyComponent={
          members.isPending ? (
            <ListSkeleton label={t("chat.loading_members")} />
          ) : members.isError ? (
            <ListLoadError title={t("chat.members_load_failed")} onRetry={() => void members.refetch()} />
          ) : (
            <Text className="px-4 py-8 text-center text-callout text-muted-foreground">
              {q.trim() ? t("chat.workspace_members_no_match", { query: q.trim() }) : t("chat.workspace_members_none")}
            </Text>
          )
        }
        renderItem={renderPerson}
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
