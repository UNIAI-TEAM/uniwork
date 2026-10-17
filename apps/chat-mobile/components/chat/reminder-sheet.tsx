// Creating a reminder (M3), the phone's chat-create-reminder-dialog.tsx: what
// to be reminded of, when (the web's quick presets; picking any other moment
// stays on the web, the phone has no date picker yet), and how often. The time
// is worked out at the send, as on the web: "in 15 minutes" means from then.
import { canSubmitReminder, remindAtFromPreset, REMINDER_REPEAT_OPTIONS, type ReminderRepeat } from "@uniwork/core/chat/reminder-utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

const PRESETS = ["15m", "30m", "tomorrow_9"] as const;
type Preset = (typeof PRESETS)[number];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn("min-h-11 justify-center rounded-full border px-4", selected ? "border-primary bg-primary/10" : "border-border")}
    >
      <Text className={cn("text-sm", selected ? "font-semibold text-primary" : "text-foreground")}>{label}</Text>
    </Pressable>
  );
}

export function ReminderSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { body: string; remindAt: Date; repeat: ReminderRepeat }) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [body, setBody] = useState("");
  const [preset, setPreset] = useState<Preset>("30m");
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");
  const ready = canSubmitReminder(body, remindAtFromPreset(preset));

  const create = () => {
    const remindAt = remindAtFromPreset(preset);
    if (!remindAt || !canSubmitReminder(body, remindAt)) return;
    onCreate({ body, remindAt, repeat });
    setBody("");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="gap-3 rounded-t-2xl border-t border-border bg-background px-4 pt-4" testID="reminder-sheet">
        <Text className="text-lg font-semibold text-foreground">{t("chat.reminder_create_title")}</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t("chat.reminder_body_placeholder")}
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          accessibilityLabel={t("chat.reminder_body_label")}
          multiline
          className="min-h-11 rounded-xl bg-secondary px-4 py-2.5 text-base text-foreground"
        />
        <Text className="text-sm text-muted-foreground">{t("chat.reminder_quick_time_label")}</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {PRESETS.map((value) => (
            <Chip key={value} label={t(`chat.reminder_preset_${value}`)} selected={preset === value} onPress={() => setPreset(value)} />
          ))}
        </View>
        <Text className="text-sm text-muted-foreground">{t("chat.reminder_repeat_label")}</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {REMINDER_REPEAT_OPTIONS.map((value) => (
            <Chip key={value} label={t(`chat.reminder_repeat_${value}`)} selected={repeat === value} onPress={() => setRepeat(value)} />
          ))}
        </View>
        <Button disabled={!ready} accessibilityState={{ disabled: !ready }} onPress={create} className="mb-3 min-h-11" testID="reminder-create">
          <Text>{t("chat.reminder_create_submit")}</Text>
        </Button>
      </SafeAreaView>
    </Modal>
  );
}
