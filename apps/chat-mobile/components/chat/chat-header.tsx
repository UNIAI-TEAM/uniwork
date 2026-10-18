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
}

export function ChatHeader({ title, subtitle, typing, avatar, right }: Props) {
  const { t } = useTranslation();
  const back = <HeaderIconButton icon="chevron-back" label={t("common.back")} onPress={() => router.back()} />;
  if (!avatar) return <Header title={title} subtitle={subtitle ?? undefined} left={back} right={right} />;
  return (
    <Header
      left={back}
      center={
        <View className="flex-row items-center gap-2.5">
          {avatar}
          <View className="flex-1">
            <Text className="text-base font-bold text-foreground" numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text className={cn("text-[13px]", typing ? "font-medium text-primary" : "text-muted-foreground")} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      }
      right={right}
    />
  );
}
