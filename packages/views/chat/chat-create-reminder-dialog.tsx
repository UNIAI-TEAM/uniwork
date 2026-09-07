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

import { Button } from "@uniwork/ui/components/ui/button";

import {

  Dialog,

  DialogContent,

  DialogFooter,

  DialogHeader,

  DialogTitle,

} from "@uniwork/ui/components/ui/dialog";

import { Input } from "@uniwork/ui/components/ui/input";

import { Label } from "@uniwork/ui/components/ui/label";

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from "@uniwork/ui/components/ui/select";

import { Textarea } from "@uniwork/ui/components/ui/textarea";

import { cn } from "@uniwork/ui/lib/utils";

import { DateTimeField } from "../common/datetime-field";



const QUICK_PRESETS: ReminderQuickPreset[] = ["15m", "30m", "tomorrow_9", "custom"];



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

  const { t } = useTranslation();

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

    return t("chat.reminder_schedule_date", { date: remindAtDate.toLocaleString() });

  }, [remindAtDate, t]);



  const canCreate = canSubmitReminder(body, remindAtDate);

  const showCustomPicker = preset === "custom";



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

      .catch(() => {

        toast.error(t("chat.reminder_create_failed"));

      });

  };



  const repeatItems = REMINDER_REPEAT_OPTIONS.map((value) => ({

    value,

    label: t(repeatLabelKey(value)),

  }));



  return (

    <Dialog open={open} onOpenChange={onOpenChange}>

      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">

        <DialogHeader className="border-b border-border px-5 py-4">

          <DialogTitle>{t("chat.reminder_create_title")}</DialogTitle>

        </DialogHeader>



        <div className="space-y-5 overflow-y-auto px-5 py-4">

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

            <Label>{t("chat.reminder_quick_time_label")}</Label>

            <div className="flex flex-wrap gap-2">

              {QUICK_PRESETS.map((item) => (

                <button

                  key={item}

                  type="button"

                  onClick={() => handlePresetChange(item)}

                  className={cn(

                    "rounded-full border px-3 py-1.5 text-caption transition-colors",

                    preset === item

                      ? "border-brand bg-brand/10 text-brand"

                      : "border-border text-foreground hover:border-brand/40",

                  )}

                >

                  {t(presetLabelKey(item))}

                </button>

              ))}

            </div>

          </div>



          <div className="space-y-2">

            <Label htmlFor="reminder-at">{t("chat.reminder_datetime_label")}</Label>

            {showCustomPicker ? (

              <DateTimeField

                id="reminder-at"

                value={customAt}

                onChange={setCustomAt}

                hourLabel={t("common.hour")}

                minuteLabel={t("common.minute")}

              />

            ) : (

              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-body text-foreground">

                <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />

                <span>{scheduleLabel}</span>

              </div>

            )}

          </div>



          <div className="space-y-2">

            <Label htmlFor="reminder-repeat">{t("chat.reminder_repeat_label")}</Label>

            <Select

              id="reminder-repeat"

              value={repeat}

              onValueChange={(value) => setRepeat(value as ReminderRepeat)}

              items={repeatItems}

            >

              <SelectTrigger id="reminder-repeat" className="w-full">

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

        </div>



        <DialogFooter className="gap-2 border-t border-border px-5 py-4">

          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>

            {t("common.cancel")}

          </Button>

          <Button type="button" disabled={!canCreate || sendMessage.isPending} onClick={handleCreate}>

            <Clock className="size-4" aria-hidden />

            {t("chat.reminder_create_submit")}

          </Button>

        </DialogFooter>

      </DialogContent>

    </Dialog>

  );

}

