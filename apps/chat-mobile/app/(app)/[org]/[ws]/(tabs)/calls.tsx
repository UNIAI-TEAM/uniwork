// The calls tab: the call logs of the rooms the person sees in this workspace's
// chat (GET …/chat/call-logs), newest first under day headers, each row the
// web's call-log label; "missed" filters the loaded logs on the client. A tap
// opens the room at that log through the deep-link contract the chat tab (M2a)
// honours; the phone button on the row calls back (M3), voice or video as the
// logged call was.
import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, View } from "react-native";
import { useWorkspaceSlugs } from "@/components/chat/use-chat-workspace";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { callLogsOptions, type CallLog } from "@/data/queries/call-logs";
import { chatNicknamesOptions } from "@/data/queries/contacts";
import { callEngine } from "@/data/calls/call-store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { callLogSections, callLogTitle, callLogView, formatCallClock, formatCallTime, type CallLogFilter } from "@/lib/call-log-display";
import { deepLinkHref } from "@/lib/deep-link";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import { voiceCallKindFromServer } from "@/lib/voice-call";

// shortcut: "missed" reuses the call-log label (en "Missed voice call"); mobile.calls.filter_missed is requested.
const FILTERS: { value: CallLogFilter; label: string }[] = [
  { value: "all", label: "chat.filter_all" },
  { value: "missed", label: "mobile.calls.filter_missed" },
];

/** Inset past the avatar, as a phone's call list draws it. */
function RowSeparator() {
  return <Separator className="ml-[72px] w-auto" />;
}

