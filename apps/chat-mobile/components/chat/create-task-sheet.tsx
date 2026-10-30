// The form behind "Tạo việc" in a conversation, laid out like the web composer:
// a heading for the title, a plain description, then property pills. The task
// is created only when the person submits, through the chat create-from-message command.
import { Ionicons } from "@expo/vector-icons";
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
import { dateTimeFormat } from "@/lib/locale-format";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";

const TITLE_MAX = 200;
const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"] as const;
type Priority = (typeof PRIORITIES)[number];
type Status = (typeof STATUSES)[number];
type OpenField = "status" | "priority" | "due";
const DUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatDue(value: string, locale: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return dateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
}

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

function Pill({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: selected }}
      onPress={onPress}
      className={cn("min-h-11 flex-row items-center gap-1.5 rounded-full border px-3", selected ? "border-primary bg-primary/10" : "border-border")}
    >
      <Ionicons name={icon} size={15} color={selected ? THEME[colorScheme].primary : THEME[colorScheme].mutedForeground} />
      <Text className="text-caption font-medium text-foreground" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn("min-h-11 justify-center rounded-full border px-3", selected ? "border-primary bg-primary/10" : "border-border")}
    >
      <Text className={cn("text-caption", selected ? "font-semibold text-primary" : "font-medium text-foreground")}>{label}</Text>
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
  onCreate: (input: { title: string; description: string; priority: Priority; status: Status; dueDate?: string }) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const ink = THEME[colorScheme].mutedForeground;
  const [titleValue, setTitleValue] = useState(title);
  const [descriptionValue, setDescriptionValue] = useState(description);
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<Status>("todo");
  const [due, setDue] = useState("");
  const [openField, setOpenField] = useState<OpenField | null>(null);
  const [saving, setSaving] = useState(false);
  const dueOk = due.trim() === "" || DUE_DATE.test(due.trim());
  const ready = titleValue.trim().length > 0 && dueOk && !saving;
  const heading = count > 1 ? t("chat.link.create_task_title_multi", { count }) : t("chat.link.create_task_title");
  const dueLabel = DUE_DATE.test(due.trim()) ? formatDue(due.trim(), i18n.language) : t("chat.link.due_label");

  useEffect(() => {
    if (!visible) return;
    setTitleValue(title);
    setDescriptionValue(description);
    setPriority("medium");
    setStatus("todo");
    setDue("");
    setOpenField(null);
    setSaving(false);
  }, [visible, messageId, title, description]);

  const toggle = (field: OpenField) => setOpenField((current) => (current === field ? null : field));

  const create = () => {
    if (!ready) return;
    const dueDate = due.trim();
    setSaving(true);
    void onCreate({
      title: titleValue.trim().slice(0, TITLE_MAX),
      description: descriptionValue.trim(),
      priority,
      status,
      ...(dueDate ? { dueDate } : {}),
    })
      .then(onClose)
      .catch(() => setSaving(false));
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0">
      <View className="mb-1 flex-row items-center justify-between gap-2 px-4">
        <Text className="min-w-0 flex-1 text-body font-medium text-foreground" accessibilityRole="header" numberOfLines={2}>
          {heading}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          className="h-11 w-11 items-center justify-center"
        >
          <Ionicons name="close" size={18} color={ink} />
        </Pressable>
      </View>
      <TextInput
        value={titleValue}
        onChangeText={setTitleValue}
        placeholder={t("tasks.create.title_placeholder")}
        placeholderTextColor={ink}
        accessibilityLabel={t("tasks.create.title_placeholder")}
        maxLength={TITLE_MAX}
        className="px-4 py-1 text-title2 font-semibold text-foreground"
      />
      <TextInput
        value={descriptionValue}
        onChangeText={setDescriptionValue}
        placeholder={t("tasks.create.description_placeholder")}
        placeholderTextColor={ink}
        accessibilityLabel={t("chat.link.description_label")}
        multiline
        className="min-h-20 px-4 py-2 text-body text-foreground"
      />
      <View className="flex-row flex-wrap gap-1.5 px-4 py-2">
        <Pill icon="ellipse-outline" label={t(`tasks.status_${status}`)} selected={openField === "status"} onPress={() => toggle("status")} />
        <Pill
          icon="bar-chart-outline"
          label={t(`tasks.priority_${priority}`)}
          selected={openField === "priority"}
          onPress={() => toggle("priority")}
        />
        <Pill icon="calendar-outline" label={dueLabel} selected={openField === "due"} onPress={() => toggle("due")} />
      </View>
      {openField === "status" ? (
        <View className="flex-row flex-wrap gap-1.5 px-4 pb-2">
          {STATUSES.map((item) => (
            <Choice key={item} label={t(`tasks.status_${item}`)} selected={status === item} onPress={() => setStatus(item)} />
          ))}
        </View>
      ) : null}
      {openField === "priority" ? (
        <View className="flex-row flex-wrap gap-1.5 px-4 pb-2">
          {PRIORITIES.map((item) => (
            <Choice key={item} label={t(`tasks.priority_${item}`)} selected={priority === item} onPress={() => setPriority(item)} />
          ))}
        </View>
      ) : null}
      {openField === "due" ? (
        <TextInput
          value={due}
          onChangeText={setDue}
          placeholder={t("chat.link.due_placeholder")}
          placeholderTextColor={ink}
          accessibilityLabel={t("chat.link.due_label")}
          autoCapitalize="none"
          className="mx-4 mb-2 min-h-11 rounded-full border border-border px-3 py-2 text-body text-foreground"
        />
      ) : null}
      <View className="flex-row items-center justify-end border-t border-border px-4 py-3">
        <Button size="sm" disabled={!ready} onPress={create} className="min-w-28">
          <Text>{saving ? t("tasks.create.creating") : t("common.create")}</Text>
        </Button>
      </View>
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
    status: Status;
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
            status: input.status,
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
