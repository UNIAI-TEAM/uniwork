// The sign-in screen's illustration (canvas MobLogin): a wall of dots fading out and a sample exchange around the
// mark. Decorative, so hidden from screen readers, and drawn like an image: a fixed 440 pt stage whose bubbles sit
// at fixed places, so their text keeps its size whatever the system text size (allowFontScaling={false}); text that
// grew there ran out of its bubble and over the mark and the title (iOS AX5, a11y-large-text-dark.yaml). At the
// accessibility text sizes (useLargeText) the stage gives way to the mark alone: the welcome, the hint and the button
// are what the person needs to read, and the stage would take half the screen from them.
import { Ionicons } from "@expo/vector-icons";
import wallDotsDark from "@/assets/chat-wall-dots-dark.png";
import wallDotsLight from "@/assets/chat-wall-dots-light.png";
import wallFadeDark from "@/assets/wall-fade-dark.png";
import wallFadeLight from "@/assets/wall-fade-light.png";
import { useTranslation } from "react-i18next";
import { Image, ImageBackground, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UniChatLogo } from "@/components/brand/unichat-logo";
import { PersonAvatar } from "@/components/people/person-avatar";
import { useLargeText } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { bubbleCorners } from "@/lib/conversation-display";
import { THEME } from "@/lib/theme";

const WALL_DOTS = { light: wallDotsLight, dark: wallDotsDark };
const WALL_FADE = { light: wallFadeLight, dark: wallFadeDark };
/** The sample exchange of the MobLogin board; a name, not a string to translate. */
const SAMPLE_PEER = "Nguyễn Thu Hà";

export function LoginHero() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const large = useLargeText();

  if (large) {
    return (
      <SafeAreaView
        edges={["top"]}
        className="items-center pb-6 pt-8"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="login-hero-compact"
      >
        <UniChatLogo size={72} />
      </SafeAreaView>
    );
  }

  return (
    <View className="relative h-[440px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="login-hero">
      <ImageBackground source={WALL_DOTS[colorScheme]} resizeMode="repeat" className="absolute inset-0 bg-chat-wall" />
      {/* The wall fades into the page, as the board's mask does. */}
      <Image source={WALL_FADE[colorScheme]} resizeMode="stretch" className="absolute inset-x-0 bottom-0 h-[220px] w-full" />
      <SafeAreaView edges={["top"]} className="flex-1">
        <View className="absolute right-10 top-[26px] min-h-7 flex-row items-center gap-1.5 rounded-full bg-chat-bubble-other/90 px-2.5 py-1">
          <Ionicons name="videocam-outline" size={14} color={THEME[colorScheme].successSolid} />
          <Text allowFontScaling={false} className="text-footnote font-semibold text-muted-foreground">
            {t("chat.video_call_log_completed", { duration: "3:05" })}
          </Text>
        </View>
        <View className="absolute left-6 top-[72px] flex-row items-end gap-1.5">
          <PersonAvatar name={SAMPLE_PEER} size={30} />
          <View className="max-w-[230px] bg-chat-bubble-other px-[11px] pb-[7px] pt-1.5" style={bubbleCorners(false, true, false)}>
            <Text allowFontScaling={false} className="text-caption font-semibold text-chat-sender-8">
              {SAMPLE_PEER}
            </Text>
            <Text allowFontScaling={false} className="text-subhead leading-[21px] text-foreground">
              {t("chat.mobile.login_sample_in")}
            </Text>
          </View>
        </View>
        <View className="absolute left-0 right-0 top-[168px] items-center">
          <UniChatLogo size={96} />
        </View>
        <View
          className="absolute right-6 top-[300px] flex-row items-end gap-1 bg-chat-bubble-own px-[11px] pb-[7px] pt-1.5"
          style={bubbleCorners(true, true, false)}
        >
          <Text allowFontScaling={false} className="text-subhead leading-[21px] text-chat-bubble-own-foreground">
            {t("chat.mobile.login_sample_out")}
          </Text>
          <Text allowFontScaling={false} className="ps-2 text-meta text-chat-bubble-own-meta">
            10:31
          </Text>
          <Ionicons name="checkmark-done" size={15} color={THEME[colorScheme].chatBubbleOwnMeta} />
        </View>
      </SafeAreaView>
    </View>
  );
}
