// "Thêm cảm xúc" (MobileActions board): past the six quick reactions, a grid
// of the emoji people reach for, in a bottom sheet. No native picker on
// either platform reaches the app, so the set is fixed.
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SheetGrabber } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { continuousCorners } from "@/lib/radius";

const EMOJI = [
  "👍", "❤️", "😂", "🎉", "😮", "🙏", "😢", "🔥", "👏", "✅", "👀", "💯",
  "😍", "🤔", "😅", "😎", "🥳", "😭", "😡", "🤝", "💪", "🙌", "👌", "🫡",
  "⭐", "🚀", "💡", "📌", "📝", "☕", "🍀", "🌟", "❗", "❓", "⏰", "🎯",
] as const;

export function EmojiSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="max-h-[60%] rounded-t-[24px] bg-card pb-2" style={continuousCorners} accessibilityViewIsModal>
        <SheetGrabber />
        <Text accessibilityRole="header" className="px-5 pb-2 text-lg font-display font-bold text-foreground">
          {t("chat.action_react_more")}
        </Text>
        <ScrollView contentContainerClassName="flex-row flex-wrap px-3 pb-3">
          {EMOJI.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={emoji}
              onPress={() => onPick(emoji)}
              className="h-14 w-1/6 items-center justify-center rounded-2xl active:bg-secondary"
            >
              <Text className="text-[30px] leading-[36px]">{emoji}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
