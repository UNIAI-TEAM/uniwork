// Ported from usf apps/mobile/app/(app)/select-workspace.tsx. One organization
// per account (ADR 0032), so the list is flat, the organization named once
// above it (canvas MobSelectWorkspace). Settings sits under the list in every
// state, an empty one included: the account's own Settings (accountRoutes)
// keeps the legal pages and account deletion reachable without a workspace.
// A Hide My Email account (ADR 0041) hears why an invitation to its work email misses it (lib/apple-relay.ts).
// "No workspace" only once the server answered with none: a list not answered
// yet waits for the network, with Retry (components/workspace/use-workspace-list.ts).
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "@uniwork/core/types/workspace";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { CardPressable } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useWorkspaceList } from "@/components/workspace/use-workspace-list";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { unreadSummaryOptions } from "@/data/queries/chat";
import { useAuthStore } from "@/data/auth/store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { isAppleRelayAddress } from "@/lib/apple-relay";
import { accountRoutes } from "@/lib/chat-routes";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { badgeText, unreadOfWorkspace } from "@/lib/workspace-unread";
import { cn } from "@/lib/utils";
import { BADGE_MAX_FONT_SCALE } from "@/lib/type-scale";

export default function SelectWorkspace() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const logout = useAuthStore((s) => s.logout);
  const email = useAuthStore((s) => s.user?.email ?? "");
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);
  const { data, view, retry } = useWorkspaceList();
  const summary = useQuery(unreadSummaryOptions());

  const onSelect = async (ws: Workspace) => {
    await setCurrent({ orgSlug: ws.organization_slug, wsSlug: ws.slug, wsId: ws.id });
    router.replace(`/${ws.organization_slug}/${ws.slug}/chat`);
  };

  const organization = data?.[0]?.organization_name;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-6 px-5 pb-6 pt-3">
        <View className="gap-2.5">
          <Text accessibilityRole="header" className="text-display-lg font-display font-extrabold leading-9 tracking-tight text-foreground">
            {t("workspace.pickTitle")}
          </Text>
          {organization ? (
            <View className="flex-row items-center gap-2">
              <WorkspaceAvatar name={organization} size={24} seed={data?.[0]?.organization_id} />
              <Text numberOfLines={1} className="flex-1 text-subhead text-muted-foreground">
                <Text className="text-subhead font-semibold text-foreground">{organization}</Text>
                {` · ${t("chat.mobile.workspace_count_only", { count: data?.length ?? 0 })}`}
              </Text>
            </View>
          ) : null}
        </View>
        {view === "loading" ? (
          <View className="py-8 items-center">
            <ActivityIndicator accessibilityLabel={t("common.loading")} />
          </View>
        ) : view === "waiting" || view === "error" ? (
          <View className="gap-3">
            <Text className={view === "error" ? "text-callout text-destructive" : "text-callout text-muted-foreground"}>
              {t(view === "error" ? "common.error" : "chat.mobile.offline_banner")}
            </Text>
            <Button variant="outline" onPress={() => void retry()}>
              <Text>{t("common.retry")}</Text>
            </Button>
          </View>
        ) : view === "empty" ? (
          <Text selectable className="text-callout leading-[22px] text-muted-foreground">
            {isAppleRelayAddress(email) ? t("mobile.account.no_workspace_relay", { email }) : t("mobile.account.no_workspace")}
          </Text>
        ) : (
          <View className="gap-3">
            {(data ?? []).map((ws) => {
              const counts = unreadOfWorkspace(summary.data, ws.id);
              const badge = badgeText(counts.unread);
              return (
                <CardPressable
                  key={ws.id}
                  accessibilityRole="button"
                  accessibilityLabel={[
                    ws.name,
                    ws.organization_name,
                    counts.unread > 0 ? t("chat.mobile.workspace_unread", { count: counts.unread }) : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  className="min-h-[76px] flex-row items-center gap-3.5 rounded-2xl py-3.5 ps-4 pe-3.5"
                  onPress={() => void onSelect(ws)}
                >
                  <WorkspaceAvatar name={ws.name} iconUrl={ws.icon_url} iconEmoji={ws.icon_emoji} size={48} seed={ws.id} />
                  <View className="flex-1 gap-0.5">
                    <Text numberOfLines={1} className="text-body font-display font-bold text-foreground">
                      {ws.name}
                    </Text>
                    <Text numberOfLines={1} className="text-footnote text-muted-foreground">
                      {ws.organization_name}
                    </Text>
                  </View>
                  {badge ? (
                    <View
                      className={cn(
                        "min-h-6 min-w-6 items-center justify-center rounded-full px-2",
                        counts.mentions > 0 ? "bg-destructive-solid" : "bg-primary",
                      )}
                    >
                      <Text className="text-caption font-display font-bold text-primary-foreground" maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}>
                        {badge}
                      </Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={THEME[colorScheme].mutedForeground} />
                </CardPressable>
              );
            })}
          </View>
        )}
        <View className="gap-3 border-t border-border pt-5">
          <Button
            variant="outline"
            className="min-h-12 rounded-full py-3"
            testID="select-workspace-settings"
            onPress={() => router.push(accountRoutes.settings)}
          >
            <Ionicons name="settings-outline" size={18} color={THEME[colorScheme].foreground} />
            <Text className="text-subhead font-semibold">{t("nav.settings")}</Text>
          </Button>
          <Button variant="outline" className="min-h-12 rounded-full py-3" onPress={() => void logout()}>
            <Ionicons name="log-out-outline" size={18} color={THEME[colorScheme].foreground} />
            <Text className="text-subhead font-semibold">{t("auth.logout")}</Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
