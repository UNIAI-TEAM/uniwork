"use client";

import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Check, Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import {
  canSubmitReminder,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { DateTimeField } from "../common/datetime-field";
import { toDateOnly } from "../common/date-field";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import {
  CHAT_DATETIME_CLASS,
  CHAT_DAY_FORMAT,
  CHAT_DIALOG_BODY_CLASS,
  CHAT_DIALOG_CLASS,
  CHAT_FIELD_TEXTAREA_CLASS,
  CHAT_LABEL_CLASS,
  CHAT_SELECT_TRIGGER_CLASS,
} from "./chat-dialog-look";
import { chatErrorMessage } from "./chat-error-message";
import { ChatCharCounter, ChatFormFooterNote, nearLimit, renderChatDateTrigger, RequiredMark } from "./chat-form-parts";

const QUICK_PRESETS: ReminderQuickPreset[] = ["15m", "30m", "tomorrow_9", "custom"];

/** A time preset is its own pill; the picked one takes the brand wash. */
const CHIP =
  "h-9 gap-1.5 rounded-full border border-transparent bg-muted px-3.5 text-body font-semibold text-foreground pointer-coarse:h-11 " +
  "hover:bg-surface-hover aria-pressed:border-brand/25 aria-pressed:bg-brand-subtle aria-pressed:pl-2.5 aria-pressed:text-brand-subtle-foreground";

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

/** The moment a preset or the picked time points at, computed now — a preset is relative to the send, not to the pick. */
function resolveRemindAt(preset: ReminderQuickPreset, customAt: string, now: Date): Date | null {
  return preset === "custom" ? parseDatetimeLocalValue(customAt) : remindAtFromPreset(preset, now);
}

/** "Asia/Ho_Chi_Minh": the viewer's zone, so a picked hour is never ambiguous. */
function timeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/** Presets are relative, so their summary is refreshed while the dialog stays open. */
const PRESET_REFRESH_MS = 30_000;

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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const resetForm = () => {
    setBody("");
    setPreset("30m");
    setCustomAt("");
    setRepeat("none");
    setSubmitError(null);
  };

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    const initial = remindAtFromPreset("30m") ?? new Date(Date.now() + 30 * 60_000);
    setCustomAt(toDatetimeLocalValue(initial));
  }, [open]);

  useEffect(() => {
    if (!open || preset === "custom") return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), PRESET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [open, preset]);

  const remindAtDate = useMemo(() => resolveRemindAt(preset, customAt, now), [customAt, preset, now]);
  const zone = timeZoneLabel();

  const scheduleLabel = useMemo(() => {
    if (!remindAtDate) return "";
    const time = remindAtDate.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
    if (isSameCalendarDay(now, remindAtDate)) {
      return t("chat.reminder_schedule_today", { time });
    }
    if (isTomorrow(now, remindAtDate)) {
      return t("chat.reminder_schedule_tomorrow", { time });
    }
    const date = remindAtDate.toLocaleDateString(i18n.language, CHAT_DAY_FORMAT);
    return t("chat.reminder_schedule_on", { date, time });
  }, [remindAtDate, now, t, i18n.language]);

  const canCreate = canSubmitReminder(body, remindAtDate);
  const showCustomPicker = preset === "custom";
  // Only a hand-picked time can land in the past; say so instead of silently disabling the button.
  const timeInPast = showCustomPicker && remindAtDate !== null && remindAtDate.getTime() <= Date.now();
  const missingHint = !body.trim()
    ? t("chat.reminder_submit_hint_body")
    : !remindAtDate
      ? t("chat.reminder_submit_hint_time")
      : null;

  const handlePresetChange = (next: ReminderQuickPreset) => {
    setPreset(next);
    if (next !== "custom") {
      const nextDate = remindAtFromPreset(next);
      if (nextDate) setCustomAt(toDatetimeLocalValue(nextDate));
    }
  };

  const handleCreate = () => {
    // Recompute here: "in 15 minutes" means 15 minutes from the send, however long the dialog sat open.
    const remindAt = resolveRemindAt(preset, customAt, new Date());
    if (!remindAt || !canSubmitReminder(body, remindAt) || sendMessage.isPending) return;
    setSubmitError(null);
    void sendMessage
      .mutateAsync({
        roomId,
        client_msg_id: newChatClientMsgId(),
        reminder: {
          body: body.trim(),
          remind_at: remindAt.toISOString(),
          repeat,
        },
      })
      .then(() => {
        toast.success(t("chat.reminder_created_toast"));
        onCreated?.();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        setSubmitError(chatErrorMessage(err, t, t("chat.reminder_create_failed")));
      });
  };

  const repeatItems = REMINDER_REPEAT_OPTIONS.map((value) => ({
    value,
    label: t(repeatLabelKey(value)),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg" className={`${CHAT_DIALOG_CLASS} sm:max-w-137.5`}>
        <FormDialogHeader title={t("chat.reminder_create_title")} description={t("chat.reminder_create_description")} />

        <FormDialogBody className={`${CHAT_DIALOG_BODY_CLASS} space-y-5`}>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="reminder-body" className={CHAT_LABEL_CLASS}>
                {t("chat.reminder_body_label")}
                <RequiredMark />
              </Label>
              <ChatCharCounter id="reminder-body-count" length={body.length} max={REMINDER_BODY_MAX_LENGTH} />
            </div>
            <Textarea
              id="reminder-body"
              className={`${CHAT_FIELD_TEXTAREA_CLASS} min-h-27 max-h-60`}
              value={body}
              maxLength={REMINDER_BODY_MAX_LENGTH}
              rows={4}
              aria-required
              aria-describedby={
                nearLimit(body.length, REMINDER_BODY_MAX_LENGTH) ? "reminder-body-count" : undefined
              }
              placeholder={t("chat.reminder_body_placeholder")}
              onChange={(event) => {
                setBody(event.target.value);
                if (submitError) setSubmitError(null);
              }}
            />
          </div>

          <div className="space-y-2">
            <p id="reminder-preset-label" className="text-label font-semibold text-foreground">
              {t("chat.reminder_quick_time_label")}
            </p>
            <ToggleGroup
              value={[preset]}
              onValueChange={(value) => {
                const next = value[0] as ReminderQuickPreset | undefined;
                if (next) handlePresetChange(next);
              }}
              aria-labelledby="reminder-preset-label"
              spacing={2}
              className="flex-wrap"
            >
              {QUICK_PRESETS.map((item) => (
                <ToggleGroupItem key={item} value={item} className={CHIP}>
                  {item === preset ? <Check aria-hidden className="size-4" strokeWidth={2.4} /> : null}
                  {t(presetLabelKey(item))}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {showCustomPicker ? (
            <div className="space-y-2">
              <Label htmlFor="reminder-at" className={CHAT_LABEL_CLASS}>{t("chat.reminder_datetime_label")}</Label>
              <div role="group" aria-describedby={timeInPast ? "reminder-at-error" : zone ? "reminder-at-zone" : undefined}>
                <DateTimeField
                  id="reminder-at"
                  value={customAt}
                  onChange={setCustomAt}
                  minDate={toDateOnly(now)}
                  hourLabel={t("common.hour")}
                  minuteLabel={t("common.minute")}
                  className={CHAT_DATETIME_CLASS}
                  dateFormatOptions={CHAT_DAY_FORMAT}
                  renderDateTrigger={renderChatDateTrigger}
                />
              </div>
              {zone ? (
                <p id="reminder-at-zone" className="text-caption text-muted-foreground">
                  {t("chat.reminder_time_zone", { zone })}
                </p>
              ) : null}
              {timeInPast ? (
                <p id="reminder-at-error" role="alert" className="text-caption text-destructive">
                  {t("chat.reminder_time_past")}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* The moment the reminder fires, one line under the picker (canvas): 12px below it, not 20. */}
          {scheduleLabel ? (
            <output className="-mt-2 flex min-h-11 items-center gap-2.5 rounded-lg bg-tint-teal px-3.5 py-2.5 text-body text-foreground">
              <AlarmClock className="size-4.5 shrink-0 text-tint-teal-foreground" aria-hidden />
              <span>
                {t("chat.reminder_scheduled_label")} <strong className="font-semibold">{scheduleLabel}</strong>
              </span>
            </output>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="reminder-repeat" className={CHAT_LABEL_CLASS}>{t("chat.reminder_repeat_label")}</Label>
            <Select value={repeat} onValueChange={(value) => setRepeat(value as ReminderRepeat)} items={repeatItems}>
              <SelectTrigger id="reminder-repeat" className={CHAT_SELECT_TRIGGER_CLASS}>
                <Repeat aria-hidden className="size-4.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {repeatItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FormDialogBody>

        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          cancelVariant="secondary"
          submitLabel={t("chat.reminder_create_submit")}
          submittingLabel={t("chat.reminder_create_submitting")}
          submitting={sendMessage.isPending}
          submitDisabled={!canCreate}
          onSubmit={handleCreate}
          leading={
            submitError || missingHint ? <ChatFormFooterNote error={submitError} hint={missingHint} /> : undefined
          }
        />
      </FormDialogContent>
    </Dialog>
  );
}
