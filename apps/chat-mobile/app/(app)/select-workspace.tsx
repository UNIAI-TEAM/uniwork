// Ported from usf apps/mobile/app/(app)/select-workspace.tsx. One organization
// per account (ADR 0032), so the list is flat.
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

export default function SelectWorkspace() {
  const { t } = useTranslation();
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

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-6 py-6 gap-6">
        <Text className="text-2xl font-semibold text-foreground">{t("workspace.pickTitle")}</Text>
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
              <CardPressable key={ws.id} className="flex-row items-center gap-3" onPress={() => void onSelect(ws)}>
                <WorkspaceAvatar name={ws.name} iconUrl={ws.icon_url} iconEmoji={ws.icon_emoji} size={40} />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">{ws.name}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">{ws.organization_name}</Text>
                </View>
              </CardPressable>
            ))}
          </View>
        )}
        <View className="pt-4 border-t border-border">
          <Button variant="outline" onPress={() => void onLogout()}>
            <Text>{t("auth.logout")}</Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
