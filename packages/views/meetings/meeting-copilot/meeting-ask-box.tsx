"use client";

import { useId, useState, type FormEvent } from "react";
import { Check, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAskUni } from "@uniwork/core/ai";
import { useAppendMeetingChat } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AskUniMessageTurn, resolveErrorKey } from "../../ai/ask-uni-panel";
import { toastApiError } from "../../toast-api-error";

/** "[S2]" points at a source only the asker's panel can open; in chat it is noise. */
function forChat(answer: string): string {
  return answer.replace(/\s?\[S\d+\]/g, "").trim();
}

/**
 * B8 (scribe spec §5.2): Ask UNI scoped to this meeting, for workspace
 * members. The answer is the asker's own Ask UNI turn (only they see it);
 * sharing posts it as their own chat message, which the server accepts only
 * from someone in the room, hence `canShare`. `heading` gives the box its
 * own visible title where nothing around it names it (the room's UNI panel;
 * the detail page wraps it in a titled card).
 */
export function MeetingAskBox({
  workspaceId,
  meetingId,
  canShare,
  heading = false,
}: {
  workspaceId: string;
  meetingId: string;
  canShare: boolean;
  heading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: caps } = useAiCapabilities(workspaceId);
  const ask = useAskUni(workspaceId);
  const share = useAppendMeetingChat(meetingId);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const headingId = useId();
  if (!caps?.ask_uni) return null;

  const answer = ask.isPending ? undefined : ask.data?.message;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || ask.isPending) return;
    setAsked(q);
    setQuestion("");
    share.reset();
    ask.mutate(
      { question: q, conversation_id: conversationId, locale: i18n.language, focus: { kind: "meeting", id: meetingId } },
      { onSuccess: (res) => setConversationId(res.conversation_id), onError: () => setQuestion(q) },
    );
  };

  return (
    <section
      aria-label={heading ? undefined : t("meetings.askUniTitle")}
      aria-labelledby={heading ? headingId : undefined}
      className="mt-3 space-y-2"
      data-testid="meeting-ask-uni"
    >
      {heading ? (
        <h3 id={headingId} className="flex items-center gap-1.5 text-label font-semibold text-foreground">
          <Sparkles aria-hidden className="size-4 shrink-0 text-brand" />
          {t("meetings.askUniHeading")}
        </h3>
      ) : null}
      {asked && (ask.isPending || answer) ? (
        // The question stays on screen while UNI works on it, then sits over its answer.
        <ul className="space-y-2">
          <AskUniMessageTurn message={{ id: "question", role: "user", content: asked, citations: [] }} />
          {answer ? <AskUniMessageTurn message={answer} /> : null}
        </ul>
      ) : null}
      {ask.isPending ? (
        <p role="status" className="flex items-center gap-2 text-label text-muted-foreground">
          <Spinner /> {t("meetings.askUniWorking")}
        </p>
      ) : null}
      {ask.isError ? (
        <p role="alert" className="text-label text-destructive">
          {t(`ai.errors.${resolveErrorKey(ask.error)}`)}
        </p>
      ) : null}
      {answer ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-caption text-muted-foreground">{t("meetings.askUniPrivate")}</p>
          {canShare && answer.content ? (
            share.isSuccess ? (
              // The one success signal, where the button was.
              <p role="status" className="flex items-center gap-1 text-caption text-muted-foreground">
                <Check aria-hidden className="size-4 shrink-0" />
                {t("meetings.askUniShared")}
              </p>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-disabled={share.isPending}
                onClick={() =>
                  share.mutate(forChat(answer.content), {
                    onError: (err) => toastApiError(err, t("meetings.askUniShareFailed")),
                  })
                }
              >
                {share.isPending ? <Spinner /> : null}
                {t("meetings.askUniShare")}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      <form className="flex gap-2" onSubmit={submit}>
        <Input
          className="min-w-0 flex-1"
          value={question}
          maxLength={2000}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("meetings.askUniPlaceholder")}
          aria-label={t("meetings.askUniLabel")}
        />
        {/* Default size: the same height as the field beside it. */}
        <Button type="submit" aria-disabled={ask.isPending || !question.trim()}>
          {t("meetings.askUniSend")}
        </Button>
      </form>
    </section>
  );
}
