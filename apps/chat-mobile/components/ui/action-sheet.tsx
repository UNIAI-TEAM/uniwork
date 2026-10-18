// A bottom sheet of actions for a long-press, the same on iOS and Android
// (Alert takes three buttons at most on Android, ActionSheetIOS is iOS only).
// The canvas look (MobSheets, MobStates): 24pt top corners, a grabber, a bold
// title, then 48pt rows with an icon, or round tinted tiles four to a row
// (`layout="tiles"`, the attach sheet), and a "Hủy" pill.
import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import type { Tint } from "@/lib/tint";
import { useColorScheme } from "@/lib/use-color-scheme";
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

export function SheetGrabber() {
  return <View className="mx-auto mb-3 mt-2 h-[5px] w-9 rounded-full bg-muted-foreground/30" />;
}

export function ActionSheet({ visible, onClose, title, actions, layout = "list" }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { choose, onDismiss } = useAfterDismiss(onClose);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="rounded-t-[24px] bg-card pb-2" style={continuousCorners}>
        <SheetGrabber />
        {title ? (
          <Text className="px-5 pb-3 text-lg font-bold text-foreground" numberOfLines={2} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {layout === "tiles" ? (
          <View className="flex-row flex-wrap px-2.5 pb-3 pt-1">
            {actions.map((action) => (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                className="w-1/4 items-center gap-2 rounded-2xl py-2 active:bg-secondary"
                onPress={() => choose(action.onPress)}
              >
                <TintTile tint={action.tint ?? "blue"} icon={action.icon ?? "ellipsis-horizontal"} size={60} iconSize={26} className="rounded-full" />
                <Text className="px-1 text-center text-[13px] font-medium text-foreground" numberOfLines={2}>
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
                className={cn("min-h-12 flex-row items-center gap-3.5 px-5 active:bg-secondary", index > 0 && "border-t border-border")}
                onPress={() => choose(action.onPress)}
              >
                {action.icon ? <Ionicons name={action.icon} size={22} color={action.destructive ? theme.destructive : theme.mutedForeground} /> : null}
                <Text className={cn("flex-1 text-base", action.destructive ? "text-destructive" : "text-foreground")}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View className="px-4 pt-3">
          <Pressable accessibilityRole="button" className="h-12 items-center justify-center rounded-full bg-muted active:opacity-70" onPress={onClose}>
            <Text className="text-base font-semibold text-foreground">{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
