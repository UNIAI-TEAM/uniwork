"use client";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { CircleAlert, Send, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAiPanelStore, useAskUni } from "@uniwork/core/ai";
import { useMeetingCatchUp } from "@uniwork/core/meetings/summary";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { resolveErrorKey } from "../../../ai/ask-uni-legacy-panel";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { TextButton } from "../ui/text-button";
import { isLive } from "./rail-model";

/** The meeting's title cut to fit the 288 rail's placeholder ("Hỏi về Giao ban tuần 43…"). */
export function askPlaceholderTitle(title: string): string {
  const head = title.split(/\s+[—–-]\s+/)[0]!.trim();
  const words = head.split(/\s+/);
  return words.length > 4 ? words.slice(0, 4).join(" ") : head;
}

/**
 * "Tóm tắt từ đầu đến giờ" (live): the late joiner's brief on click (a model
 * call, never on mount), shown in a popover; the brief is kept for the session.
 */
function CatchUpChip() {
  const { t, i18n } = useTranslation();
  const { meeting } = useDetail();
  const catchUp = useMeetingCatchUp(meeting.id);
  const brief = catchUp.data;
  const failed = catchUp.isError || (catchUp.isSuccess && !brief);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open && !brief && !catchUp.isPending) catchUp.mutate(i18n.language);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="mb-2 inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-border px-2.5 text-caption font-medium hover:bg-surface-hover pointer-coarse:min-h-11 [&_svg]:size-3"
          />
        }
      >
        <Sparkles aria-hidden />
        {t("meetings.detail.ask.catchUp")}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-32px)] gap-2 bg-popover p-4 ring-border">
        <PopoverTitle className="text-label font-semibold">{t("meetings.detail.ask.catchUp")}</PopoverTitle>
        {brief ? (
          <>
            <p className="text-body">{brief.summary}</p>
            {brief.highlights.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {brief.highlights.map((h, i) => (
                  <li key={`${h.segment_id ?? "note"}-${i}`} className="text-body">
                    {h.spoken_at ? <time className="mr-2 font-mono text-caption font-medium text-muted-foreground">{clock(h.spoken_at)}</time> : null}
                    {h.text}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-caption text-muted-foreground">{t("meetings.catchUpPrivate")}</p>
          </>
        ) : failed ? (
          <p role="alert" className="flex items-start gap-2 text-caption text-destructive">
            <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>
              {t("meetings.catchUpFailed")}{" "}
              <TextButton onClick={() => catchUp.mutate(i18n.language)}>{t("common.retry")}</TextButton>
            </span>
          </p>
        ) : (
          <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
            <Spinner />
            {t("meetings.catchUpWorking")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Ask UNI docked at the rail's foot (kit `.ask`): a 44 composer naming the
 * meeting. A question is asked with the meeting as its focus and the answer
 * opens in the Ask UNI panel; ⌘J stays the global Ask UNI and is not bound
 * here. A failed ask keeps the typed text, says so and offers [Gửi lại].
 */
export function RailAsk() {
  const { t, i18n } = useTranslation();
  const { workspaceId, meeting, displayStatus } = useDetail();
  const { data: caps } = useAiCapabilities(workspaceId);
  const ask = useAskUni(workspaceId);
  const conversationId = useAiPanelStore((s) => s.conversationByMeeting[meeting.id]);
  const openConversation = useAiPanelStore((s) => s.openConversation);
  const [question, setQuestion] = useState("");
  const id = useId();
  if (!caps?.ask_uni) return null;

  const focus = { kind: "meeting", id: meeting.id, label: meeting.title } as const;
  const send = () => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    ask.mutate(
      { question: q, conversation_id: conversationId, locale: i18n.language, focus },
      {
        onSuccess: (res) => {
          setQuestion("");
          openConversation(res.conversation_id, focus);
        },
      },
    );
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter breaks the line; an IME composing a word keeps its Enter.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
  };
  const error = ask.isError && !ask.isPending;

  return (
    <form className="mt-6 flex flex-col" onSubmit={submit} aria-busy={ask.isPending || undefined}>
      {isLive(displayStatus) ? <CatchUpChip /> : null}
      <label className="sr-only" htmlFor={`${id}-q`}>
        {t("meetings.detail.ask.label")}
      </label>
      <div className="flex min-h-11 items-start gap-2 rounded-control border border-input bg-background pr-1 pl-3 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring">
        <Sparkles aria-hidden className="mt-[13px] size-4 shrink-0 text-muted-foreground" />
        <textarea
          id={`${id}-q`}
          rows={1}
          value={question}
          maxLength={2000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("meetings.detail.ask.placeholder", { title: askPlaceholderTitle(meeting.title) })}
          aria-describedby={error ? `${id}-err` : undefined}
          aria-invalid={error || undefined}
          className="field-sizing-content max-h-40 min-w-0 flex-1 resize-none bg-transparent px-0 py-[11px] text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          // The kit's send stays muted at rest, never faded.
          className={`mt-[7px] ${kitButton.icon} aria-disabled:opacity-100`}
          aria-label={t("meetings.detail.ask.send")}
          aria-disabled={ask.isPending || !question.trim() || undefined}
        >
          {ask.isPending ? <Spinner /> : <Send aria-hidden />}
        </Button>
      </div>
      {error ? (
        <div id={`${id}-err`} role="alert" className="mt-2 grid grid-cols-[14px_minmax(0,1fr)] gap-x-2 text-caption text-destructive">
          <CircleAlert aria-hidden className="mt-px size-3.5" />
          <div>
            <p>{t(`ai.errors.${resolveErrorKey(ask.error)}`)}</p>
            <TextButton type="submit" className="mt-0.5">
              {t("meetings.detail.ask.retry")}
            </TextButton>
          </div>
        </div>
      ) : null}
    </form>
  );
}
