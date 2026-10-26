// The letters down the right edge of the contacts tab (MobContacts board); a
// tap jumps the list to that letter's section. Moved out of the route file, which only composes.
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";

export function LetterIndex({ letters, onJump }: { letters: readonly string[]; onJump: (sectionIndex: number) => void }) {
  const { t } = useTranslation();
  return (
    <View
      className="absolute bottom-0 right-0 top-0 justify-center pe-1"
      accessibilityRole="menubar"
      accessibilityLabel={t("chat.mobile.alphabet_index")}
    >
      {letters.map((letter, index) => (
        <Pressable
          key={letter}
          accessibilityRole="button"
          accessibilityLabel={letter}
          hitSlop={{ left: 12, right: 6 }}
          onPress={() => onJump(index)}
          className="w-6 items-center py-[1px]"
        >
          <Text className="text-meta font-semibold text-primary">{letter}</Text>
        </Pressable>
      ))}
    </View>
  );
}
