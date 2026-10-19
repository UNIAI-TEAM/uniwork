// Ported from usf apps/mobile/app/(app)/[workspace]/more/settings.tsx. The
// settings tab: the account (read only), the workspace and a way to switch it,
// push for this device, the signed-in devices, theme, language, the build, and
// sign out.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { DevicesSection } from "@/components/settings/devices-section";
import { PushSection } from "@/components/settings/push-section";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { unregisterPushToken } from "@/data/push";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useLocalePreference } from "@/lib/i18n/provider";
import type { SupportedLocale } from "@/lib/i18n/singleton";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme, type ThemePreference } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

type Option<T> = { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap };

const THEME_OPTIONS: Option<ThemePreference>[] = [
  { value: "system", label: "settings.preferences.themeSystem", icon: "phone-portrait-outline" },
  { value: "light", label: "settings.preferences.themeLight", icon: "sunny-outline" },
  { value: "dark", label: "settings.preferences.themeDark", icon: "moon-outline" },
];
const LOCALE_OPTIONS: Option<SupportedLocale>[] = [
  { value: "vi", label: "settings.preferences.languageVi" },
  { value: "en", label: "settings.preferences.languageEn" },
];

/** A titled segmented control: one tap picks a segment, as the radio rows it replaces did. */
function OptionGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} className="flex-row gap-1.5 rounded-xl bg-card p-1.5" style={continuousCorners}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              className={cn(
                "flex-1 items-center justify-center gap-1.5 rounded-lg",
                option.icon ? "h-[68px]" : "h-11",
                selected ? "bg-primary" : "bg-muted active:bg-secondary",
              )}
            >
              {option.icon ? (
                <Ionicons name={option.icon} size={20} color={selected ? THEME[colorScheme].primaryForeground : THEME[colorScheme].foreground} />
              ) : null}
              <Text
                numberOfLines={1}
                className={cn("font-semibold", option.icon ? "text-[13px]" : "text-[15px]", selected ? "text-primary-foreground" : "text-foreground")}
              >
                {t(option.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function SettingsTab() {
  const { t } = useTranslation();
  const { org, ws } = useLocalSearchParams<{ org: string; ws: string }>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { colorScheme, preference, setPreference } = useColorScheme();
  const { locale, setLocale } = useLocalePreference();
  const { data: workspaces } = useQuery(workspaceListOptions());
  const workspace = workspaces?.find((w) => w.organization_slug === org && w.slug === ws);
  const name = user?.display_name.trim() || user?.email || "";

  const onLogout = async () => {
    await unregisterPushToken(api).catch(() => undefined);
    await logout();
  };

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
          <PersonAvatar name={name} avatarUrl={user?.avatar_url} size={56} />
          <View className="flex-1 gap-0.5">
            <Text numberOfLines={1} className="text-lg font-bold text-foreground">
              {name}
            </Text>
            <Text numberOfLines={1} className="text-sm text-muted-foreground">
              {user?.email}
            </Text>
          </View>
        </View>

        <SettingsSection title={t("mobile.settings.workspace")}>
          <Pressable
            onPress={() => router.push("/select-workspace")}
            accessibilityRole="button"
            accessibilityLabel={t("mobile.settings.switch_workspace")}
            className="min-h-[64px] flex-row items-center gap-3 py-2.5 pl-4 pr-3.5 active:bg-secondary"
          >
            <WorkspaceAvatar name={workspace?.name ?? ws} iconUrl={workspace?.icon_url} iconEmoji={workspace?.icon_emoji} size={40} />
            <View className="flex-1">
              <Text numberOfLines={1} className="text-base font-semibold text-foreground">
                {workspace?.name ?? ws}
              </Text>
              <Text className="text-sm font-medium text-primary">{t("mobile.settings.switch_workspace")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={THEME[colorScheme].mutedForeground} />
          </Pressable>
        </SettingsSection>

        <PushSection />
        <DevicesSection />
        <OptionGroup title={t("settings.preferences.theme")} options={THEME_OPTIONS} value={preference} onChange={setPreference} />
        <OptionGroup title={t("settings.preferences.language")} options={LOCALE_OPTIONS} value={locale} onChange={setLocale} />
        <View className="gap-3.5 pt-1">
          <Button
            variant="destructive"
            className="h-12 rounded-full bg-destructive-solid active:opacity-90 sm:h-12 dark:bg-destructive-solid"
            onPress={() => void onLogout()}
          >
            <Text className="text-base font-semibold">{t("auth.logout")}</Text>
          </Button>
          <Text className="text-center text-xs text-muted-foreground">
            {t("mobile.settings.version", { version: Constants.expoConfig?.version ?? "" })}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
