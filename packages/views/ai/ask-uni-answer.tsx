"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AiCitation, AiMessage } from "@uniwork/core/types";
import { SafeMarkdown } from "@uniwork/ui/markdown";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { AskUniActions } from "./ask-uni-actions";
import { CitationMarker, SourceChips } from "./ask-uni-citation";
import { AskUniSteps } from "./ask-uni-steps";

const NOTICES = new Set(["no_sources", "empty_answer", "agent_failed", "refused", "stopped", "interrupted"]);
// A partial answer that ended early keeps its text and gets a notice line; any other notice stands in for an empty answer.
const PARTIAL = new Set(["stopped", "interrupted"]);
const CITE_TOKEN = /\[S(\d+)\]/g;

export type AskUniTurnMessage = Pick<AiMessage, "id" | "role" | "content" | "citations"> & Partial<Pick<AiMessage, "notice">>;

/** The model-written answer as markdown: raw html inert, no images, links only in-app or to a cited source, `[S#]` as hoverable sources. */
function AnswerBody({ content, citations }: { content: string; citations: AiCitation[] }) {
  const byId = useMemo(() => new Map(citations.map((c) => [c.source_id, c])), [citations]);
  const isLinkAllowed = (href: string) =>
    (href.startsWith("/") && !href.startsWith("//")) || citations.some((c) => c.href === href);
  return (
    <SafeMarkdown
      isLinkAllowed={isLinkAllowed}
      renderLink={({ href, children }: { href: string; children: ReactNode }) => (
        <AppLink href={href} className="text-primary underline-offset-2 hover:underline">
          {children}
        </AppLink>
      )}
      inlineToken={{
        pattern: CITE_TOKEN,
        render: (m, key) => {
          const c = byId.get(`S${m[1]}`);
          return c ? <CitationMarker key={key} citation={c} /> : m[0];
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
  counts,
  onRegenerate,
  regenerateDisabled,
}: {
  message: AskUniTurnMessage;
  streaming?: boolean;
  conversationId?: string | null;
  /** Summed step counts, for the live turn and the one just finished. */
  counts?: Record<string, number>;
  onRegenerate?: () => void;
  regenerateDisabled?: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[94%] whitespace-pre-wrap rounded-lg bg-surface-selected px-3.5 py-2.5 text-body leading-6 text-surface-selected-foreground">
          {message.content}
        </div>
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
        {counts ? <AskUniSteps counts={counts} /> : null}
        {message.content ? <AnswerBody content={message.content} citations={message.citations} /> : null}
        {showNotice ? (
          <p className={cn("text-caption text-muted-foreground", message.content ? "mt-2" : "")}>{t(`notice.${noticeKey}`)}</p>
        ) : null}
        <SourceChips citations={message.citations} />
        {stored && conversationId ? (
          <AskUniActions
            conversationId={conversationId}
            messageId={message.id}
            content={message.content}
            onRegenerate={onRegenerate}
            regenerateDisabled={regenerateDisabled}
          />
        ) : null}
      </div>
    </li>
  );
}
