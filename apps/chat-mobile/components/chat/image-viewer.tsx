// A picture full screen, on black, with one close button.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function ImageViewer({ image, onClose }: { image: { url: string; name: string } | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={image !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black">
        {image ? <Image source={{ uri: image.url }} contentFit="contain" style={{ flex: 1 }} accessibilityLabel={image.name} /> : null}
        <SafeAreaView edges={["top"]} className="absolute right-0 top-0">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.message_list.image_preview_close")}
            onPress={onClose}
            className="m-2 h-11 w-11 items-center justify-center rounded-full bg-black/50"
          >
            <Ionicons name="close" size={26} color="white" />
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
