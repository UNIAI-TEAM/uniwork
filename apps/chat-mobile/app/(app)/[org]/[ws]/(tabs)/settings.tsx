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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { unregisterPushToken } from "@/data/push";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useLocalePreference } from "@/lib/i18n/provider";
import type { SupportedLocale } from "@/lib/i18n/singleton";
import { THEME } from "@/lib/theme";
import { useColorScheme, type ThemePreference } from "@/lib/use-color-scheme";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "settings.preferences.themeSystem" },
  { value: "light", label: "settings.preferences.themeLight" },
  { value: "dark", label: "settings.preferences.themeDark" },
];
const LOCALE_OPTIONS: { value: SupportedLocale; label: string }[] = [
  { value: "vi", label: "settings.preferences.languageVi" },
  { value: "en", label: "settings.preferences.languageEn" },
];

/**
 * A titled card of radio rows. The row Pressable only widens the tap target
 * to the full row: RN gives the inner RadioGroupItem priority, so one tap
 * fires onChange exactly once.
 */
function OptionGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground px-1">{title}</Text>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as T)} className="gap-0 rounded-md border border-border bg-card overflow-hidden">
        {options.map((option, index) => (
          <View key={option.value}>
            {index > 0 ? <Separator /> : null}
            <Pressable onPress={() => onChange(option.value)} className="flex-row items-center px-4 py-3.5 active:bg-secondary gap-3">
              <RadioGroupItem value={option.value} />
              <Text className="flex-1 text-base font-medium text-foreground">{t(option.label)}</Text>
            </Pressable>
          </View>
        ))}
      </RadioGroup>
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
    <View className="flex-1 bg-background">
      <Header title={t("nav.settings")} />
      <ScrollView contentContainerClassName="px-4 py-4 gap-6">
        <SettingsSection title={t("mobile.settings.account")}>
          <View className="flex-row items-center gap-3 px-4 py-3">
            <PersonAvatar name={name} avatarUrl={user?.avatar_url} size={48} />
            <View className="flex-1">
              <Text numberOfLines={1} className="text-base font-semibold text-foreground">
                {name}
              </Text>
              <Text numberOfLines={1} className="text-sm text-muted-foreground" accessibilityLabel={`${t("settings.profile.email")} ${user?.email ?? ""}`}>
                {user?.email}
              </Text>
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title={t("mobile.settings.workspace")}>
          <Pressable
            onPress={() => router.push("/select-workspace")}
            accessibilityRole="button"
            accessibilityLabel={t("mobile.settings.switch_workspace")}
            className="min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
          >
            <View className="flex-1">
              <Text numberOfLines={1} className="text-base font-medium text-foreground">
                {workspace?.name ?? ws}
              </Text>
              <Text className="text-sm text-primary">{t("mobile.settings.switch_workspace")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={THEME[colorScheme].mutedForeground} />
          </Pressable>
        </SettingsSection>

        <PushSection />
        <DevicesSection />
        <OptionGroup title={t("settings.preferences.theme")} options={THEME_OPTIONS} value={preference} onChange={setPreference} />
        <OptionGroup title={t("settings.preferences.language")} options={LOCALE_OPTIONS} value={locale} onChange={setLocale} />
        <Button variant="destructive" onPress={() => void onLogout()}>
          <Text>{t("auth.logout")}</Text>
        </Button>
        <Text className="text-center text-xs text-muted-foreground">
          {t("mobile.settings.version", { version: Constants.expoConfig?.version ?? "" })}
        </Text>
      </ScrollView>
    </View>
  );
}
