// A bottom sheet of actions for a long-press, the same on iOS and Android
// (Alert takes three buttons at most on Android, ActionSheetIOS is iOS only).
// `header` holds anything above the list, such as the quick reactions.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export interface SheetAction {
  key: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  header?: ReactNode;
  actions: SheetAction[];
}

export function ActionSheet({ visible, onClose, title, header, actions }: Props) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="bg-background rounded-t-2xl border-t border-border">
        {title ? (
          <Text className="px-5 pt-4 pb-2 text-sm text-muted-foreground" numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {header}
        <View className="py-1">
          {actions.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              className="min-h-12 justify-center px-5 active:bg-secondary"
              onPress={() => {
                onClose();
                action.onPress();
              }}
            >
              <Text className={cn("text-base", action.destructive ? "text-destructive" : "text-foreground")}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" className="min-h-12 justify-center px-5 active:bg-secondary" onPress={onClose}>
            <Text className="text-base font-semibold text-foreground">{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
