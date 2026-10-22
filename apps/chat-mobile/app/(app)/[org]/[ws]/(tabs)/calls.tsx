// The calls tab: the call logs of the rooms the person sees in this workspace's
// chat (GET …/chat/call-logs), newest first under day headers, each row the
// web's call-log label; "missed" filters the loaded logs on the client. A tap
// opens the room at that log through the deep-link contract the chat tab
// honours; the phone button on the row calls back, voice or video as the
// logged call was.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, RefreshControl, SectionList, View } from "react-native";
import { CallLogFilters } from "@/components/calls/call-log-filters";
import { CallLogRow, CallLogSeparator } from "@/components/calls/call-log-row";
import { useWorkspaceSlugs } from "@/components/chat/use-chat-workspace";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { callLogsOptions } from "@/data/queries/call-logs";
import { nicknamesOptions } from "@/data/queries/chat";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { callLogSections, type CallLogFilter, missedCallCount } from "@/lib/call-log-display";
import { deepLinkHref } from "@/lib/deep-link";

export default function CallsTab() {
  const { t, i18n } = useTranslation();
  const { org = "", ws = "" } = useWorkspaceSlugs();
  const current = useWorkspaceStore((s) => s.current);
  // The layout syncs the store after it validated the URL pair; until then there is no workspace to ask about.
  const wsId = current?.orgSlug === org && current.wsSlug === ws ? current.wsId : "";
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [filter, setFilter] = useState<CallLogFilter>("all");
  const logs = useInfiniteQuery({ ...callLogsOptions(wsId), enabled: !!wsId });
  const nicknames = useQuery({ ...nicknamesOptions(wsId), enabled: !!wsId });
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
  const missedCount = useMemo(() => missedCallCount(logs.data?.pages.flatMap((page) => page.call_logs) ?? [], userId), [logs.data, userId]);

  const empty = logs.isPending ? (
    <View className="items-center py-12">
      <ActivityIndicator accessibilityLabel={t("common.loading")} />
    </View>
  ) : logs.isError ? (
    <View className="items-center gap-3 px-8 py-12">
      <Text className="text-center text-callout text-destructive">{t("common.error")}</Text>
      <Button variant="outline" onPress={() => void refetch()}>
        <Text>{t("common.retry")}</Text>
      </Button>
    </View>
  ) : (
    <Text className="px-8 py-12 text-center text-callout text-muted-foreground">
      {t(filter === "missed" ? "mobile.calls.no_missed" : "mobile.calls.empty")}
    </Text>
  );

  return (
    <View className="flex-1 bg-background">
      <Header large title={t("mobile.tab_calls")}>
        <CallLogFilters value={filter} onChange={setFilter} missedCount={missedCount} />
      </Header>
      <SectionList
        sections={sections}
        keyExtractor={(log) => log.message_id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text accessibilityRole="header" className="bg-background px-4 pb-1.5 pt-3.5 text-footnote font-semibold text-muted-foreground">
              {section.title}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <CallLogRow
            log={item}
            userId={userId}
            nicknames={nicknames.data ?? {}}
            onPress={() => router.push(deepLinkHref({ orgSlug: org, wsSlug: ws, roomId: item.room_id, messageId: item.message_id }))}
          />
        )}
        ItemSeparatorComponent={CallLogSeparator}
        ListEmptyComponent={empty}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator accessibilityLabel={t("common.loading")} className="py-4" /> : null}
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
