// The chat dialog look (packages/views/chat/chat-dialog-look.ts) on a phone
// sheet: a display title with one line of why, a labelled muted field, and a
// footer whose hint sits left of a round submit.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { THEME } from "@/lib/theme";

/** A dialog field: the web's 44px muted well, 12px corners. */
export const FORM_FIELD = "min-h-11 rounded-lg border border-border bg-muted px-3.5 text-body text-foreground";

export function FormSheetHeader({
  title,
  description,
  onClose,
}: {
  title: string;
  description?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  return (
    <View className="mb-4 flex-row items-start gap-2 px-4">
      <View className="min-w-0 flex-1 gap-1 pt-1">
        <Text className="text-title2 font-display font-bold text-foreground" accessibilityRole="header">
          {title}
        </Text>
        {description ? <Text className="text-caption text-muted-foreground">{description}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        onPress={onClose}
        className="h-11 w-11 items-center justify-center rounded-lg"
      >
        <Ionicons name="close" size={20} color={THEME[colorScheme].mutedForeground} />
      </Pressable>
    </View>
  );
}

/** A field's name, and how much of its limit is used. */
export function FormSheetLabel({ label, count, max }: { label: string; count?: number; max?: number }) {
  return (
    <View className="mb-1.5 flex-row items-baseline justify-between gap-3">
      <Text className="text-footnote font-semibold text-foreground">{label}</Text>
      {count !== undefined && max !== undefined ? (
        <Text className="text-caption text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }}>
          {count}/{max}
        </Text>
      ) : null}
    </View>
  );
}

export function FormSheetFooter({
  hint,
  label,
  disabled,
  onPress,
  testID,
}: {
  hint?: string | null;
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View className="mt-2 flex-row items-center gap-3 border-t border-border px-4 py-3">
      {hint ? (
        <Text className="min-w-0 flex-1 text-caption text-muted-foreground" numberOfLines={2}>
          {hint}
        </Text>
      ) : (
        <View className="flex-1" />
      )}
      <Button
        size="sm"
        disabled={disabled}
        accessibilityState={{ disabled }}
        onPress={onPress}
        className="rounded-full px-4"
        testID={testID}
      >
        <Text className="font-semibold">{label}</Text>
      </Button>
    </View>
  );
}
