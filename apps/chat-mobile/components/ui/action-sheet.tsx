// A bottom sheet of actions for a long-press, the same on iOS and Android
// (Alert takes three buttons at most on Android, ActionSheetIOS is iOS only),
// dragged down or flicked to close (components/ui/bottom-sheet.tsx).
// The canvas look (MobSheets, MobStates): 24pt top corners, a grabber, a bold
// title, then 48pt rows with an icon, or round tinted tiles four to a row
// (`layout="tiles"`, the attach sheet), and a "Hủy" pill.
import { Ionicons } from "@expo/vector-icons";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useRipple } from "@/components/ui/ripple";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { THEME } from "@/lib/theme";
import type { Tint } from "@/lib/tint";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";

export interface SheetAction {
  key: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** The tile's wash in the tiles layout (blue when unset). */
  tint?: Tint;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Read out for the sheet when it shows no title (the room menu names its room this way). */
  label?: string;
  /** Lifted over the dimmed screen above the sheet, such as the room a list row's menu acts on. */
  above?: ReactNode;
  actions: SheetAction[];
  layout?: "list" | "tiles";
}

/**
 * iOS will not present a picker or an alert over a modal that is still closing:
 * `choose` closes it and runs the action once it is gone (onDismiss is iOS-only).
 */
export function useAfterDismiss(onClose: () => void) {
  const pending = useRef<(() => void) | null>(null);
  return {
    choose: (run: () => void) => {
      if (Platform.OS === "ios") pending.current = run;
      onClose();
      if (Platform.OS !== "ios") run();
    },
    onDismiss: () => {
      const run = pending.current;
      pending.current = null;
      run?.();
    },
  };
}

export function ActionSheet({ visible, onClose, title, label, above, actions, layout = "list" }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { choose, onDismiss } = useAfterDismiss(onClose);
  const ripple = useRipple();
  return (
    <BottomSheet visible={visible} onClose={onClose} onDismiss={onDismiss} above={above} className="pb-2" accessibilityLabel={label}>
      {title ? (
        <Text className="px-5 pb-3 text-title3 font-display font-bold text-foreground" numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {layout === "tiles" ? (
        <View className="flex-row flex-wrap px-2.5 pb-3 pt-1">
          {actions.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              // The label, not the children: the icon's glyph is a character a screen reader would spell.
              accessibilityLabel={action.label}
              android_ripple={ripple}
              className="w-1/4 items-center gap-2 rounded-2xl py-2 active:bg-secondary"
              onPress={() => choose(action.onPress)}
            >
              <TintTile tint={action.tint ?? "blue"} icon={action.icon ?? "ellipsis-horizontal"} size={60} iconSize={26} className="rounded-full" />
              <Text className="px-1 text-center text-footnote font-medium text-foreground" numberOfLines={2}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View>
          {actions.map((action, index) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              // The label, not the children: the icon's glyph is a character a screen reader would spell.
              accessibilityLabel={action.label}
              android_ripple={ripple}
              className={cn("min-h-[52px] flex-row items-center gap-3.5 px-5 active:bg-secondary", index > 0 && "border-t border-border")}
              onPress={() => choose(action.onPress)}
            >
              {action.icon ? <Ionicons name={action.icon} size={20} color={action.destructive ? theme.destructive : theme.mutedForeground} /> : null}
              <Text className={cn("flex-1 text-body", action.destructive ? "text-destructive" : "text-foreground")}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View className="px-4 pt-3">
        <Pressable accessibilityRole="button" className="min-h-12 items-center justify-center rounded-full bg-muted px-4 py-3 active:opacity-70" onPress={onClose}>
          <Text className="text-body font-semibold text-foreground">{t("common.cancel")}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
