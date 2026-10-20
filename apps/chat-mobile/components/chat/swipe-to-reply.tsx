// A swipe to the right on a bubble quotes it in the composer (bảng Ngôn ngữ:
// past 56 pt), the way WhatsApp and Telegram answer. The long-press menu keeps
// "Trả lời" for anyone who cannot swipe.
import { Ionicons } from "@expo/vector-icons";
import { useRef, type ReactNode } from "react";
import { View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

const REPLY_SWIPE = 56;

export function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: ReactNode }) {
  const ref = useRef<SwipeableMethods>(null);
  const { colorScheme } = useColorScheme();
  if (!enabled) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      leftThreshold={REPLY_SWIPE}
      overshootLeft={false}
      dragOffsetFromLeftEdge={12}
      renderLeftActions={() => (
        <View className="w-14 items-center justify-center">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-chat-chip">
            <Ionicons name="arrow-undo" size={18} color={THEME[colorScheme].primary} />
          </View>
        </View>
      )}
      onSwipeableWillOpen={() => {
        onReply();
        ref.current?.close();
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
