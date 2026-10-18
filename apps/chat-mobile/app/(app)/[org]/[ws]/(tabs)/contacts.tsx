// The contacts tab: the workspace's people as the web's member picker lists
// them (minus the deactivated, whom a DM would refuse), with their nicknames
// and who is online — a strip of the online ones above the list — A–Z. A tap
// opens the DM through the deep-link contract the chat tab (M2a) honours;
// block banners live on that DM, as on the web.
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, SectionList, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { SearchField } from "@/components/ui/search-field";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { chatNicknamesOptions, deactivatedMembersOptions, workspaceMembersOptions } from "@/data/queries/contacts";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { contactSections, type ContactRow } from "@/lib/contacts-display";
import { deepLinkHref } from "@/lib/deep-link";

const NO_ONE: readonly string[] = [];

/** Inset past the avatar, inside each letter group. */
function RowSeparator() {
  return <Separator className="ml-[72px] w-auto" />;
}

/** The online people as a horizontal strip of faces, each opening the DM. */
function OnlineStrip({ rows, onPress }: { rows: ContactRow[]; onPress: (row: ContactRow) => void }) {
  const { t } = useTranslation();
  return (
    <View className="pb-3 pt-2">
      <View className="flex-row items-center gap-1.5 px-4">
        <View className="h-2 w-2 rounded-full bg-success-solid" />
        <Text accessibilityRole="header" className="text-[13px] font-semibold text-muted-foreground">
          {`${t("chat.presence_online")} · ${rows.length}`}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4 pt-2.5">
        {rows.map((row) => (
          <Pressable
            key={row.user_id}
            onPress={() => onPress(row)}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}, ${t("chat.presence_online")}`}
            className="w-16 items-center gap-1 rounded-lg active:bg-secondary"
          >
            <PersonAvatar name={row.label} avatarUrl={row.avatar_url} size={52} online />
            <Text numberOfLines={1} className="max-w-16 text-xs text-muted-foreground">
              {row.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View className="mt-3 h-2 bg-muted" />
    </View>
  );
}

function ContactItem({ row, online, onPress }: { row: ContactRow; online: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const subtitle = row.label === row.email ? "" : row.email;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[row.label, online ? t("chat.presence_online") : "", subtitle].filter(Boolean).join(", ")}
      className="min-h-[60px] flex-row items-center gap-3 px-4 py-2 active:bg-secondary"
    >
      <PersonAvatar name={row.label} avatarUrl={row.avatar_url} size={44} online={online} />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base font-semibold text-foreground">
          {row.label}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="text-sm text-muted-foreground">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function ContactsTab() {
  const { t } = useTranslation();
  const { org, ws } = useLocalSearchParams<{ org: string; ws: string }>();
  const current = useWorkspaceStore((s) => s.current);
  // The layout syncs the store after it validated the URL pair; until then there is no workspace to ask about.
  const wsId = current?.orgSlug === org && current.wsSlug === ws ? current.wsId : "";
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [query, setQuery] = useState("");

  const members = useQuery({ ...workspaceMembersOptions(wsId), enabled: !!wsId });
  // Unreadable, it hides no one (the web's list), so it never blocks the tab.
  const deactivated = useQuery({ ...deactivatedMembersOptions(org), enabled: !!wsId });
  const nicknames = useQuery({ ...chatNicknamesOptions(wsId), enabled: !!wsId });
  // The workspace's one heartbeat (use-chat-realtime.ts) and user.presence frames keep this set.
  const online = usePresenceStore((s) => s.onlineUserIds);

  const hidden = useMemo(() => new Set(deactivated.data ?? NO_ONE), [deactivated.data]);
  const sections = useMemo(
    () => contactSections(members.data ?? [], { currentUserId: userId, hiddenUserIds: hidden, nicknames: nicknames.data, query }),
    [members.data, userId, hidden, nicknames.data, query],
  );
  const count = sections.reduce((sum, section) => sum + section.data.length, 0);
  const isOnline = (id: string) => Boolean(online[id.trim().toUpperCase()]);
  const openDm = (row: ContactRow) => router.push(deepLinkHref({ orgSlug: org, wsSlug: ws, dmUserId: row.user_id }));
  // A search narrows the list itself; the strip only greets an unfiltered tab.
  const onlineRows = query.trim() ? [] : sections.flatMap((section) => section.data).filter((row) => isOnline(row.user_id));

  const empty = members.isPending ? (
    <View className="items-center py-12">
      <ActivityIndicator />
    </View>
  ) : members.isError ? (
    <View className="items-center gap-3 px-8 py-12">
      <Text className="text-center text-sm text-destructive">{t("common.error")}</Text>
      <Button variant="outline" onPress={() => void members.refetch()}>
        <Text>{t("common.retry")}</Text>
      </Button>
    </View>
  ) : (
    <Text className="px-8 py-12 text-center text-sm text-muted-foreground">
      {t(query.trim() ? "mobile.contacts.no_match" : "mobile.contacts.empty")}
    </Text>
  );

  return (
    <View className="flex-1 bg-background">
      <Header large title={t("nav.people")} subtitle={members.data ? t("mobile.contacts.count", { count }) : undefined}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("mobile.contacts.search")}
          accessibilityLabel={t("mobile.contacts.search")}
          autoCapitalize="none"
          returnKeyType="search"
          className="mb-2 mt-3"
        />
      </Header>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.user_id}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled
        ListHeaderComponent={onlineRows.length > 0 ? <OnlineStrip rows={onlineRows} onPress={openDm} /> : null}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" className="bg-background px-4 py-1.5 text-[13px] font-bold text-muted-foreground">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <ContactItem row={item} online={isOnline(item.user_id)} onPress={() => openDm(item)} />}
        ItemSeparatorComponent={RowSeparator}
        ListEmptyComponent={empty}
        refreshing={members.isRefetching}
        onRefresh={() => {
          // refetch() ignores `enabled`, so a pull waits for a workspace too.
          if (wsId) void Promise.all([members.refetch(), deactivated.refetch(), nicknames.refetch()]);
        }}
      />
    </View>
  );
}
