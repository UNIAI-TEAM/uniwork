"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AiCitation, AiMessage, AiStep } from "@uniwork/core/types";
import { SafeMarkdown } from "@uniwork/ui/markdown";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { AskUniActions } from "./ask-uni-actions";
import { isInAppHref } from "./ask-uni-links";
import { AskUniEntityChip, AskUniSources, InLinkContext } from "./ask-uni-entity";
import { AskUniContextChips } from "./ask-uni-context-chips";
import { AskUniMessageMeta } from "./ask-uni-meta";
import { AskUniProgress } from "./ask-uni-steps";

const NOTICES = new Set(["no_sources", "empty_answer", "agent_failed", "refused", "stopped", "interrupted"]);
// A partial answer that ended early keeps its text and gets a notice line; any other notice stands in for an empty answer.
const PARTIAL = new Set(["stopped", "interrupted"]);
const CITE_TOKEN = /\[S(\d+)\]/g;

export type AskUniTurnMessage = Pick<AiMessage, "id" | "role" | "content" | "citations"> & Partial<Pick<AiMessage, "notice" | "steps" | "focus" | "mentions" | "created_at">>;

/** The model-written answer as markdown: raw html inert, no images, links only in-app or to a cited source, `[S#]` as entity chips. */
function AnswerBody({ content, byId, wsId }: { content: string; byId: Map<string, AiCitation>; wsId: string }) {
  // A cited href is held to the same rule as any other: only in-app paths become links.
  const isLinkAllowed = isInAppHref;
  return (
    <SafeMarkdown
      isLinkAllowed={isLinkAllowed}
      renderLink={({ href, children }: { href: string; children: ReactNode }) => (
        <AppLink href={href} className="text-primary underline-offset-2 hover:underline">
          <InLinkContext.Provider value>{children}</InLinkContext.Provider>
        </AppLink>
      )}
      inlineToken={{
        pattern: CITE_TOKEN,
        render: (m, key) => {
          const c = byId.get(`S${m[1]}`);
          // A marker the source book does not know renders nothing.
          return c ? <AskUniEntityChip key={key} source={c} wsId={wsId} /> : null;
        },
      }}
    >
      {content}
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
  /** The conversation's source book by `S#`: markers are numbered across every answer in it. Defaults to this message's own citations. */
  sources?: Map<string, AiCitation>;
  wsId?: string;
  onRegenerate?: () => void;
  regenerateDisabled?: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const byId = useMemo(() => sources ?? new Map(message.citations.map((c) => [c.source_id, c])), [sources, message.citations]);
  if (message.role === "user") {
    return (
      <li className="flex flex-col items-end gap-1">
        <AskUniMessageMeta from="user" createdAt={message.created_at ?? ""} />
        <div className="max-w-[94%] whitespace-pre-wrap rounded-lg bg-surface-selected px-3.5 py-2.5 text-body leading-6 text-surface-selected-foreground">
          {message.content}
        </div>
        <AskUniContextChips refs={[...(message.focus ? [message.focus] : []), ...(message.mentions ?? [])]} />
      </li>
    );
  }
  const notice = message.notice ?? "";
  const noticeKey = NOTICES.has(notice) ? notice : notice ? "unavailable" : "";
  const showNotice = noticeKey !== "" && (message.content === "" || PARTIAL.has(notice));
  const stored = !streaming && !message.id.startsWith("pending-") && message.id !== "live";
  return (
    <li className="flex flex-col items-start">
      <div className="w-full min-w-0">
        <div className="mb-1">
          <AskUniMessageMeta from="assistant" createdAt={message.created_at ?? ""} />
        </div>
        <AskUniProgress steps={steps ?? message.steps ?? []} running={streaming} writing={writing} />
        {message.content ? <AnswerBody content={message.content} byId={byId} wsId={wsId} /> : null}
        {showNotice ? (
          <p className={cn("text-caption text-muted-foreground", message.content ? "mt-2" : "")}>{t(`notice.${noticeKey}`)}</p>
        ) : null}
        <AskUniSources citations={message.citations} />
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
