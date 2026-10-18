// Ported from usf apps/mobile/app/(app)/select-workspace.tsx. One organization
// per account (ADR 0032), so the list is flat, the organization named once
// above it (canvas MobSelectWorkspace).
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
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { unregisterPushToken } from "@/data/push";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export default function SelectWorkspace() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const logout = useAuthStore((s) => s.logout);
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);
  const { data, isLoading, error, refetch } = useQuery(workspaceListOptions());

  const onSelect = async (ws: Workspace) => {
    await setCurrent({ orgSlug: ws.organization_slug, wsSlug: ws.slug, wsId: ws.id });
    router.replace(`/${ws.organization_slug}/${ws.slug}/chat`);
  };

  const onLogout = async () => {
    await unregisterPushToken(api).catch(() => undefined);
    await logout();
  };

  const organization = data?.[0]?.organization_name;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-6 px-5 pb-6 pt-3">
        <View className="gap-2.5">
          <Text accessibilityRole="header" className="text-[30px] font-extrabold leading-9 tracking-tight text-foreground">
            {t("workspace.pickTitle")}
          </Text>
          {organization ? (
            <View className="flex-row items-center gap-2">
              <WorkspaceAvatar name={organization} size={24} />
              <Text numberOfLines={1} className="flex-1 text-[15px] font-semibold text-foreground">
                {organization}
              </Text>
            </View>
          ) : null}
        </View>
        {isLoading ? (
          <View className="py-8 items-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="gap-3">
            <Text className="text-sm text-destructive">{t("common.error")}</Text>
            <Button variant="outline" onPress={() => void refetch()}>
              <Text>{t("common.retry")}</Text>
            </Button>
          </View>
        ) : !data || data.length === 0 ? (
          <Text className="text-sm text-muted-foreground">{t("common.empty")}</Text>
        ) : (
          <View className="gap-3">
            {data.map((ws) => (
              <CardPressable
                key={ws.id}
                accessibilityRole="button"
                accessibilityLabel={`${ws.name}, ${ws.organization_name}`}
                className="min-h-[76px] flex-row items-center gap-3.5 py-3.5 pl-4 pr-3.5"
                onPress={() => void onSelect(ws)}
              >
                <WorkspaceAvatar name={ws.name} iconUrl={ws.icon_url} iconEmoji={ws.icon_emoji} size={48} />
                <View className="flex-1 gap-0.5">
                  <Text numberOfLines={1} className="text-base font-bold text-foreground">
                    {ws.name}
                  </Text>
                  <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                    {ws.organization_name}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={THEME[colorScheme].mutedForeground} />
              </CardPressable>
            ))}
          </View>
        )}
        <View className="border-t border-border pt-5">
          <Button variant="outline" className="h-12 rounded-full sm:h-12" onPress={() => void onLogout()}>
            <Ionicons name="log-out-outline" size={18} color={THEME[colorScheme].foreground} />
            <Text className="text-[15px] font-semibold">{t("auth.logout")}</Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
