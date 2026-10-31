// The form behind "Tạo việc" in a conversation, laid out like the web composer:
// a breadcrumb, a borderless title, a plain description, then property pills
// that open a short list. The task is created only when the person submits.
import { Ionicons } from "@expo/vector-icons";
import { deserializeMessageBodyToComposerDraft } from "@uniwork/core/chat/chat-mention-utils";
import { titleFromMessageBody } from "@uniwork/core/chat/message-links";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { toast } from "@/data/stores/toast-store";
import type { ConversationSheet } from "@/lib/conversation-sheets";
import { dateTimeFormat } from "@/lib/locale-format";
import { THEME } from "@/lib/theme";
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

function PropertyPill({
  icon,
  label,
  open,
  quiet,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  open: boolean;
  quiet: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const ink = quiet && !open ? THEME[colorScheme].mutedForeground : THEME[colorScheme].foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      className={cn(
        "min-h-11 max-w-56 flex-row items-center gap-1.5 rounded-full border border-border/80 px-3",
        open ? "bg-accent" : "bg-background",
      )}
    >
      <Ionicons name={icon} size={15} color={ink} />
      <Text className={cn("text-caption font-medium", quiet && !open ? "text-muted-foreground" : "text-foreground")} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function OptionMenu({
  options,
  selected,
  onSelect,
}: {
  options: readonly { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <ScrollView className="mx-4 mb-2 max-h-56 rounded-xl border border-border" keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      {options.map((option) => {
        const on = option.id === selected;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(option.id)}
            className="min-h-11 flex-row items-center justify-between gap-3 px-3"
          >
            <Text className={cn("min-w-0 flex-1 text-body", on ? "font-semibold text-foreground" : "text-foreground")} numberOfLines={1}>
              {option.label}
            </Text>
            {on ? <Ionicons name="checkmark" size={18} color={THEME[colorScheme].primary} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function CreateTaskSheet({
  visible,
  messageId,
  title,
  description,
  count,
  context,
  onClose,
  onCreate,
}: {
  visible: boolean;
  messageId: string;
  title: string;
  description: string;
  count: number;
  /** The room the task is being made from, shown ahead of the heading the way the web shows the workspace. */
  context?: string;
  onClose: () => void;
  onCreate: (input: { title: string; description: string; priority: Priority; status: Status; dueDate?: string }) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const ink = THEME[colorScheme].mutedForeground;
  const [titleValue, setTitleValue] = useState(title);
  const [descriptionValue, setDescriptionValue] = useState(description);
  const [priority, setPriority] = useState<Priority>("none");
  const [status, setStatus] = useState<Status>("todo");
  const [due, setDue] = useState("");
  const [openField, setOpenField] = useState<OpenField | null>(null);
  const [saving, setSaving] = useState(false);
  const dueTrimmed = due.trim();
  const dueOk = dueTrimmed === "" || DUE_DATE.test(dueTrimmed);
  const ready = titleValue.trim().length > 0 && dueOk && !saving;
  const heading = count > 1 ? t("chat.link.create_task_title_multi", { count }) : t("chat.link.create_task_title");
  const dueLabel = DUE_DATE.test(dueTrimmed) ? formatDue(dueTrimmed, i18n.language) : t("chat.link.due_label");
  const place = context?.trim() ?? "";

  useEffect(() => {
    if (!visible) return;
    setTitleValue(title);
    setDescriptionValue(description);
    setPriority("none");
    setStatus("todo");
    setDue("");
    setOpenField(null);
    setSaving(false);
  }, [visible, messageId, title, description]);

  const toggle = (field: OpenField) => setOpenField((current) => (current === field ? null : field));

  const create = () => {
    if (!ready) return;
    setSaving(true);
    void onCreate({
      title: titleValue.trim().slice(0, TITLE_MAX),
      description: descriptionValue.trim(),
      priority,
      status,
      ...(dueTrimmed ? { dueDate: dueTrimmed } : {}),
    })
      .then(onClose)
      .catch(() => setSaving(false));
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0">
      <View className="mb-2 flex-row items-center justify-between gap-2 px-4">
        <Text className="min-w-0 flex-1 text-body" accessibilityRole="header" numberOfLines={2}>
          {place ? <Text className="font-normal text-muted-foreground">{place}</Text> : null}
          {place ? <Text className="text-muted-foreground">{"  ›  "}</Text> : null}
          <Text className="font-medium text-foreground">{heading}</Text>
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
        textAlignVertical="top"
        className="min-h-24 px-4 py-2 text-body text-foreground"
      />
      <View className="flex-row flex-wrap gap-1.5 px-4 py-2">
        <PropertyPill
          icon="ellipse-outline"
          label={t(`tasks.status_${status}`)}
          open={openField === "status"}
          quiet={false}
          onPress={() => toggle("status")}
        />
        <PropertyPill
          icon={priority === "none" ? "remove-outline" : "bar-chart-outline"}
          label={t(`tasks.priority_${priority}`)}
          open={openField === "priority"}
          quiet={priority === "none"}
          onPress={() => toggle("priority")}
        />
        <PropertyPill
          icon="calendar-outline"
          label={dueLabel}
          open={openField === "due"}
          quiet={!DUE_DATE.test(dueTrimmed)}
          onPress={() => toggle("due")}
        />
      </View>
      {openField === "status" ? (
        <OptionMenu
          options={STATUSES.map((item) => ({ id: item, label: t(`tasks.status_${item}`) }))}
          selected={status}
          onSelect={(id) => {
            setStatus(id as Status);
            setOpenField(null);
          }}
        />
      ) : null}
      {openField === "priority" ? (
        <OptionMenu
          options={PRIORITIES.map((item) => ({ id: item, label: t(`tasks.priority_${item}`) }))}
          selected={priority}
          onSelect={(id) => {
            setPriority(id as Priority);
            setOpenField(null);
          }}
        />
      ) : null}
      {openField === "due" ? (
        <TextInput
          value={due}
          onChangeText={setDue}
          placeholder={t("chat.link.due_placeholder")}
          placeholderTextColor={ink}
          accessibilityLabel={t("chat.link.due_label")}
          autoCapitalize="none"
          autoCorrect={false}
          className={cn(
            "mx-4 mb-2 min-h-11 rounded-xl border bg-background px-3 py-2 text-body text-foreground",
            dueOk ? "border-border" : "border-destructive",
          )}
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
  context,
  onClose,
  create,
}: {
  sheet: ConversationSheet;
  context?: string;
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
      context={context}
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
