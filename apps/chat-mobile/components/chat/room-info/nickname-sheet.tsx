// A nickname only this person sees for someone in the workspace.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { useSetNickname } from "@/data/mutations/rooms";
import { toast } from "@/data/stores/toast-store";
import { THEME } from "@/lib/theme";

export function NicknameSheet({
  wsId,
  userId,
  name,
  current,
  onClose,
}: {
  wsId: string;
  userId: string | null;
  name: string;
  current: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const setNickname = useSetNickname(wsId);
  const [value, setValue] = useState(current);
  const save = () => {
    if (!userId) return;
    void setNickname
      .mutateAsync({ userId, nickname: value.trim() })
      .then(() => {
        toast.success(value.trim() ? t("chat.nickname_saved") : t("chat.nickname_cleared"));
        onClose();
      })
      .catch(() => toast.error(t("chat.nickname_save_failed")));
  };
  return (
    <BottomSheet visible={userId !== null} onClose={onClose} className="px-4">
      <Text className="mb-1 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {t("chat.nickname_title")}
      </Text>
      <Text className="mb-3 text-footnote text-muted-foreground">{t("chat.nickname_description", { name })}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={t("chat.nickname_label")}
        placeholderTextColor={THEME[colorScheme].mutedForeground}
        accessibilityLabel={t("chat.nickname_label")}
        className="mb-4 min-h-12 rounded-control border border-border bg-muted px-3 text-body text-foreground"
      />
      <View className="mb-2 flex-row gap-2">
        {current ? (
          <Button variant="outline" className="flex-1" onPress={() => setValue("")}>
            <Text>{t("chat.nickname_clear")}</Text>
          </Button>
        ) : null}
        <Button className="flex-1" onPress={save}>
          <Text>{t("common.save")}</Text>
        </Button>
      </View>
    </BottomSheet>
  );
}
