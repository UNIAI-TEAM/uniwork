"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import {
  canSubmitPoll,
  DEFAULT_ROOM_POLL_SETTINGS,
  parsePollDeadlineInput,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_QUESTION_MAX_LENGTH,
  type RoomPollSettings,
} from "@uniwork/core/chat/poll-utils";
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
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { DateTimeField } from "../common/datetime-field";

const DEFAULT_OPTION_COUNT = 2;

function createEmptyOptions(count = DEFAULT_OPTION_COUNT): string[] {
  return Array.from({ length: count }, () => "");
}

export function ChatCreatePollDialog({
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

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(() => createEmptyOptions());
  const [deadlineAt, setDeadlineAt] = useState("");
  const [settings, setSettings] = useState<RoomPollSettings>(DEFAULT_ROOM_POLL_SETTINGS);

  const resetForm = () => {
    setQuestion("");
    setOptions(createEmptyOptions());
    setDeadlineAt("");
    setSettings(DEFAULT_ROOM_POLL_SETTINGS);
  };

  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  const canCreate = useMemo(() => canSubmitPoll(question, options), [question, options]);

  const updateOption = (index: number, value: string) => {
    setOptions((current) => current.map((entry, i) => (i === index ? value : entry)));
  };

  const addOption = () => {
    if (options.length >= POLL_MAX_OPTIONS) return;
    setOptions((current) => [...current, ""]);
  };

  const toggleSetting = (key: keyof RoomPollSettings, value: boolean) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleCreate = () => {
    if (!canCreate || sendMessage.isPending) return;
    const parsedDeadline = parsePollDeadlineInput(deadlineAt);
    if (deadlineAt.trim() && !parsedDeadline) {
      toast.error(t("chat.poll_deadline_invalid"));
      return;
    }
    if (parsedDeadline && Date.parse(parsedDeadline) <= Date.now()) {
      toast.error(t("chat.poll_deadline_must_be_future"));
      return;
    }
    void sendMessage
      .mutateAsync({
        roomId,
        poll: {
          question: question.trim(),
          options: options.map((option) => option.trim()).filter(Boolean),
          settings: {
            deadline_at: parsedDeadline,
            pin_to_top: settings.pinToTop,
            allow_multiple: settings.allowMultiple,
            allow_add_options: settings.allowAddOptions,
            hide_results_until_vote: settings.hideResultsUntilVote,
            hide_voters: settings.hideVoters,
          },
        },
      })
      .then(() => {
        toast.success(t("chat.poll_created_toast"));
        onCreated?.();
        onOpenChange(false);
      })
      .catch(() => {
        toast.error(t("chat.poll_create_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t("chat.poll_create_title")}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-5 border-border px-5 py-4 lg:border-r">
            <div className="space-y-2">
              <Label htmlFor="poll-question">{t("chat.poll_topic_label")}</Label>
              <div className="relative">
                <Textarea
                  id="poll-question"
                  value={question}
                  maxLength={POLL_QUESTION_MAX_LENGTH}
                  rows={4}
                  placeholder={t("chat.poll_topic_placeholder")}
                  onChange={(event) => setQuestion(event.target.value)}
                />
                <span className="pointer-events-none absolute bottom-2 right-3 text-caption text-muted-foreground">
                  {question.length}/{POLL_QUESTION_MAX_LENGTH}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <Label>{t("chat.poll_options_label")}</Label>
              <ul className="space-y-2">
                {options.map((option, index) => (
                  <li key={`poll-option-${index}`}>
                    <Input
                      value={option}
                      placeholder={t("chat.poll_option_placeholder", { index: index + 1 })}
                      onChange={(event) => updateOption(index, event.target.value)}
                    />
                  </li>
                ))}
              </ul>
              {options.length < POLL_MAX_OPTIONS ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-body text-brand hover:underline"
                  onClick={addOption}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("chat.poll_add_option")}
                </button>
              ) : null}
              {options.length < POLL_MIN_OPTIONS ? (
                <p className="text-caption text-muted-foreground">{t("chat.poll_min_options_hint")}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-5 px-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="poll-deadline">{t("chat.poll_deadline_label")}</Label>
              <DateTimeField
                id="poll-deadline"
                value={deadlineAt}
                onChange={setDeadlineAt}
                hourLabel={t("common.hour")}
                minuteLabel={t("common.minute")}
              />
              <p className="text-caption text-muted-foreground">{t("chat.poll_no_deadline")}</p>
            </div>

            <div className="space-y-3">
              <p className="text-body font-semibold text-foreground">{t("chat.poll_advanced_settings")}</p>
              <PollSettingRow
                label={t("chat.poll_setting_pin_top")}
                checked={settings.pinToTop}
                onCheckedChange={(value) => toggleSetting("pinToTop", value)}
              />
              <PollSettingRow
                label={t("chat.poll_setting_multiple")}
                checked={settings.allowMultiple}
                onCheckedChange={(value) => toggleSetting("allowMultiple", value)}
              />
              <PollSettingRow
                label={t("chat.poll_setting_add_options")}
                checked={settings.allowAddOptions}
                onCheckedChange={(value) => toggleSetting("allowAddOptions", value)}
              />
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-body font-semibold text-foreground">{t("chat.poll_anonymous_title")}</p>
              <PollSettingRow
                label={t("chat.poll_setting_hide_results")}
                checked={settings.hideResultsUntilVote}
                onCheckedChange={(value) => toggleSetting("hideResultsUntilVote", value)}
              />
              <PollSettingRow
                label={t("chat.poll_setting_hide_voters")}
                checked={settings.hideVoters}
                onCheckedChange={(value) => toggleSetting("hideVoters", value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!canCreate || sendMessage.isPending} onClick={handleCreate}>
            <BarChart3 className="size-4" aria-hidden />
            {t("chat.poll_create_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PollSettingRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
