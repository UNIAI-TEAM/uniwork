// "Thêm cảm xúc" (MobileActions board): past the six quick reactions, a grid
// of the emoji people reach for, in a bottom sheet. No native picker on
// either platform reaches the app, so the set is fixed.
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";

const EMOJI = [
  "👍", "❤️", "😂", "🎉", "😮", "🙏", "😢", "🔥", "👏", "✅", "👀", "💯",
  "😍", "🤔", "😅", "😎", "🥳", "😭", "😡", "🤝", "💪", "🙌", "👌", "🫡",
  "⭐", "🚀", "💡", "📌", "📝", "☕", "🍀", "🌟", "❗", "❓", "⏰", "🎯",
] as const;

export function EmojiSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} dragFrom="handle" sizeClassName="max-h-[60%]" className="pb-2">
      <Text accessibilityRole="header" className="px-5 pb-2 text-title3 font-display font-bold text-foreground">
        {t("chat.action_react_more")}
      </Text>
      <ScrollView contentContainerClassName="flex-row flex-wrap px-3 pb-3">
        {EMOJI.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={emoji}
            onPress={() => onPick(emoji)}
            className="min-h-14 w-1/6 items-center justify-center rounded-2xl py-1 active:bg-secondary"
          >
            <Text className="text-emoji-lg leading-[36px]">{emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}
