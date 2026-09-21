"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import {
  canSubmitPoll,
  DEFAULT_ROOM_POLL_SETTINGS,
  parsePollDeadlineInput,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  type RoomPollSettings,
} from "@uniwork/core/chat/poll-utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { FieldDescription, FieldLegend, FieldSet } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { DateTimeField } from "../common/datetime-field";
import { toastApiError } from "../toast-api-error";
import { ChatDialogBody, ChatDialogContent, ChatDialogFooter, ChatDialogHeader } from "./chat-dialog-layout";

type PollOption = { id: number; value: string };

function createEmptyOptions(count = POLL_MIN_OPTIONS): PollOption[] {
  return Array.from({ length: count }, (_, id) => ({ id, value: "" }));
}

const optionInputId = (id: number) => `poll-option-${id}`;

/** Why the deadline cannot be used, or null when it is empty or in the future. */
function deadlineProblem(value: string, now = Date.now()): "invalid" | "past" | null {
  if (!value.trim()) return null;
  const parsed = parsePollDeadlineInput(value);
  if (!parsed) return "invalid";
  return Date.parse(parsed) <= now ? "past" : null;
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
  const [options, setOptions] = useState<PollOption[]>(() => createEmptyOptions());
  const [deadlineAt, setDeadlineAt] = useState("");
  const [settings, setSettings] = useState<RoomPollSettings>(DEFAULT_ROOM_POLL_SETTINGS);
  const nextOptionId = useRef(POLL_MIN_OPTIONS);
  const [focusOptionId, setFocusOptionId] = useState<number | null>(null);

  useEffect(() => {
    if (open) return;
    setQuestion("");
    setOptions(createEmptyOptions());
    setDeadlineAt("");
    setSettings(DEFAULT_ROOM_POLL_SETTINGS);
    nextOptionId.current = POLL_MIN_OPTIONS;
  }, [open]);

  // A freshly added row takes focus so typing continues without reaching for the mouse.
  useEffect(() => {
    if (focusOptionId === null) return;
    document.getElementById(optionInputId(focusOptionId))?.focus();
    setFocusOptionId(null);
  }, [focusOptionId]);

  const optionValues = useMemo(() => options.map((option) => option.value), [options]);
  const canCreate = useMemo(() => canSubmitPoll(question, optionValues), [question, optionValues]);
  const deadlineError = deadlineProblem(deadlineAt);

  const updateOption = (id: number, value: string) => {
    setOptions((current) => current.map((entry) => (entry.id === id ? { ...entry, value } : entry)));
  };

  const addOption = () => {
    if (options.length >= POLL_MAX_OPTIONS) return;
    const id = nextOptionId.current++;
    setOptions((current) => [...current, { id, value: "" }]);
    setFocusOptionId(id);
  };

  const removeOption = (id: number) => {
    setOptions((current) => (current.length > POLL_MIN_OPTIONS ? current.filter((entry) => entry.id !== id) : current));
  };

  const toggleSetting = (key: keyof RoomPollSettings, value: boolean) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleCreate = () => {
    if (!canCreate || deadlineError || sendMessage.isPending) return;
    const parsedDeadline = parsePollDeadlineInput(deadlineAt);
    void sendMessage
      .mutateAsync({
        roomId,
        poll: {
          question: question.trim(),
          options: optionValues.map((option) => option.trim()).filter(Boolean),
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
      .catch((err: unknown) => {
        toastApiError(err, t("chat.poll_create_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChatDialogContent size="lg">
        <ChatDialogHeader title={t("chat.poll_create_title")} description={t("chat.poll_create_description")} />

        <ChatDialogBody className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="poll-question">{t("chat.poll_question_label")}</Label>
              <span id="poll-question-count" className="text-caption tabular-nums text-muted-foreground">
                {question.length}/{POLL_QUESTION_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="poll-question"
              value={question}
              maxLength={POLL_QUESTION_MAX_LENGTH}
              rows={3}
              placeholder={t("chat.poll_topic_placeholder")}
              aria-describedby="poll-question-count"
              onChange={(event) => setQuestion(event.target.value)}
            />
          </div>

          <FieldSet className="gap-2">
            <FieldLegend variant="label" className="mb-0">
              {t("chat.poll_options_label")}
            </FieldLegend>
            <FieldDescription className="text-caption">{t("chat.poll_min_options_hint")}</FieldDescription>
            <ul className="space-y-2">
              {options.map((option, index) => {
                const label = t("chat.poll_option_placeholder", { index: index + 1 });
                return (
                  <li key={option.id} className="flex items-center gap-1.5">
                    <Input
                      id={optionInputId(option.id)}
                      value={option.value}
                      maxLength={POLL_OPTION_MAX_LENGTH}
                      placeholder={label}
                      aria-label={label}
                      onChange={(event) => updateOption(option.id, event.target.value)}
                    />
                    {options.length > POLL_MIN_OPTIONS ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground"
                        aria-label={t("chat.poll_remove_option", { index: index + 1 })}
                        onClick={() => removeOption(option.id)}
                      >
                        <X aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {options.length < POLL_MAX_OPTIONS ? (
              <Button type="button" variant="ghost" size="sm" className="self-start" onClick={addOption}>
                <Plus aria-hidden />
                {t("chat.poll_add_option")}
              </Button>
            ) : null}
          </FieldSet>

          <div className="space-y-2">
            <Label htmlFor="poll-deadline" id="poll-deadline-label">
              {t("chat.poll_deadline_label")}
            </Label>
            <div
              role="group"
              aria-labelledby="poll-deadline-label"
              aria-describedby={deadlineError ? "poll-deadline-error" : "poll-deadline-hint"}
            >
              <DateTimeField
                id="poll-deadline"
                value={deadlineAt}
                onChange={setDeadlineAt}
                hourLabel={t("common.hour")}
                minuteLabel={t("common.minute")}
              />
            </div>
            {deadlineError ? (
              <p id="poll-deadline-error" role="alert" className="text-caption text-destructive">
                {deadlineError === "invalid" ? t("chat.poll_deadline_invalid") : t("chat.poll_deadline_must_be_future")}
              </p>
            ) : !deadlineAt.trim() ? (
              <p id="poll-deadline-hint" className="text-caption text-muted-foreground">
                {t("chat.poll_no_deadline")}
              </p>
            ) : null}
          </div>

          <FieldSet className="gap-3 border-t border-border pt-4">
            <legend className="mb-0 text-overline text-muted-foreground uppercase">
              {t("chat.poll_advanced_settings")}
            </legend>
            <PollSettingRow
              id="poll-setting-pin"
              label={t("chat.poll_setting_pin_top")}
              checked={settings.pinToTop}
              onCheckedChange={(value) => toggleSetting("pinToTop", value)}
            />
            <PollSettingRow
              id="poll-setting-multiple"
              label={t("chat.poll_setting_multiple")}
              checked={settings.allowMultiple}
              onCheckedChange={(value) => toggleSetting("allowMultiple", value)}
            />
            <PollSettingRow
              id="poll-setting-add-options"
              label={t("chat.poll_setting_add_options")}
              checked={settings.allowAddOptions}
              onCheckedChange={(value) => toggleSetting("allowAddOptions", value)}
            />
          </FieldSet>

          <FieldSet className="gap-3 border-t border-border pt-4">
            <legend className="mb-0 text-overline text-muted-foreground uppercase">
              {t("chat.poll_anonymous_title")}
            </legend>
            <PollSettingRow
              id="poll-setting-hide-results"
              label={t("chat.poll_setting_hide_results")}
              checked={settings.hideResultsUntilVote}
              onCheckedChange={(value) => toggleSetting("hideResultsUntilVote", value)}
            />
            <PollSettingRow
              id="poll-setting-hide-voters"
              label={t("chat.poll_setting_hide_voters")}
              checked={settings.hideVoters}
              onCheckedChange={(value) => toggleSetting("hideVoters", value)}
            />
          </FieldSet>
        </ChatDialogBody>

        <ChatDialogFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={t("chat.poll_create_submit")}
          submittingLabel={t("chat.poll_create_submitting")}
          submitting={sendMessage.isPending}
          submitDisabled={!canCreate || deadlineError !== null}
          onSubmit={handleCreate}
        />
      </ChatDialogContent>
    </Dialog>
  );
}

/** A setting line whose text is the Switch's accessible name; clicking the text toggles it. */
function PollSettingRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="flex items-center justify-between gap-3">
      <Label id={labelId} htmlFor={id} className="font-normal text-body text-foreground">
        {label}
      </Label>
      <Switch id={id} aria-labelledby={labelId} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
