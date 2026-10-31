// The bar that replaces the composer while messages are selected: copy, forward,
// make a task, delete the ones this person sent, or clear.
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { messagePreviewText } from "@/lib/message-display";
import { THEME } from "@/lib/theme";
import type { TimelineMessage } from "@/lib/timeline-display";
import { cn } from "@/lib/utils";

export function SelectionBar({
  count,
  canDelete,
  onReply,
  onCopy,
  onForward,
  onCreateTask,
  onDelete,
  onClear,
}: {
  count: number;
  canDelete: boolean;
  onReply: () => void;
  onCopy: () => void;
  onForward: () => void;
  onCreateTask: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const actions = [
    { key: "reply", icon: "arrow-undo-outline" as const, label: t("chat.action_reply"), onPress: onReply },
    { key: "copy", icon: "copy-outline" as const, label: t("chat.selection.copy_selected"), onPress: onCopy },
    { key: "task", icon: "checkmark-circle-outline" as const, label: t("chat.selection.create_task_selected"), onPress: onCreateTask },
    { key: "forward", icon: "arrow-redo-outline" as const, label: t("chat.selection.forward_selected"), onPress: onForward },
    ...(canDelete
      ? [{ key: "delete", icon: "trash-outline" as const, label: t("chat.selection.delete_selected"), onPress: onDelete, destructive: true }]
      : []),
    { key: "clear", icon: "close" as const, label: t("chat.selection.clear"), onPress: onClear, separated: true },
  ];
  return (
    <View accessibilityLabel={t("chat.selection.toolbar_aria")} className="border-t border-border bg-card pb-2">
      <Text className="px-5 pb-1 pt-3 text-caption font-semibold text-muted-foreground">
        {t("chat.selection.selected_count", { count })}
      </Text>
      {actions.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          className={cn(
            "min-h-[52px] flex-row items-center gap-3.5 px-5 active:bg-secondary",
            "separated" in action && action.separated && "mt-1 border-t border-border",
          )}
        >
          <Ionicons name={action.icon} size={20} color={"destructive" in action ? theme.destructive : theme.mutedForeground} />
          <Text className={cn("flex-1 text-body", "destructive" in action ? "text-destructive" : "text-foreground")}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The selection bar wired to the open conversation: which rows, and what each action does with them. */
export function ConversationSelection({
  messages,
  selected,
  userId,
  onReply,
  onForward,
  onCreateTask,
  onDelete,
  onClear,
}: {
  messages: readonly TimelineMessage[];
  selected: ReadonlySet<string>;
  userId: string;
  onReply: (message: TimelineMessage) => void;
  onForward: (ids: string[]) => void;
  onCreateTask: (sources: { id: string; body: string; sentAt: number }[]) => void;
  onDelete: (ids: string[]) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const chosen = messages.filter((message) => selected.has(message.id) && message.record);
  const ownIds = chosen.filter((message) => message.sender === userId).map((message) => message.id);
  const newest = [...chosen].sort((a, b) => a.ts - b.ts).at(-1);
  return (
    <SelectionBar
      count={selected.size}
      canDelete={ownIds.length > 0}
      onReply={() => {
        if (newest) onReply(newest);
      }}
      onCopy={() => {
        const text = chosen
          .flatMap((message) => (message.record ? [messagePreviewText(message.record, t)] : []))
          .join("\n");
        void Clipboard.setStringAsync(text);
        onClear();
      }}
      onForward={() => onForward(chosen.map((message) => message.id))}
      onCreateTask={() =>
        onCreateTask(
          chosen.flatMap((message) => (message.record ? [{ id: message.id, body: message.record.body, sentAt: message.ts }] : [])),
        )
      }
      onDelete={() => {
        if (ownIds.length === 0) return;
        Alert.alert(t("chat.selection.delete_confirm_title"), t("chat.selection.delete_confirm_description", { count: ownIds.length }), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("chat.action_delete"), style: "destructive", onPress: () => onDelete(ownIds) },
        ]);
      }}
      onClear={onClear}
    />
  );
}
