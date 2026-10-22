// What a render crash shows instead of a white screen. Exported
// as expo-router's ErrorBoundary by app/_layout.tsx (the whole app) and by
// [org]/[ws]/_layout.tsx (one workspace, so the tabs' crash keeps the call
// overlay and the rest of the shell). It reports the error once, forced: a
// render crash is a bug whatever it wraps. A root boundary renders outside
// every provider, so this brings its own i18n and safe-area padding.
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { reportError } from "@/data/report";
import { i18n } from "@/lib/i18n/singleton";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";

export interface ErrorFallbackProps {
  error: Error;
  retry: () => Promise<void>;
  /** "root" or "workspace": the boundary that caught it, a tag on the report */
  boundary: string;
}

function Fallback({ error, retry, boundary }: ErrorFallbackProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  useEffect(() => {
    reportError(error, { source: `boundary:${boundary}`, force: true });
  }, [error, boundary]);
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-8 py-16">
      <Ionicons name="warning-outline" size={44} color={THEME[colorScheme].mutedForeground} />
      <Text accessibilityRole="header" className="text-center text-title2 font-display font-bold text-foreground">
        {t("mobile.app.error_title")}
      </Text>
      <Text className="text-center text-subhead leading-[22px] text-muted-foreground">{t("mobile.app.error_body")}</Text>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        testID="error-retry"
        className="mt-2 min-h-12 min-w-[160px] items-center justify-center rounded-full bg-primary px-6 py-3 active:opacity-90"
      >
        <Text className="text-body font-semibold text-primary-foreground">{t("mobile.app.error_retry")}</Text>
      </Pressable>
    </View>
  );
}

export function ErrorFallback(props: ErrorFallbackProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <Fallback {...props} />
    </I18nextProvider>
  );
}
