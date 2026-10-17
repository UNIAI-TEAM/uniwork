// Ported from usf apps/mobile/app/(app)/[workspace]/more/settings.tsx, cut to
// M1: theme, language, sign out.
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { unregisterPushToken } from "@/data/push";
import { useLocalePreference } from "@/lib/i18n/provider";
import type { SupportedLocale } from "@/lib/i18n/singleton";
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
  const logout = useAuthStore((s) => s.logout);
  const { preference, setPreference } = useColorScheme();
  const { locale, setLocale } = useLocalePreference();

  const onLogout = async () => {
    await unregisterPushToken(api).catch(() => undefined);
    await logout();
  };

  return (
    <View className="flex-1 bg-background">
      <Header title={t("nav.settings")} />
      <ScrollView contentContainerClassName="px-4 py-4 gap-6">
        <OptionGroup title={t("settings.preferences.theme")} options={THEME_OPTIONS} value={preference} onChange={setPreference} />
        <OptionGroup title={t("settings.preferences.language")} options={LOCALE_OPTIONS} value={locale} onChange={setLocale} />
        <Button variant="destructive" onPress={() => void onLogout()}>
          <Text>{t("auth.logout")}</Text>
        </Button>
      </ScrollView>
    </View>
  );
}
