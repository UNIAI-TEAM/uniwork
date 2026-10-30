// The form behind "Tạo việc" in a conversation: title, description, priority
// and an optional due date, prefilled from the message. The task is created
// only when the person submits, through the chat create-from-message command.
import { deserializeMessageBodyToComposerDraft } from "@uniwork/core/chat/chat-mention-utils";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { toast } from "@/data/stores/toast-store";
import type { ConversationSheet } from "@/lib/conversation-sheets";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";

const TITLE_MAX = 200;
const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITIES)[number];
const DUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type TaskDraftSource = { id: string; body: string; sentAt?: number };

/** Newest message is the one the task links to; every message seeds the description. */
export function taskDraftFromSources(sources: readonly TaskDraftSource[]): {
  messageId: string;
  title: string;
  description: string;
} | null {
  if (sources.length === 0) return null;
  const ordered = [...sources].sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0) || a.id.localeCompare(b.id));
  const anchor = ordered[ordered.length - 1];
  if (!anchor) return null;
  const description = ordered
    .map((source) => deserializeMessageBodyToComposerDraft(source.body).trim())
    .filter(Boolean)
    .join("\n\n");
  return { messageId: anchor.id, title: titleFromMessageBody(anchor.body).slice(0, TITLE_MAX), description };
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "min-h-11 justify-center rounded-full border px-3.5 py-2",
        selected ? "border-primary bg-primary/10" : "border-border bg-card",
      )}
    >
      <Text className={cn("text-callout", selected ? "font-semibold text-primary" : "font-medium text-foreground")}>{label}</Text>
    </Pressable>
  );
}

export function CreateTaskSheet({
  visible,
  messageId,
  title,
  description,
  count,
  onClose,
  onCreate,
}: {
  visible: boolean;
  messageId: string;
  title: string;
  description: string;
  count: number;
  onClose: () => void;
  onCreate: (input: { title: string; description: string; priority: Priority; dueDate?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const ink = THEME[colorScheme].mutedForeground;
  const [titleValue, setTitleValue] = useState(title);
  const [descriptionValue, setDescriptionValue] = useState(description);
  const [priority, setPriority] = useState<Priority>("medium");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const dueOk = due.trim() === "" || DUE_DATE.test(due.trim());
  const ready = titleValue.trim().length > 0 && dueOk && !saving;

  useEffect(() => {
    if (!visible) return;
    setTitleValue(title);
    setDescriptionValue(description);
    setPriority("medium");
    setDue("");
    setSaving(false);
  }, [visible, messageId, title, description]);

  const create = () => {
    if (!ready) return;
    const dueDate = due.trim();
    setSaving(true);
    void onCreate({
      title: titleValue.trim().slice(0, TITLE_MAX),
      description: descriptionValue.trim(),
      priority,
      ...(dueDate ? { dueDate } : {}),
    })
      .then(onClose)
      .catch(() => setSaving(false));
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} className="px-4">
      <Text className="mb-1 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {count > 1 ? t("chat.link.create_task_title_multi", { count }) : t("chat.link.create_task_title")}
      </Text>
      <Text className="mb-3 text-footnote text-muted-foreground">
        {count > 1 ? t("chat.link.create_task_description_multi") : t("chat.link.create_task_description")}
      </Text>
      <Text className="mb-1 text-caption font-semibold text-muted-foreground">{t("chat.link.title_label")}</Text>
      <TextInput
        value={titleValue}
        onChangeText={setTitleValue}
        placeholder={t("chat.link.title_label")}
        placeholderTextColor={ink}
        accessibilityLabel={t("chat.link.title_label")}
        className="mb-3 min-h-12 rounded-control border border-border bg-muted px-3 py-2.5 text-body text-foreground"
      />
      <Text className="mb-1 text-caption font-semibold text-muted-foreground">{t("chat.link.description_label")}</Text>
      <TextInput
        value={descriptionValue}
        onChangeText={setDescriptionValue}
        placeholder={t("chat.link.description_placeholder")}
        placeholderTextColor={ink}
        accessibilityLabel={t("chat.link.description_label")}
        multiline
        className="mb-3 min-h-24 rounded-control border border-border bg-muted px-3 py-2.5 text-body text-foreground"
      />
      <Text className="mb-2 text-caption font-semibold text-muted-foreground">{t("chat.link.priority_label")}</Text>
      <View className="mb-3 flex-row flex-wrap gap-2">
        {PRIORITIES.map((item) => (
          <Chip key={item} label={t(`chat.link.priority_${item}`)} selected={priority === item} onPress={() => setPriority(item)} />
        ))}
      </View>
      <Text className="mb-1 text-caption font-semibold text-muted-foreground">{t("chat.link.due_label")}</Text>
      <TextInput
        value={due}
        onChangeText={setDue}
        placeholder={t("chat.link.due_placeholder")}
        placeholderTextColor={ink}
        accessibilityLabel={t("chat.link.due_label")}
        autoCapitalize="none"
        className="mb-3 min-h-12 rounded-control border border-border bg-muted px-3 py-2.5 text-body text-foreground"
      />
      <Button disabled={!ready} onPress={create}>
        <Text>{saving ? t("chat.link.creating") : t("chat.link.create")}</Text>
      </Button>
    </BottomSheet>
  );
}

/** The conversation's create-task sheet: open only for that sheet, and say when the task lands or fails. */
export function ConversationCreateTaskSheet({
  sheet,
  onClose,
  create,
}: {
  sheet: ConversationSheet;
  onClose: () => void;
  create: (input: {
    messageId: string;
    title: string;
    description?: string;
    due_date?: string;
    priority: Priority;
  }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const open = sheet.kind === "createTask" ? sheet : null;
  return (
    <CreateTaskSheet
      visible={open !== null}
      messageId={open?.messageId ?? ""}
      title={open?.title ?? ""}
      description={open?.description ?? ""}
      count={open?.count ?? 1}
      onClose={onClose}
      onCreate={async (input) => {
        if (!open) return;
        try {
          await create({
            messageId: open.messageId,
            title: input.title,
            description: input.description || undefined,
            due_date: input.dueDate,
            priority: input.priority,
          });
          toast.success(t("chat.link.created_toast"));
        } catch {
          toast.error(t("chat.link.create_error"));
          throw new Error("chat_task_create_failed");
        }
      }}
    />
  );
}
