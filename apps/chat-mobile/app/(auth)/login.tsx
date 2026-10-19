// Ported from usf apps/mobile/app/(auth)/login.tsx, re-cut for PKCE: one
// button opens the system browser; the session store loads /me afterwards.
// Laid out as canvas MobLogin: the mark and the welcome up top, the error and
// the button at the thumb.
import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UniChatLogo } from "@/components/brand/unichat-logo";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export default function Login() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (user) return <Redirect href="/" />;

  const onPress = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await login();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center gap-6 px-8">
        <UniChatLogo size={96} />
        <View className="items-center gap-2.5">
          <Text accessibilityRole="header" className="text-center text-[28px] font-extrabold leading-[34px] tracking-tight text-foreground">
            {t("auth.desktop.unichat_login_title")}
          </Text>
          <Text className="max-w-[300px] text-center text-base leading-6 text-muted-foreground">{t("mobile.login_hint")}</Text>
        </View>
      </View>
      <View className="gap-3.5 px-6 pb-6">
        {failed ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="flex-row items-center justify-center gap-1.5">
            <Ionicons name="alert-circle-outline" size={16} color={THEME[colorScheme].destructive} />
            <Text className="shrink text-center text-sm text-destructive">{t("auth.desktop.unichat_login_failed")}</Text>
          </View>
        ) : null}
        <Button disabled={busy} className="h-12 rounded-full sm:h-12" onPress={() => void onPress()}>
          <Text className="text-base font-semibold">{t("auth.desktop.unichat_login_button")}</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
