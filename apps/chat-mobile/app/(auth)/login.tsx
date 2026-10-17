// Ported from usf apps/mobile/app/(auth)/login.tsx, re-cut for PKCE: one
// button opens the system browser; the session store loads /me afterwards.
import { Redirect } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UniChatLogo } from "@/components/brand/unichat-logo";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";

export default function Login() {
  const { t } = useTranslation();
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
      <View className="flex-1 justify-center px-6 gap-8">
        <View className="items-center gap-4">
          <UniChatLogo />
          <View className="items-center gap-1">
            <Text className="text-2xl font-semibold text-foreground">{t("auth.desktop.unichat_login_title")}</Text>
            <Text className="text-sm text-muted-foreground text-center">{t("auth.desktop.unichat_login_hint")}</Text>
          </View>
        </View>
        {failed ? <Text className="text-sm text-destructive text-center">{t("auth.desktop.unichat_login_failed")}</Text> : null}
        <Button size="lg" disabled={busy} onPress={() => void onPress()}>
          <Text>{t("auth.desktop.unichat_login_button")}</Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}
