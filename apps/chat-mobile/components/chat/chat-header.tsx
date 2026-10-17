// The header of a pushed chat screen: back, title with a status line (typing,
// online), and the screen's own buttons. Drawn in the screen, like the tabs'
// Header, so the keyboard-avoiding view can cover the whole screen.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { Header } from "@/components/ui/header";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export function HeaderIconButton({ icon, label, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} className="h-11 w-11 items-center justify-center rounded-full active:bg-secondary">
      <Ionicons name={icon} size={24} color={THEME[colorScheme].primary} />
    </Pressable>
  );
}

export function ChatHeader({ title, subtitle, right }: { title: string; subtitle?: string | null; right?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Header
      title={title}
      subtitle={subtitle ?? undefined}
      left={<HeaderIconButton icon="chevron-back" label={t("common.back")} onPress={() => router.back()} />}
      right={right}
    />
  );
}
