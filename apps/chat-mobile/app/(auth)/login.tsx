// Ported from usf apps/mobile/app/(auth)/login.tsx, re-cut for PKCE: one
// button opens the system browser; the session store loads /me afterwards. On an iPhone, Sign in with Apple sits
// above it (ADR 0041; Apple's HIG: no lower than the other ways in) and signs in without the browser.
// Laid out as canvas MobLogin: the mark and the welcome up top, the error and
// the button at the thumb. At the largest text sizes the page scrolls instead
// of pushing the button off the screen (Maestro's a11y-large-text-dark flow); there the illustration gives way
// to the mark (components/brand/login-hero.tsx) and the display title stops growing at DISPLAY_MAX_FONT_SCALE,
// so "Welcome" still fits one line instead of breaking mid-word, while the hint and the button keep scaling.
import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppleSignInButton } from "@/components/auth/apple-sign-in-button";
import { LoginHero } from "@/components/brand/login-hero";
import { SignInLegalNote } from "@/components/settings/sign-in-legal-note";
import { useAnnounce } from "@/components/ui/a11y";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { signInFailureKey, unfinishedStepKey } from "@/lib/sign-in-failure";
import { THEME } from "@/lib/theme";
import { DISPLAY_MAX_FONT_SCALE } from "@/lib/type-scale";
import { useColorScheme } from "@/components/ui/use-color-scheme";

export default function Login() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The error line's live region is TalkBack's; VoiceOver hears it through an announcement.
  useAnnounce(failure ? t(failure) : null);

  if (user) return <Redirect href="/" />;

  const onPress = async (method: "browser" | "apple") => {
    setBusy(true);
    setFailure(null);
    try {
      // Apple opens an account when its identity matches none, as the shipped app's route did, until the choice
      // screen lands (spec §5.2); a second factor or an address that has an account goes to the browser meanwhile.
      const outcome = await login(method === "apple" ? { method, intent: "sign_up" } : { method });
      setFailure(unfinishedStepKey(outcome));
    } catch (error: unknown) {
      setFailure(signInFailureKey(method, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ flexGrow: 1 }} bounces={false} testID="login-screen">
      <LoginHero />
      <View className="items-center gap-2.5 px-8">
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={DISPLAY_MAX_FONT_SCALE}
          testID="login-title"
          className="text-center text-display font-display font-extrabold leading-[34px] tracking-tight text-foreground"
        >
          {t("auth.desktop.unichat_login_title")}
        </Text>
        <Text className="max-w-[300px] text-center text-body leading-6 text-muted-foreground">{t("mobile.login_hint")}</Text>
      </View>
      <View className="flex-1" />
      <View className="gap-3.5 px-6 pb-6">
        {failure ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="flex-row items-center justify-center gap-1.5">
            <Ionicons name="alert-circle-outline" size={16} color={THEME[colorScheme].destructive} />
            <Text className="shrink text-center text-callout text-destructive">{t(failure)}</Text>
          </View>
        ) : null}
        <AppleSignInButton disabled={busy} onPress={() => void onPress("apple")} />
        <Button disabled={busy} className="min-h-12 rounded-full py-3" onPress={() => void onPress("browser")} testID="login-button">
          <Text className="text-body font-semibold">{t("auth.desktop.unichat_login_button")}</Text>
        </Button>
        <View className="flex-row items-center justify-center gap-1.5">
          <Ionicons name="globe-outline" size={14} color={THEME[colorScheme].mutedForeground} />
          <Text className="text-footnote text-muted-foreground">{t("chat.mobile.login_browser_hint")}</Text>
        </View>
        <SignInLegalNote />
      </View>
      <SafeAreaView edges={["bottom"]} />
    </ScrollView>
  );
}
