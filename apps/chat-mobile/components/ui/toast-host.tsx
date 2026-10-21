// Draws data/stores/toast-store.ts: the toasts stacked under the status bar,
// above every screen and sheet's content, each tappable to dismiss. A new
// toast is also announced: TalkBack hears the polite live region, VoiceOver
// (where live regions do nothing) gets announceForAccessibility.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToastStore, type Toast, type ToastTone } from "@/data/stores/toast-store";
import { Text } from "@/components/ui/text";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

const TONE: Record<ToastTone, { box: string; icon: keyof typeof Ionicons.glyphMap }> = {
  error: { box: "bg-destructive-solid", icon: "alert-circle" },
  info: { box: "bg-foreground", icon: "information-circle" },
  success: { box: "bg-success-solid", icon: "checkmark-circle" },
};

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const tone = TONE[toast.tone];
  // The solid tones carry the light foreground in both modes (as the sign-out button does); info inverts the page.
  const ink = toast.tone === "info" ? THEME[colorScheme].background : THEME.light.primaryForeground;
  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="alert"
      accessibilityLabel={toast.message}
      accessibilityHint={t("mobile.toast.dismiss")}
      accessibilityLiveRegion="polite"
      testID={`toast-${toast.tone}`}
      className={cn("min-h-[48px] flex-row items-center gap-2.5 rounded-xl px-3.5 py-3 shadow-md shadow-black/20 active:opacity-90", tone.box)}
      style={continuousCorners}
    >
      <Ionicons name={tone.icon} size={20} color={ink} />
      <Text className="flex-1 text-subhead font-medium leading-5" style={{ color: ink }}>
        {toast.message}
      </Text>
    </Pressable>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const announced = useRef(new Set<number>());

  useEffect(() => {
    for (const toast of toasts) {
      if (announced.current.has(toast.id)) continue;
      announced.current.add(toast.id);
      AccessibilityInfo.announceForAccessibility(toast.message);
    }
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 top-0 gap-2 px-3" style={{ paddingTop: insets.top + 8 }}>
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </View>
  );
}
