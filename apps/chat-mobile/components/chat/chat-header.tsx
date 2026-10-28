// The header of a pushed chat screen: back, title with a status line (typing,
// online), and the screen's own buttons. Drawn in the screen, like the tabs'
// Header, so the keyboard-avoiding view can cover the whole screen. A
// conversation passes its mark: a 40 pt avatar beside a bold title, and the
// status line in brand while someone is typing (canvas MobileChat / MobThread).
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, View } from "react-native";
import { useRipple } from "@/components/ui/ripple";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";
import { backIcon, hitSlopFor } from "@/lib/platform-ui";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";
import { BADGE_MAX_FONT_SCALE } from "@/lib/type-scale";

/** A 44 pt round icon button in brand: 48 dp of target on Android through hit slop, with a round ripple there. */
export function HeaderIconButton({
  icon,
  label,
  onPress,
  disabled = false,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** something the screen started must answer first (a save under way): dimmed, ignoring taps */
  disabled?: boolean;
  testID?: string;
}) {
  const { colorScheme } = useColorScheme();
  const ripple = useRipple(true);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      hitSlop={hitSlopFor(44, Platform.OS)}
      android_ripple={ripple}
      className={cn("h-11 w-11 items-center justify-center rounded-full active:bg-secondary", disabled && "opacity-40")}
    >
      <Ionicons name={icon} size={24} color={THEME[colorScheme].primary} />
    </Pressable>
  );
}

interface Props {
  title: string;
  subtitle?: string | null;
  /** The status line is someone typing: drawn in brand. */
  typing?: boolean;
  /** A conversation's mark, beside the title. */
  avatar?: ReactNode;
  right?: ReactNode;
  /** Unread elsewhere, on the back button (MobileChat board); nothing at zero. */
  backBadge?: number;
  /** What the back button reads out (default: "Quay lại"). */
  backLabel?: string;
  /** Where back goes (default: the screen before); a screen that may open on its own has somewhere to land. */
  onBack?: () => void;
  /** Back waits for something the screen started (a save under way). */
  backDisabled?: boolean;
  centered?: boolean;
  flat?: boolean;
  /** A tap on the avatar and title (MobileChat board: the conversation's details live behind its name). */
  onPressTitle?: () => void;
  /** What that tap opens, read out with the title. */
  titleActionLabel?: string;
}

export function ChatHeader({
  title,
  subtitle,
  typing,
  avatar,
  right,
  backBadge = 0,
  backLabel,
  onBack = () => router.back(),
  backDisabled = false,
  centered,
  flat,
  onPressTitle,
  titleActionLabel,
}: Props) {
  const { t } = useTranslation();
  const label = backLabel ?? t("common.back");
  const back = (
    <View className="flex-row items-center">
      {/* Android's back is an arrow, iOS's a chevron (lib/platform-ui.ts). */}
      <HeaderIconButton
        icon={backIcon(Platform.OS)}
        label={backBadge > 0 ? `${label}, ${t("chat.unread_badge_aria", { count: backBadge })}` : label}
        onPress={onBack}
        disabled={backDisabled}
      />
      {backBadge > 0 ? (
        <View
          className="-ms-2.5 min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5"
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Text className="text-meta font-display font-bold text-primary-foreground" maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}>
            {backBadge > 99 ? "99+" : String(backBadge)}
          </Text>
        </View>
      ) : null}
    </View>
  );
  if (!avatar) return <Header title={title} subtitle={subtitle ?? undefined} left={back} right={right} centered={centered} flat={flat} />;
  return (
    <Header
      left={back}
      center={
        <Pressable
          accessibilityRole={onPressTitle ? "button" : undefined}
          accessibilityLabel={onPressTitle ? [title, subtitle, titleActionLabel].filter(Boolean).join(", ") : undefined}
          disabled={!onPressTitle}
          onPress={onPressTitle}
          className="flex-row items-center gap-2.5 active:opacity-70"
        >
          {avatar}
          <View className="flex-1">
            <Text className="text-body font-display font-bold text-foreground" numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text className={cn("text-footnote", typing ? "font-medium text-primary" : "text-muted-foreground")} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
      }
      right={right}
    />
  );
}
