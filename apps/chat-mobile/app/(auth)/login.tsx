// Ported from usf apps/mobile/app/(auth)/login.tsx, re-cut for PKCE: one
// button opens the system browser; the session store loads /me afterwards.
// Laid out as canvas MobLogin: the mark and the welcome up top, the error and
// the button at the thumb.
import { Ionicons } from "@expo/vector-icons";
import wallDotsDark from "@/assets/chat-wall-dots-dark.png";
import wallDotsLight from "@/assets/chat-wall-dots-light.png";
import wallFadeDark from "@/assets/wall-fade-dark.png";
import wallFadeLight from "@/assets/wall-fade-light.png";
import { Redirect } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, ImageBackground, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UniChatLogo } from "@/components/brand/unichat-logo";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { bubbleCorners } from "@/lib/conversation-display";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

const WALL_DOTS = { light: wallDotsLight, dark: wallDotsDark };
const WALL_FADE = { light: wallFadeLight, dark: wallFadeDark };
/** The sample exchange of the MobLogin board; a name, not a string to translate. */
const SAMPLE_PEER = "Nguyễn Thu Hà";

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
    <View className="flex-1 bg-background">
      {/* The illustration of the MobLogin board: a wall of dots fading out, a sample exchange around the mark. Decorative. */}
      <View className="relative h-[440px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ImageBackground source={WALL_DOTS[colorScheme]} resizeMode="repeat" className="absolute inset-0 bg-chat-wall" />
        {/* The wall fades into the page, as the board's mask does. */}
        <Image source={WALL_FADE[colorScheme]} resizeMode="stretch" className="absolute inset-x-0 bottom-0 h-[220px] w-full" />
        <SafeAreaView edges={["top"]} className="flex-1">
          <View className="absolute right-10 top-[26px] h-7 flex-row items-center gap-1.5 rounded-full bg-chat-bubble-other/90 px-2.5">
            <Ionicons name="videocam-outline" size={14} color={THEME[colorScheme].successSolid} />
            <Text className="text-[13px] font-semibold text-muted-foreground">{t("chat.video_call_log_completed", { duration: "3:05" })}</Text>
          </View>
          <View className="absolute left-6 top-[72px] flex-row items-end gap-1.5">
            <PersonAvatar name={SAMPLE_PEER} size={30} />
            <View className="max-w-[230px] bg-chat-bubble-other px-[11px] pb-[7px] pt-1.5" style={bubbleCorners(false, true, false)}>
              <Text className="text-xs font-semibold text-chat-sender-8">{SAMPLE_PEER}</Text>
              <Text className="text-[15px] leading-[21px] text-foreground">{t("chat.mobile.login_sample_in")}</Text>
            </View>
          </View>
          <View className="absolute left-0 right-0 top-[168px] items-center">
            <UniChatLogo size={96} />
          </View>
          <View className="absolute right-6 top-[300px] flex-row items-end gap-1 bg-chat-bubble-own px-[11px] pb-[7px] pt-1.5" style={bubbleCorners(true, true, false)}>
            <Text className="text-[15px] leading-[21px] text-chat-bubble-own-foreground">{t("chat.mobile.login_sample_out")}</Text>
            <Text className="pl-2 text-[11px] text-chat-bubble-own-meta">10:31</Text>
            <Ionicons name="checkmark-done" size={15} color={THEME[colorScheme].chatBubbleOwnMeta} />
          </View>
        </SafeAreaView>
      </View>
      <View className="items-center gap-2.5 px-8">
        <Text accessibilityRole="header" className="text-center text-[28px] font-display font-extrabold leading-[34px] tracking-tight text-foreground">
          {t("auth.desktop.unichat_login_title")}
        </Text>
        <Text className="max-w-[300px] text-center text-base leading-6 text-muted-foreground">{t("mobile.login_hint")}</Text>
      </View>
      <View className="flex-1" />
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
        <View className="flex-row items-center justify-center gap-1.5">
          <Ionicons name="globe-outline" size={14} color={THEME[colorScheme].mutedForeground} />
          <Text className="text-[13px] text-muted-foreground">{t("chat.mobile.login_browser_hint")}</Text>
        </View>
      </View>
      <SafeAreaView edges={["bottom"]} />
    </View>
  );
}
