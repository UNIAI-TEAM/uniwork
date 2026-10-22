// Ported from usf apps/mobile/app/(app)/[workspace]/more/settings.tsx. The
// settings tab: the account (read only), the workspace and a way to switch it,
// push for this device, message text in notifications, app lock and screen security, the signed-in devices, theme, language, Privacy &
// legal (policy, AI processing, support, licenses), About (the build, its
// channel and update), sign out, and deleting the account.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useWorkspaceSlugs } from "@/components/chat/use-chat-workspace";
import { PersonAvatar } from "@/components/people/person-avatar";
import { AboutSection } from "@/components/settings/about-section";
import { DeleteAccountSection } from "@/components/settings/delete-account";
import { LegalSection } from "@/components/settings/legal-section";
import { OptionGroup, type Option } from "@/components/settings/option-group";
import { DevicesSection } from "@/components/settings/devices-section";
import { PrivacySection } from "@/components/settings/privacy-section";
import { PushPreviewsRow } from "@/components/settings/push-previews-row";
import { PushSection } from "@/components/settings/push-section";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { WorkspaceSwitchSheet } from "@/components/workspace/workspace-switch-sheet";
import { useAuthStore } from "@/data/auth/store";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useLocalePreference } from "@/components/app/i18n-provider";
import type { SupportedLocale } from "@/lib/i18n/singleton";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme, type ThemePreference } from "@/components/ui/use-color-scheme";

const THEME_OPTIONS: Option<ThemePreference>[] = [
  { value: "system", label: "settings.preferences.themeSystem", icon: "phone-portrait-outline" },
  { value: "light", label: "settings.preferences.themeLight", icon: "sunny-outline" },
  { value: "dark", label: "settings.preferences.themeDark", icon: "moon-outline" },
];
const LOCALE_OPTIONS: Option<SupportedLocale>[] = [
  { value: "vi", label: "settings.preferences.languageVi" },
  { value: "en", label: "settings.preferences.languageEn" },
];

export default function SettingsTab() {
  const { t } = useTranslation();
  const { org = "", ws = "" } = useWorkspaceSlugs();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { colorScheme, preference, setPreference } = useColorScheme();
  const { locale, setLocale } = useLocalePreference();
  const { data: workspaces } = useQuery(workspaceListOptions());
  const workspace = workspaces?.find((w) => w.organization_slug === org && w.slug === ws);
  const [switchOpen, setSwitchOpen] = useState(false);
  const name = user?.display_name.trim() || user?.email || "";

  return (
    <View className="flex-1 bg-muted dark:bg-background">
      {/* shortcut: Header takes no className, so its band stays bg-background over the grouped page; pass the page colour once it does. */}
      <Header large title={t("nav.settings")} />
      <ScrollView contentContainerClassName="gap-6 px-4 pb-6 pt-5">
        <View
          accessible
          accessibilityLabel={[t("mobile.settings.account"), name, `${t("settings.profile.email")} ${user?.email ?? ""}`].join(", ")}
          className="flex-row items-center gap-3.5 rounded-xl bg-card p-4"
          style={continuousCorners}
        >
          <PersonAvatar name={name} avatarUrl={user?.avatar_url} size={56} seed={user?.id} />
          <View className="flex-1 gap-0.5">
            <Text numberOfLines={1} className="text-title3 font-display font-bold text-foreground">
              {name}
            </Text>
            <Text numberOfLines={1} className="text-callout text-muted-foreground">
              {user?.email}
            </Text>
          </View>
        </View>

        <SettingsSection title={t("mobile.settings.workspace")}>
          <Pressable
            onPress={() => setSwitchOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t("mobile.settings.switch_workspace")}, ${t("chat.mobile.workspace_at", { name: workspace?.name ?? ws })}`}
            className="min-h-[64px] flex-row items-center gap-3 py-2.5 pl-4 pr-3.5 active:bg-secondary"
          >
            <WorkspaceAvatar name={workspace?.name ?? ws} iconUrl={workspace?.icon_url} iconEmoji={workspace?.icon_emoji} size={40} seed={workspace?.id} />
            <View className="flex-1">
              <Text numberOfLines={1} className="text-body font-semibold text-foreground">
                {workspace?.name ?? ws}
              </Text>
              <Text className="text-callout font-medium text-primary">{t("mobile.settings.switch_workspace")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={THEME[colorScheme].mutedForeground} />
          </Pressable>
        </SettingsSection>

        <PushSection />
        <PrivacySection>
          <PushPreviewsRow orgSlug={org} />
        </PrivacySection>
        <DevicesSection />
        <OptionGroup title={t("settings.preferences.theme")} options={THEME_OPTIONS} value={preference} onChange={setPreference} />
        <OptionGroup title={t("settings.preferences.language")} options={LOCALE_OPTIONS} value={locale} onChange={setLocale} />
        <LegalSection />
        <AboutSection />
        <View className="gap-3.5 pt-1">
          <Button
            variant="destructive"
            className="min-h-12 rounded-full bg-destructive-solid py-3 active:opacity-90 dark:bg-destructive-solid"
            // logout() drops this phone's push subscription first (data/auth/store.ts).
            onPress={() => void logout()}
          >
            <Ionicons name="log-out-outline" size={18} color={THEME.light.primaryForeground} />
            <Text className="text-body font-semibold">{t("auth.logout")}</Text>
          </Button>
        </View>
        <DeleteAccountSection workspace={{ orgSlug: org, wsSlug: ws }} />
      </ScrollView>
      <WorkspaceSwitchSheet visible={switchOpen} onClose={() => setSwitchOpen(false)} currentWsId={workspace?.id ?? ""} />
    </View>
  );
}
