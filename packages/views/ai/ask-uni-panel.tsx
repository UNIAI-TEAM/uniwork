"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useAiCapabilities,
  useAiConversations,
  useAiMessages,
  useAiPanelStore,
  useAskUni,
  useDeleteAiConversation,
} from "@uniwork/core/ai";
import type { AiCitation, AiMessage } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { useAskUniHotkey } from "./use-ask-uni-hotkey";

const KNOWN_ERRORS = new Set(["ai_quota_exceeded", "ai_rate_limited", "ai_disabled", "ai_context_forbidden", "ai_output_invalid", "ai_provider_error"]);

function errorKey(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const message = (err as { message?: unknown } | null)?.message;
  const candidate = typeof code === "string" ? code : typeof message === "string" ? message : "";
  return KNOWN_ERRORS.has(candidate) ? candidate : "default";
}

function Citations({ citations }: { citations: AiCitation[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const linkable = citations.filter((c) => c.href);
  if (linkable.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("sources")}>
      {linkable.map((c) => (
        <li key={c.source_id}>
          <AppLink
            href={c.href}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-caption text-foreground hover:bg-surface-hover"
          >
            <span className="font-mono text-muted-foreground">[{c.source_id}]</span>
            <span className="truncate">{c.title || c.kind}</span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function Turn({ message }: { message: Pick<AiMessage, "role" | "content" | "citations"> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const mine = message.role === "user";
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      <span className="sr-only">{mine ? t("you") : t("uni")}</span>
      <div
        className={cn(
          "max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-body leading-6",
          mine ? "bg-surface-selected text-surface-selected-foreground" : "bg-muted text-foreground",
        )}
      >
        {message.content}
        {mine ? null : <Citations citations={message.citations} />}
      </div>
    </li>
  );
}

/** The ⌘J panel (spec F-09 §6): my conversations, one at a time, read-only answers with sources. */
export function AskUniPanel() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const caps = useAiCapabilities(workspace.id);
  const enabled = !!caps.data?.enabled;
  useAskUniHotkey(enabled);
  const { open, setOpen, conversationId, select } = useAiPanelStore();
  const conversations = useAiConversations(workspace.id, open && enabled);
  const messages = useAiMessages(conversationId);
  const ask = useAskUni(workspace.id);
  const remove = useDeleteAiConversation(workspace.id);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  if (!enabled) return null;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (!q || ask.isPending) return;
    setPendingQuestion(q);
    setQuestion("");
    ask.mutate(
      { question: q, conversation_id: conversationId ?? undefined, locale: i18n.language },
      {
        onSuccess: (res) => select(res.conversation_id),
        onSettled: () => setPendingQuestion(null),
        onError: () => setQuestion(q),
      },
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const turns: Pick<AiMessage, "role" | "content" | "citations">[] = [...(messages.data ?? [])];
  if (pendingQuestion) turns.push({ role: "user", content: pendingQuestion, citations: [] });
  const showList = !conversationId && !pendingQuestion;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" aria-describedby={undefined}>
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-title">
            <Sparkles aria-hidden className="size-4" />
            {t("title")}
          </SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
          <div className="mt-1 flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => select(null)} disabled={showList}>
              <MessageSquarePlus aria-hidden className="size-4" />
              {t("new_conversation")}
            </Button>
            {conversationId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("delete_conversation")}
                disabled={remove.isPending}
                onClick={() => remove.mutate(conversationId, { onSuccess: () => select(null) })}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            ) : null}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {showList ? (
            conversations.data && conversations.data.length > 0 ? (
              <div className="space-y-1">
                <p className="text-caption font-medium text-muted-foreground">{t("conversations")}</p>
                <ul className="space-y-0.5">
                  {conversations.data.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full truncate rounded-md px-2 py-1.5 text-left text-body hover:bg-surface-hover"
                        onClick={() => select(c.id)}
                      >
                        {c.title || t("untitled")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center" role="status">
                <p className="text-body font-medium">{t("empty_title")}</p>
                <p className="max-w-[36ch] text-caption text-muted-foreground">{t("empty_description")}</p>
              </div>
            )
          ) : (
            <ul className="space-y-3" aria-live="polite">
              {turns.map((m, i) => (
                <Turn key={i} message={m} />
              ))}
              {ask.isPending ? (
                <li className="flex items-center gap-2 text-caption text-muted-foreground">
                  <Spinner className="size-3" />
                  {t("asking")}
                </li>
              ) : null}
            </ul>
          )}
          {ask.isError ? (
            <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-caption text-destructive">
              {t(`errors.${errorKey(ask.error)}`)}
            </p>
          ) : null}
          {ask.data && !ask.isPending ? (
            <p className="mt-3 text-caption text-muted-foreground tabular-nums">
              {t("usage_tokens", { in: ask.data.usage.input_tokens, out: ask.data.usage.output_tokens })}
            </p>
          ) : null}
        </div>

        <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-3">
          <Textarea
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            className="min-h-0 flex-1 resize-none"
          />
          <Button type="submit" disabled={!question.trim() || ask.isPending}>
            {t("ask")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
