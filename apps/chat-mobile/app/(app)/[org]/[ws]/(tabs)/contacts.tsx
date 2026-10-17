// The contacts tab: the workspace's people as the web's member picker lists
// them (minus the deactivated, whom a DM would refuse), with their nicknames
// and who is online, A–Z. A tap opens the DM through the deep-link contract the
// chat tab (M2a) honours; block banners live on that DM, as on the web.
import { useQuery } from "@tanstack/react-query";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, SectionList, TextInput, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import {
  chatNicknamesOptions,
  chatPresenceOptions,
  deactivatedMembersOptions,
  workspaceMembersOptions,
} from "@/data/queries/contacts";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { contactSections, type ContactRow } from "@/lib/contacts-display";
import { deepLinkHref } from "@/lib/deep-link";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

const NO_ONE: readonly string[] = [];

function ContactItem({ row, online, onPress }: { row: ContactRow; online: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const subtitle = row.label === row.email ? "" : row.email;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[row.label, online ? t("chat.presence_online") : "", subtitle].filter(Boolean).join(", ")}
      className="min-h-[56px] flex-row items-center gap-3 px-4 py-2 active:bg-secondary"
    >
      <PersonAvatar name={row.label} avatarUrl={row.avatar_url} online={online} />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base font-medium text-foreground">
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
  const { colorScheme } = useColorScheme();
  const { org, ws } = useLocalSearchParams<{ org: string; ws: string }>();
  const current = useWorkspaceStore((s) => s.current);
  // The layout syncs the store after it validated the URL pair; until then there is no workspace to ask about.
  const wsId = current?.orgSlug === org && current.wsSlug === ws ? current.wsId : "";
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const focused = useIsFocused();
  const [query, setQuery] = useState("");

  const members = useQuery({ ...workspaceMembersOptions(wsId), enabled: !!wsId });
  // Unreadable, it hides no one (the web's list), so it never blocks the tab.
  const deactivated = useQuery({ ...deactivatedMembersOptions(org), enabled: !!wsId });
  const nicknames = useQuery({ ...chatNicknamesOptions(wsId), enabled: !!wsId });
  // The heartbeat beats only while the tab is in front; its answer is the web's online set.
  const presence = useQuery({ ...chatPresenceOptions(wsId), enabled: !!wsId && focused });

  const hidden = useMemo(() => new Set(deactivated.data ?? NO_ONE), [deactivated.data]);
  const online = useMemo(() => new Set((presence.data ?? NO_ONE).map((id) => id.toUpperCase())), [presence.data]);
  const sections = useMemo(
    () => contactSections(members.data ?? [], { currentUserId: userId, hiddenUserIds: hidden, nicknames: nicknames.data, query }),
    [members.data, userId, hidden, nicknames.data, query],
  );
  const count = sections.reduce((sum, section) => sum + section.data.length, 0);

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
      <Header title={t("nav.people")} subtitle={members.data ? t("mobile.contacts.count", { count }) : undefined} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("mobile.contacts.search")}
        placeholderTextColor={THEME[colorScheme].mutedForeground}
        accessibilityLabel={t("mobile.contacts.search")}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        className="mx-4 my-2 h-11 rounded-md bg-muted px-3 text-base text-foreground"
      />
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.user_id}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" className="bg-background px-4 py-1 text-xs font-semibold text-muted-foreground">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <ContactItem
            row={item}
            online={online.has(item.user_id.toUpperCase())}
            onPress={() => router.push(deepLinkHref({ orgSlug: org, wsSlug: ws, dmUserId: item.user_id }))}
          />
        )}
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
