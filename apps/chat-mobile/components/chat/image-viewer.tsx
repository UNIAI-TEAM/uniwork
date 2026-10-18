// A picture full screen, on black (canvas MobStates, "Xem ảnh"): a top bar
// with the close button, who sent it and when (the file name when the caller
// gives neither), and the picture fitted to the screen.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";

export function ImageViewer({ image, onClose }: { image: { url: string; name: string; sender?: string; time?: string } | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={image !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black">
        <SafeAreaView edges={["top"]}>
          <View className="flex-row items-center gap-2.5 px-3 pb-2.5 pt-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.message_list.image_preview_close")}
              onPress={onClose}
              className="h-11 w-11 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
            >
              {/* The viewer is black in both schemes, so the dark scheme's ink is its white. */}
              <Ionicons name="close" size={24} color={THEME.dark.foreground} />
            </Pressable>
            {image ? (
              <View className="flex-1">
                <Text className="text-[15px] font-semibold text-white" numberOfLines={1}>
                  {image.sender || image.name}
                </Text>
                {image.time ? <Text className="text-[13px] text-white/70">{image.time}</Text> : null}
              </View>
            ) : null}
          </View>
        </SafeAreaView>
        {image ? <Image source={{ uri: image.url }} contentFit="contain" style={{ flex: 1 }} accessibilityLabel={image.name} /> : null}
        <SafeAreaView edges={["bottom"]} />
      </View>
    </Modal>
  );
}
