// The contacts tab: the workspace's people as the web's member picker lists
// them (minus the deactivated, whom a DM would refuse), with their nicknames
// and who is online — a strip of the online ones above the list — A–Z. A tap
// opens the DM through the deep-link contract the chat tab (M2a) honours;
// the DM says when either side blocked (room-safety.tsx › DmBlockBanner), and
// its details block, unblock and report, as on the web.
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, SectionList, View } from "react-native";
import { useWorkspaceSlugs } from "@/components/chat/use-chat-workspace";
import { ContactItem, ContactSeparator } from "@/components/contacts/contact-item";
import { LetterIndex } from "@/components/contacts/letter-index";
import { OnlineStrip } from "@/components/contacts/online-strip";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { nicknamesOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { deactivatedMembersOptions } from "@/data/queries/org-members";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { contactSections, type ContactRow } from "@/lib/contacts-display";
import { deepLinkHref } from "@/lib/deep-link";

const NO_ONE: readonly string[] = [];

export default function ContactsTab() {
  const { t } = useTranslation();
  const { org = "", ws = "" } = useWorkspaceSlugs();
  const current = useWorkspaceStore((s) => s.current);
  // The layout syncs the store after it validated the URL pair; until then there is no workspace to ask about.
  const wsId = current?.orgSlug === org && current.wsSlug === ws ? current.wsId : "";
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [query, setQuery] = useState("");
  const list = useRef<SectionList<ContactRow>>(null);

  const members = useQuery({ ...workspaceMembersOptions(wsId), enabled: !!wsId });
  // Unreadable, it hides no one (the web's list), so it never blocks the tab.
  const deactivated = useQuery({ ...deactivatedMembersOptions(org), enabled: !!wsId });
  const nicknames = useQuery({ ...nicknamesOptions(wsId), enabled: !!wsId });

  const hidden = useMemo(() => new Set(deactivated.data ?? NO_ONE), [deactivated.data]);
  const sections = useMemo(
    () => contactSections(members.data ?? [], { currentUserId: userId, hiddenUserIds: hidden, nicknames: nicknames.data, query }),
    [members.data, userId, hidden, nicknames.data, query],
  );
  const count = sections.reduce((sum, section) => sum + section.data.length, 0);
  const openDm = useCallback((row: ContactRow) => router.push(deepLinkHref({ orgSlug: org, wsSlug: ws, dmUserId: row.user_id })), [org, ws]);
  // A search narrows the list itself; the strip only greets an unfiltered tab.
  const everyone = useMemo(() => (query.trim() ? [] : sections.flatMap((section) => section.data)), [query, sections]);

  const empty = members.isPending ? (
    <View className="items-center py-12">
      <ActivityIndicator />
    </View>
  ) : members.isError ? (
    <View className="items-center gap-3 px-8 py-12">
      <Text className="text-center text-callout text-destructive">{t("common.error")}</Text>
      <Button variant="outline" onPress={() => void members.refetch()}>
        <Text>{t("common.retry")}</Text>
      </Button>
    </View>
  ) : (
    <Text className="px-8 py-12 text-center text-callout text-muted-foreground">
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
        ref={list}
        sections={sections}
        keyExtractor={(row) => row.user_id}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled
        ListHeaderComponent={everyone.length > 0 ? <OnlineStrip people={everyone} onPress={openDm} /> : null}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" className="bg-background px-4 py-1.5 text-footnote font-display font-bold text-muted-foreground">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <ContactItem row={item} onPress={openDm} />}
        ItemSeparatorComponent={ContactSeparator}
        ListEmptyComponent={empty}
        refreshing={members.isRefetching}
        onRefresh={() => {
          // refetch() ignores `enabled`, so a pull waits for a workspace too.
          if (wsId) void Promise.all([members.refetch(), deactivated.refetch(), nicknames.refetch()]);
        }}
      />
      {/* MobContacts board: the letters down the right edge jump to their section. */}
      {sections.length > 1 && !query.trim() ? (
        <LetterIndex
          letters={sections.map((section) => section.title)}
          onJump={(sectionIndex) => list.current?.scrollToLocation({ sectionIndex, itemIndex: 0, viewOffset: 0, animated: true })}
        />
      ) : null}
    </View>
  );
}
