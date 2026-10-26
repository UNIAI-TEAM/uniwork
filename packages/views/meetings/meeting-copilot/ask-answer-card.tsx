"use client";

import { useId, useMemo } from "react";
import { Check, CornerUpRight, Lock, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAppendMeetingChat } from "@uniwork/core/meetings";
import { formatShortcut, useShortcut } from "@uniwork/core/shortcuts";
import type { AiCitation, AiMessage } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { SafeMarkdown } from "@uniwork/ui/markdown";
import { AskUniActions } from "../../ai/ask-uni-actions";
import { citationLabel, linkableCitations, noticeText } from "../../ai/ask-uni-legacy-panel";
import { isInAppHref } from "../../ai/ask-uni-links";
import { AppLink } from "../../navigation";
import { toastApiError } from "../../toast-api-error";

// A marker and the space before it: the source pills below carry the sources.
const CITE_TOKEN = /\s?\[S(\d+)\]/g;

/** "[S2]" points at a source only the asker's panel can open; in chat it is noise. */
export function forChat(answer: string): string {
  return answer.replace(/\s?\[S\d+\]/g, "").trim();
}

/**
 * The room's Ask UNI exchange, in the UNI feed over the composer: the question
 * as the asker's bubble, then UNI's answer (only the asker sees it). Sharing
 * posts it as the asker's own chat message, which the server accepts only
 * from someone in the room, hence `canShare`; ⌘J continues the conversation.
 */
export function AskAnswerCard({
  question,
  answer,
  pending,
  conversationId,
  canShare,
  meetingId,
  workspaceId,
}: {
  question: string;
  answer: AiMessage | null;
  pending: boolean;
  conversationId: string | null;
  canShare: boolean;
  meetingId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { t: tAi } = useTranslation(undefined, { keyPrefix: "ai" });
  const share = useAppendMeetingChat(meetingId);
  const openConversation = useAiPanelStore((s) => s.openConversation);
  const shortcut = formatShortcut(useShortcut("ai.askUni"));
  const titleId = useId();
  const sources = useMemo(() => new Map((answer?.citations ?? []).map((c): [string, AiCitation] => [c.source_id, c])), [answer]);
  if (!question && !answer) return null;

  const shown = pending ? null : answer;
  const text = shown ? (shown.content === "" && shown.notice ? noticeText(tAi, shown.notice) : shown.content) : "";
  // Shared means this answer: a newer one has not been.
  const shared = !!shown?.content && share.isSuccess && share.variables === forChat(shown.content);
  const pills = shown ? linkableCitations(shown.citations) : [];

  return (
    <div className="flex flex-col gap-3.5" data-testid="meeting-ask-uni">
      {question ? (
        <p className="max-w-[82%] self-end whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] bg-surface-hover px-3 py-2 text-body text-foreground">
          {question}
        </p>
      ) : null}
      {shown ? (
        <article aria-labelledby={titleId} className="rounded-2xl border border-border bg-brand-subtle/30 px-3.5 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="grid size-6 place-items-center rounded-lg bg-brand-subtle text-brand">
              <Sparkles className="size-3.5" />
            </span>
            <span id={titleId} className="text-label font-semibold text-foreground">
              {t("meetings.panel.answer.title")}
            </span>
            <span
              title={t("meetings.askUniPrivate")}
              className="ml-auto inline-flex h-5.5 items-center gap-1 rounded-full bg-surface-hover px-2 text-micro font-medium text-muted-foreground"
            >
              <Lock aria-hidden className="size-3" />
              {t("meetings.panel.composer.private")}
            </span>
          </div>
          {/* Markdown as Ask UNI writes it (lists, bold), with the [S#] markers left to the source pills below. */}
          <SafeMarkdown
            isLinkAllowed={isInAppHref}
            renderLink={({ href, children }) => (
              <AppLink href={href} className="text-primary underline-offset-2 hover:underline">
                {children}
              </AppLink>
            )}
            inlineToken={{ pattern: CITE_TOKEN, render: () => null }}
            className="break-words leading-[21px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ol]:my-1.5 [&_p]:my-1.5 [&_ul]:my-1.5"
          >
            {text}
          </SafeMarkdown>
          {pills.length > 0 ? (
            <ul aria-label={tAi("sources")} className="mt-2.5 flex flex-wrap gap-1.5">
              {pills.map((c) => (
                <li key={c.source_id} className="min-w-0">
                  <AppLink
                    href={c.href}
                    className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-surface px-2 text-caption font-medium text-foreground ring-1 ring-border hover:bg-surface-hover pointer-coarse:h-11"
                  >
                    <span className="tabular-nums text-muted-foreground">[{c.source_id}]</span>
                    <span className="truncate">{citationLabel(tAi, c)}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-0.5 border-t border-border pt-2">
            {conversationId ? (
              <AskUniActions conversationId={conversationId} messageId={shown.id} wsId={workspaceId} content={shown.content} sources={sources} />
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-0.5">
              {canShare && shown.content ? (
                shared ? (
                  // The one success signal, where the button was; the status region says it.
                  <span className="flex items-center gap-1 px-2 text-caption text-muted-foreground">
                    <Check aria-hidden className="size-4 shrink-0" />
                    {t("meetings.askUniShared")}
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-disabled={share.isPending || undefined}
                    onClick={() =>
                      share.mutate(forChat(shown.content), {
                        onError: (err) => toastApiError(err, t("meetings.askUniShareFailed")),
                      })
                    }
                  >
                    {share.isPending ? <Spinner /> : <CornerUpRight aria-hidden />}
                    {t("meetings.panel.answer.share")}
                  </Button>
                )
              ) : null}
              {conversationId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openConversation(conversationId, { kind: "meeting", id: meetingId })}
                >
                  {t("meetings.panel.answer.continue")}
                  <Kbd aria-hidden className="pointer-coarse:hidden">
                    {shortcut}
                  </Kbd>
                </Button>
              ) : null}
            </div>
          </div>
        </article>
      ) : null}
      {/* Mounted with the card, before any sharing; the composer's region reads the answer itself. */}
      <p role="status" className="sr-only">
        {shared ? t("meetings.askUniShared") : ""}
      </p>
    </div>
  );
}
