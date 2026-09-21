"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import {
  canSubmitReminder,
  formatReminderTime,
  isSameCalendarDay,
  isTomorrow,
  parseDatetimeLocalValue,
  REMINDER_BODY_MAX_LENGTH,
  REMINDER_REPEAT_OPTIONS,
  remindAtFromPreset,
  toDatetimeLocalValue,
  type ReminderQuickPreset,
  type ReminderRepeat,
} from "@uniwork/core/chat/reminder-utils";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { DateTimeField } from "../common/datetime-field";
import { toastApiError } from "../toast-api-error";
import { ChatDialogBody, ChatDialogContent, ChatDialogFooter, ChatDialogHeader } from "./chat-dialog-layout";

const QUICK_PRESETS: ReminderQuickPreset[] = ["15m", "30m", "tomorrow_9", "custom"];

/** The app's filter-chip look (see notifications/inbox-toolbar.tsx): a pressed chip is a raised surface. */
const CHIP =
  "h-8 gap-1.5 rounded-md border border-transparent px-2.5 text-label font-medium text-muted-foreground pointer-coarse:h-11 " +
  "hover:bg-surface-hover hover:text-foreground aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)]";

function presetLabelKey(preset: ReminderQuickPreset): string {
  switch (preset) {
    case "15m":
      return "chat.reminder_preset_15m";
    case "30m":
      return "chat.reminder_preset_30m";
    case "tomorrow_9":
      return "chat.reminder_preset_tomorrow_9";
    case "custom":
      return "chat.reminder_preset_custom";
    default:
      return "chat.reminder_preset_custom";
  }
}

function repeatLabelKey(repeat: ReminderRepeat): string {
  return `chat.reminder_repeat_${repeat}`;
}

export function ChatCreateReminderDialog({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  onCreated?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const sendMessage = useSendChatRoomMessage(workspaceId);

  const [body, setBody] = useState("");
  const [preset, setPreset] = useState<ReminderQuickPreset>("30m");
  const [customAt, setCustomAt] = useState("");
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");

  const resetForm = () => {
    setBody("");
    setPreset("30m");
    setCustomAt("");
    setRepeat("none");
  };

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    const initial = remindAtFromPreset("30m") ?? new Date(Date.now() + 30 * 60_000);
    setCustomAt(toDatetimeLocalValue(initial));
  }, [open]);

  const remindAtDate = useMemo(() => {
    if (preset === "custom") {
      return parseDatetimeLocalValue(customAt);
    }
    return remindAtFromPreset(preset);
  }, [customAt, preset]);

  const scheduleLabel = useMemo(() => {
    if (!remindAtDate) return "";
    const now = new Date();
    const time = formatReminderTime(remindAtDate);
    if (isSameCalendarDay(now, remindAtDate)) {
      return t("chat.reminder_schedule_today", { time });
    }
    if (isTomorrow(now, remindAtDate)) {
      return t("chat.reminder_schedule_tomorrow", { time });
    }
    const date = remindAtDate.toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
    return t("chat.reminder_schedule_date", { date });
  }, [remindAtDate, t, i18n.language]);

  const canCreate = canSubmitReminder(body, remindAtDate);
  const showCustomPicker = preset === "custom";
  // Only a hand-picked time can land in the past; say so instead of silently disabling the button.
  const timeInPast = showCustomPicker && remindAtDate !== null && remindAtDate.getTime() <= Date.now();

  const handlePresetChange = (next: ReminderQuickPreset) => {
    setPreset(next);
    if (next !== "custom") {
      const nextDate = remindAtFromPreset(next);
      if (nextDate) setCustomAt(toDatetimeLocalValue(nextDate));
    }
  };

  const handleCreate = () => {
    if (!canCreate || !remindAtDate || sendMessage.isPending) return;
    void sendMessage
      .mutateAsync({
        roomId,
        reminder: {
          body: body.trim(),
          remind_at: remindAtDate.toISOString(),
          repeat,
        },
      })
      .then(() => {
        toast.success(t("chat.reminder_created_toast"));
        onCreated?.();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        toastApiError(err, t("chat.reminder_create_failed"));
      });
  };

  const repeatItems = REMINDER_REPEAT_OPTIONS.map((value) => ({
    value,
    label: t(repeatLabelKey(value)),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChatDialogContent size="lg">
        <ChatDialogHeader title={t("chat.reminder_create_title")} description={t("chat.reminder_create_description")} />

        <ChatDialogBody className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="reminder-body">{t("chat.reminder_body_label")}</Label>
            <Textarea
              id="reminder-body"
              value={body}
              maxLength={REMINDER_BODY_MAX_LENGTH}
              rows={4}
              placeholder={t("chat.reminder_body_placeholder")}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p id="reminder-preset-label" className="text-label font-medium text-foreground">
              {t("chat.reminder_quick_time_label")}
            </p>
            <ToggleGroup
              value={[preset]}
              onValueChange={(value) => {
                const next = value[0] as ReminderQuickPreset | undefined;
                if (next) handlePresetChange(next);
              }}
              aria-labelledby="reminder-preset-label"
              spacing={1}
              className="flex-wrap rounded-lg bg-muted p-1"
            >
              {QUICK_PRESETS.map((item) => (
                <ToggleGroupItem key={item} value={item} className={CHIP}>
                  {t(presetLabelKey(item))}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {showCustomPicker ? (
            <div className="space-y-2">
              <Label htmlFor="reminder-at">{t("chat.reminder_datetime_label")}</Label>
              <div role="group" aria-describedby={timeInPast ? "reminder-at-error" : undefined}>
                <DateTimeField
                  id="reminder-at"
                  value={customAt}
                  onChange={setCustomAt}
                  hourLabel={t("common.hour")}
                  minuteLabel={t("common.minute")}
                />
              </div>
              {timeInPast ? (
                <p id="reminder-at-error" role="alert" className="text-caption text-destructive">
                  {t("chat.reminder_time_past")}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <p id="reminder-at-summary-label" className="text-label font-medium text-foreground">
                {t("chat.reminder_scheduled_label")}
              </p>
              <output
                aria-labelledby="reminder-at-summary-label"
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-hover px-3 py-2 text-body text-foreground"
              >
                <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{scheduleLabel}</span>
              </output>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reminder-repeat">{t("chat.reminder_repeat_label")}</Label>
            <Select
              id="reminder-repeat"
              value={repeat}
              onValueChange={(value) => setRepeat(value as ReminderRepeat)}
              items={repeatItems}
            />
          </div>
        </ChatDialogBody>

        <ChatDialogFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={t("chat.reminder_create_submit")}
          submittingLabel={t("chat.reminder_create_submitting")}
          submitting={sendMessage.isPending}
          submitDisabled={!canCreate}
          onSubmit={handleCreate}
        />
      </ChatDialogContent>
    </Dialog>
  );
}
