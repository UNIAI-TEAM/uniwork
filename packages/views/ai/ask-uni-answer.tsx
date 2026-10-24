"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AiCitation, AiMessage, AiStep } from "@uniwork/core/types";
import { SafeMarkdown } from "@uniwork/ui/markdown";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { AskUniActions } from "./ask-uni-actions";
import { isInAppHref } from "./ask-uni-links";
import { dropEchoedNames } from "./ask-uni-text";
import { AskUniEntityChip, AskUniSources, InLinkContext } from "./ask-uni-entity";
import { AskUniContextChips } from "./ask-uni-context-chips";
import { AskUniFileNotes, AskUniQuestionFiles } from "./ask-uni-files";
import { AskUniProposalCard } from "./ask-uni-proposal-card";
import { AskUniMessageMeta } from "./ask-uni-meta";
import { useAskModelLook } from "./ask-uni-provider";
import { AskUniProgress } from "./ask-uni-steps";

const NOTICES = new Set(["no_sources", "empty_answer", "agent_failed", "refused", "stopped", "interrupted"]);
// A partial answer that ended early keeps its text and gets a notice line; any other notice stands in for an empty answer.
const PARTIAL = new Set(["stopped", "interrupted"]);
const CITE_TOKEN = /\[S(\d+)\]/g;

export type AskUniTurnMessage = Pick<AiMessage, "id" | "role" | "content" | "citations"> & Partial<Pick<AiMessage, "notice" | "steps" | "focus" | "mentions" | "model" | "created_at" | "attachments" | "file_notes" | "proposals">>;

// How an answer or a question shows a link that isInAppHref lets through.
const inAppLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <AppLink href={href} className="text-primary underline-offset-2 hover:underline">
    <InLinkContext.Provider value>{children}</InLinkContext.Provider>
  </AppLink>
);

/** The model-written answer as markdown: raw html inert, no images, links only in-app or to a cited source, `[S#]` as entity chips. */
function AnswerBody({ content, byId, wsId, streaming }: { content: string; byId: Map<string, AiCitation>; wsId: string; streaming: boolean }) {
  // A cited href is held to the same rule as any other: only in-app paths become links.
  const isLinkAllowed = isInAppHref;
  // Copy (answerPlainText) drops the same echoes, so both read the name once; a draft keeps them, or a name would
  // show and vanish as its words arrive.
  const text = useMemo(() => (streaming ? content : dropEchoedNames(content, byId)), [content, byId, streaming]);
  return (
    <SafeMarkdown
      isLinkAllowed={isLinkAllowed}
      renderLink={inAppLink}
      inlineToken={{
        pattern: CITE_TOKEN,
        render: (m, key) => {
          const c = byId.get(`S${m[1]}`);
          // A marker the source book does not know renders nothing.
          return c ? <AskUniEntityChip key={key} source={c} wsId={wsId} /> : null;
        },
      }}
    >
      {text}
    </SafeMarkdown>
  );
}

/**
 * One question or answer. `notice` is optional so a static preview can render a turn.
 * The action bar needs `conversationId` and shows only for a finished, stored answer;
 * `onRegenerate` is passed for the last answer only.
 */
export function AskUniMessageTurn({
  message,
  streaming = false,
  conversationId,
  steps,
  writing = false,
  sources,
  wsId = "",
  onRegenerate,
  regenerateDisabled,
}: {
  message: AskUniTurnMessage;
  streaming?: boolean;
  conversationId?: string | null;
  /** The live turn's steps; a stored turn reads its own from `message.steps`. */
  steps?: AiStep[];
  /** True once the live answer's first text has arrived. */
  writing?: boolean;
  /** The conversation's source book by `S#`, for markers this message does not cite itself; its own citations win. */
  sources?: Map<string, AiCitation>;
  wsId?: string;
  onRegenerate?: () => void;
  regenerateDisabled?: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  // An earlier P0 turn numbered from S1 again, so a number the conversation shares may name another object here.
  const byId = useMemo(
    () => new Map([...(sources ?? []), ...message.citations.map((c): [string, AiCitation] => [c.source_id, c])]),
    [sources, message.citations],
  );
  const look = useAskModelLook(wsId, message.role === "assistant" ? (message.model ?? "") : "");
  // The streaming bubble and the cache's echo of a question carry upload ids until the refetch swaps in the stored turn.
  const settled = !message.id.startsWith("pending-") && message.id !== "live" && message.id !== "live-question";
  if (message.role === "user") {
    return (
      <li className="flex flex-col items-end gap-1">
        <AskUniMessageMeta from="user" createdAt={message.created_at ?? ""} />
        {/* The question is the composer's markdown; a block's outer margins would pad the bubble. */}
        <SafeMarkdown
          isLinkAllowed={isInAppHref}
          renderLink={inAppLink}
          className="max-w-[94%] min-w-0 rounded-lg bg-surface-selected px-3.5 py-2.5 leading-6 text-surface-selected-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        >
          {message.content}
        </SafeMarkdown>
        <AskUniQuestionFiles files={message.attachments ?? []} wsId={settled ? wsId : undefined} />
        <AskUniContextChips refs={[...(message.focus ? [message.focus] : []), ...(message.mentions ?? [])]} />
      </li>
    );
  }
  const notice = message.notice ?? "";
  const noticeKey = NOTICES.has(notice) ? notice : notice ? "unavailable" : "";
  const showNotice = noticeKey !== "" && (message.content === "" || PARTIAL.has(notice));
  const stored = !streaming && settled;
  return (
    <li className="flex flex-col items-start">
      <div className="w-full min-w-0">
        <div className="mb-1">
          <AskUniMessageMeta from="assistant" createdAt={message.created_at ?? ""} model={message.model ?? ""} look={look} />
        </div>
        <AskUniProgress steps={steps ?? message.steps ?? []} running={streaming} writing={writing} />
        {message.content ? <AnswerBody content={message.content} byId={byId} wsId={wsId} streaming={streaming} /> : null}
        {showNotice ? (
          <p className={cn("text-caption text-muted-foreground", message.content ? "mt-2" : "")}>{t(`notice.${noticeKey}`)}</p>
        ) : null}
        <AskUniFileNotes notes={message.file_notes ?? []} />
        <AskUniSources citations={message.citations} />
        {stored && conversationId && (message.proposals?.length ?? 0) > 0 ? (
          <AskUniProposalCard message={{ id: message.id, proposals: message.proposals ?? [] }} conversationId={conversationId} mode={message.proposals?.[0]?.mode ?? ""} />
        ) : null}
        {stored && conversationId ? (
          <AskUniActions
            conversationId={conversationId}
            messageId={message.id}
            content={message.content}
            sources={byId}
            onRegenerate={onRegenerate}
            regenerateDisabled={regenerateDisabled}
          />
        ) : null}
      </div>
    </li>
  );
}
