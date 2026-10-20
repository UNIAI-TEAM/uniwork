// The workspace switch as the MobileWorkspaces board draws it: a bottom sheet
// over the list with every workspace of the organization, what each one holds
// unread (GET /me/chat/unread-summary), a check on the open one. Tapping a row
// makes it current and lands on its chat tab, as select-workspace does.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "@uniwork/core/types/workspace";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SheetGrabber, useAfterDismiss } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { unreadSummaryOptions } from "@/data/queries/chat";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { badgeText, unreadOfWorkspace, workspaceMetaKind, type WorkspaceMetaKind } from "@/lib/workspace-unread";
import { cn } from "@/lib/utils";

const META_KEY: Record<WorkspaceMetaKind, string> = {
  open: "chat.mobile.workspace_open",
  open_unread: "chat.mobile.workspace_open_unread",
  unread: "chat.mobile.workspace_unread",
  unread_mentions: "chat.mobile.workspace_unread_mentions",
  none: "chat.mobile.workspace_no_new",
};

export function WorkspaceSwitchSheet({ visible, onClose, currentWsId }: { visible: boolean; onClose: () => void; currentWsId: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { choose, onDismiss } = useAfterDismiss(onClose);
  const workspaces = useQuery({ ...workspaceListOptions(), enabled: visible });
  const summary = useQuery({ ...unreadSummaryOptions(), enabled: visible });
  const setCurrent = useWorkspaceStore((s) => s.setCurrent);
  const list = workspaces.data ?? [];
  const organization = list[0]?.organization_name ?? "";

  const select = (ws: Workspace) => {
    if (ws.id === currentWsId) return;
    void setCurrent({ orgSlug: ws.organization_slug, wsSlug: ws.slug, wsId: ws.id }).then(() => router.replace(`/${ws.organization_slug}/${ws.slug}/chat`));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="max-h-[80%] rounded-t-[24px] bg-card pb-2" style={continuousCorners} accessibilityViewIsModal accessibilityLabel={t("mobile.settings.switch_workspace")}>
        <SheetGrabber />
        <View className="px-5 pb-2.5">
          <Text accessibilityRole="header" className="text-[22px] font-display font-extrabold leading-7 text-foreground">
            {t("chat.mobile.workspace_sheet_title")}
          </Text>
          {organization ? (
            <Text className="mt-0.5 text-sm text-muted-foreground">{t("chat.mobile.workspace_count", { org: organization, count: list.length })}</Text>
          ) : null}
        </View>
        <ScrollView bounces={false}>
          {list.map((ws) => {
            const current = ws.id === currentWsId;
            const counts = unreadOfWorkspace(summary.data, ws.id);
            const kind = workspaceMetaKind(counts, current);
            const badge = current ? null : badgeText(counts.unread);
            const meta = t(META_KEY[kind], { count: counts.unread });
            return (
              <Pressable
                key={ws.id}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                accessibilityLabel={`${ws.name}, ${meta}`}
                onPress={() => choose(() => select(ws))}
                className={cn("min-h-[68px] flex-row items-center gap-3.5 px-5 active:bg-secondary", current && "bg-tint-blue/50")}
              >
                <WorkspaceAvatar name={ws.name} iconUrl={ws.icon_url} iconEmoji={ws.icon_emoji} size={46} seed={ws.id} />
                <View className="flex-1 gap-0.5">
                  <Text numberOfLines={1} className="text-base font-display font-bold text-foreground">
                    {ws.name}
                  </Text>
                  <Text numberOfLines={1} className={cn("text-[13px]", kind === "unread_mentions" ? "text-destructive" : "text-muted-foreground")}>
                    {meta}
                  </Text>
                </View>
                {current ? <Ionicons name="checkmark" size={22} color={theme.primary} accessibilityLabel={t("chat.mobile.workspace_open")} /> : null}
                {badge ? (
                  <View className={cn("h-6 min-w-6 items-center justify-center rounded-full px-2", counts.mentions > 0 ? "bg-destructive-solid" : "bg-primary")}>
                    <Text className="text-xs font-display font-bold text-primary-foreground">{badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
