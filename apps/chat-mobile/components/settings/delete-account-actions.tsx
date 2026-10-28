// The two buttons at the foot of Settings › Delete account (delete-account.tsx): the destructive confirm, whose words
// follow the step (close the organization, hand it over, delete) and which turns into a spinner and the words of
// what runs, and the cancel. The confirm button carries its name for a screen reader, once; its spinner is drawn for
// the eye only. An owner left with only the web's way out (an older server) gets no confirm at all.
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface Props {
  /** what the confirm button says now */
  label: string;
  /** a request runs (the hand-over, the erasure): the spinner shows */
  busy: boolean;
  /** a step is under way (the proof sheet included): taps wait */
  running: boolean;
  /** only the way out on the web is left */
  stranded: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteAccountActions({ label, busy, running, stranded, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <View className="gap-2.5 pt-1">
      {stranded ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy, disabled: running }}
          testID="delete-account-confirm"
          onPress={onConfirm}
          className={cn(
            "min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-destructive-solid py-3",
            running ? "opacity-70" : "active:opacity-90",
          )}
        >
          {busy ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <ActivityIndicator accessibilityLabel={label} color={THEME.light.primaryForeground} />
            </View>
          ) : null}
          <Text className="text-body font-semibold text-on-solid">{label}</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: running }}
        onPress={onCancel}
        className="min-h-12 items-center justify-center rounded-full bg-muted px-4 py-3 active:opacity-70"
      >
        <Text className="text-body font-semibold text-foreground">{t("settings.security.delete.cancel")}</Text>
      </Pressable>
    </View>
  );
}
