"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
 * from someone in the room, hence `canShare`.
 */
export function MeetingAskBox({
  workspaceId,
  meetingId,
  canShare,
}: {
  workspaceId: string;
  meetingId: string;
  canShare: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: caps } = useAiCapabilities(workspaceId);
  const ask = useAskUni(workspaceId);
  const share = useAppendMeetingChat(meetingId);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
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
    <section aria-label={t("meetings.askUniTitle")} className="mt-3 shrink-0 space-y-2" data-testid="meeting-ask-uni">
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
        <div className="max-h-72 space-y-2 overflow-y-auto">
          <ul className="space-y-2">
            <AskUniMessageTurn message={{ id: "question", role: "user", content: asked, citations: [] }} />
            <AskUniMessageTurn message={answer} />
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-muted-foreground">{t("meetings.askUniPrivate")}</p>
            {canShare && answer.content ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={share.isPending || share.isSuccess}
                onClick={() =>
                  share.mutate(forChat(answer.content), {
                    onSuccess: () => toast.success(t("meetings.askUniShared")),
                    onError: (err) => toastApiError(err, t("meetings.askUniShareFailed")),
                  })
                }
              >
                {share.isSuccess ? t("meetings.askUniShared") : t("meetings.askUniShare")}
              </Button>
            ) : null}
          </div>
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
        <Button type="submit" size="sm" disabled={ask.isPending || !question.trim()}>
          {t("meetings.askUniSend")}
        </Button>
      </form>
    </section>
  );
}
