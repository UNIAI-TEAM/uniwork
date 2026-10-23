// The header of a pushed chat screen: back, title with a status line (typing,
// online), and the screen's own buttons. Drawn in the screen, like the tabs'
// Header, so the keyboard-avoiding view can cover the whole screen. A
// conversation passes its mark: a 40 pt avatar beside a bold title, and the
// status line in brand while someone is typing (canvas MobileChat / MobThread).
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

export function HeaderIconButton({ icon, label, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} className="h-11 w-11 items-center justify-center rounded-full active:bg-secondary">
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
  centered?: boolean;
  flat?: boolean;
  /** A tap on the avatar and title (MobileChat board: the conversation's details live behind its name). */
  onPressTitle?: () => void;
  /** What that tap opens, read out with the title. */
  titleActionLabel?: string;
}

export function ChatHeader({ title, subtitle, typing, avatar, right, backBadge = 0, backLabel, centered, flat, onPressTitle, titleActionLabel }: Props) {
  const { t } = useTranslation();
  const label = backLabel ?? t("common.back");
  const back = (
    <View className="flex-row items-center">
      <HeaderIconButton icon="chevron-back" label={backBadge > 0 ? `${label}, ${t("chat.unread_badge_aria", { count: backBadge })}` : label} onPress={() => router.back()} />
      {backBadge > 0 ? (
        <View className="-ml-2.5 h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5" accessibilityElementsHidden importantForAccessibility="no">
          <Text className="text-[11px] font-display font-bold text-primary-foreground">{backBadge > 99 ? "99+" : String(backBadge)}</Text>
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
            <Text className="text-base font-display font-bold text-foreground" numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text className={cn("text-[13px]", typing ? "font-medium text-primary" : "text-muted-foreground")} numberOfLines={1}>
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