function CallRow({ log, userId, nicknames, onPress }: { log: CallLog; userId: string; nicknames: Record<string, string>; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const view = callLogView(log, userId);
  const title = callLogTitle(log, nicknames);
  const label = t(view.labelKey, view.labelParams);
  const time = formatCallClock(log.ended_at, i18n.language);
  // The day header is not part of the row, so the spoken label keeps the date of an earlier day.
  const spokenTime = formatCallTime(log.ended_at, i18n.language);
  const tone = view.missed ? theme.destructive : theme.mutedForeground;
  const direction = t(view.direction === "outgoing" ? "mobile.calls.outgoing" : "mobile.calls.incoming");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, direction, label, spokenTime].filter(Boolean).join(", ")}
      className="min-h-[64px] flex-row items-center gap-3 py-2.5 pl-4 pr-1 active:bg-secondary"
    >
      <PersonAvatar name={title} size={44} squircle={log.room_kind !== "dm"} seed={log.room_kind === "dm" ? (log.peer_user_id ?? log.room_id) : log.room_id} />
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className={cn("text-base font-semibold", view.missed ? "text-destructive" : "text-foreground")}>
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
          <Text numberOfLines={1} className={cn("flex-1 text-sm", view.missed ? "text-destructive" : "text-muted-foreground")}>
            {label}
          </Text>
        </View>
      </View>
      <Text className="text-[13px] text-muted-foreground">{time}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("chat.voice_call_call_back")} ${title}`}
        testID="calls-row-callback"
        hitSlop={4}
        onPress={() => void callEngine.startCall(log.room_id, title, voiceCallKindFromServer(log.room_kind), { withCamera: log.video })}
        className="h-11 w-11 items-center justify-center rounded-full active:bg-secondary"
      >
        <Ionicons name={log.video ? "videocam-outline" : "call-outline"} size={22} color={theme.primary} />
      </Pressable>
    </Pressable>
  );
}

export default function CallsTab() {
  const { t, i18n } = useTranslation();
  const { org = "", ws = "" } = useWorkspaceSlugs();
  const current = useWorkspaceStore((s) => s.current);
  // The layout syncs the store after it validated the URL pair; until then there is no workspace to ask about.
  const wsId = current?.orgSlug === org && current.wsSlug === ws ? current.wsId : "";
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [filter, setFilter] = useState<CallLogFilter>("all");
  const logs = useInfiniteQuery({ ...callLogsOptions(wsId), enabled: !!wsId });
  const nicknames = useQuery({ ...chatNicknamesOptions(wsId), enabled: !!wsId });
  const { isStale, isFetching, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = logs;

  // A call ended in a room since the last look shows when the tab comes back.
  useFocusEffect(
    useCallback(() => {
      // refetch() ignores `enabled`, so it waits for a workspace too.
      if (wsId && isStale && !isFetching) void refetch();
    }, [wsId, isStale, isFetching, refetch]),
  );

  const sections = useMemo(
    () =>
      callLogSections(logs.data?.pages.flatMap((page) => page.call_logs) ?? [], {
        userId,
        filter,
        locale: i18n.language,
        labels: { today: t("chat.day_today"), yesterday: t("chat.sidebar_yesterday") },
      }),
    [logs.data, userId, filter, i18n.language, t],
  );

  // MobCalls board: the "Cuộc gọi nhỡ" chip counts the missed calls loaded so far.
  const missedCount = useMemo(
    () => (logs.data?.pages.flatMap((page) => page.call_logs) ?? []).filter((log) => callLogView(log, userId).missed).length,
    [logs.data, userId],
  );

  const empty = logs.isPending ? (
    <View className="items-center py-12">
      <ActivityIndicator />
    </View>
  ) : logs.isError ? (
    <View className="items-center gap-3 px-8 py-12">
      <Text className="text-center text-sm text-destructive">{t("common.error")}</Text>
      <Button variant="outline" onPress={() => void refetch()}>
        <Text>{t("common.retry")}</Text>
      </Button>
    </View>
  ) : (
    <Text className="px-8 py-12 text-center text-sm text-muted-foreground">{t(filter === "missed" ? "mobile.calls.no_missed" : "mobile.calls.empty")}</Text>
  );

  return (
    <View className="flex-1 bg-background">
      <Header large title={t("mobile.tab_calls")}>
        <View className="flex-row gap-2 pb-1 pt-3">
          {FILTERS.map((option) => {
            const selected = filter === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setFilter(option.value)}
                accessibilityRole="button"
                accessibilityLabel={option.value === "missed" && missedCount > 0 ? `${t(option.label)}, ${missedCount}` : t(option.label)}
                accessibilityState={{ selected }}
                hitSlop={{ top: 5, bottom: 5 }}
                className={cn("h-[34px] flex-row items-center gap-1.5 rounded-full px-3.5", selected ? "bg-primary" : "bg-muted active:bg-secondary")}
              >
                <Text className={cn("text-sm font-semibold", selected ? "text-primary-foreground" : "text-foreground")}>{t(option.label)}</Text>
                {option.value === "missed" && missedCount > 0 ? (
                  <View className={cn("h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px]", selected ? "bg-primary-foreground" : "bg-destructive-solid")}>
                    <Text className={cn("text-[11px] font-semibold", selected ? "text-primary" : "text-on-solid")}>{missedCount > 99 ? "99+" : String(missedCount)}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Header>
      <SectionList
        sections={sections}
        keyExtractor={(log) => log.message_id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text accessibilityRole="header" className="bg-background px-4 pb-1.5 pt-3.5 text-[13px] font-semibold text-muted-foreground">
              {section.title}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <CallRow
            log={item}
            userId={userId}
            nicknames={nicknames.data ?? {}}
            onPress={() => router.push(deepLinkHref({ orgSlug: org, wsSlug: ws, roomId: item.room_id, messageId: item.message_id }))}
          />
        )}
        ItemSeparatorComponent={RowSeparator}
        ListEmptyComponent={empty}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
        onEndReachedThreshold={0.5}
        // A short "missed" list reaches its end again after each page, so older pages load until it fills.
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={logs.isRefetching && !isFetchingNextPage}
            onRefresh={() => {
              if (wsId) void refetch();
            }}
          />
        }
        contentContainerClassName={sections.length === 0 ? "flex-grow" : undefined}
      />
    </View>
  );
}
