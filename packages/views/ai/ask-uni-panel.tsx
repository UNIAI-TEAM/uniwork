"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useAiCapabilities,
  useAiConversations,
  useAiMessages,
  useAiPanelStore,
  useAskUni,
  useDeleteAiConversation,
} from "@uniwork/core/ai";
import { errorCode } from "@uniwork/core/api/http";
import type { AiCitation, AiMessage } from "@uniwork/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { useAskUniHotkey } from "./use-ask-uni-hotkey";

const KNOWN_ERRORS = new Set([
  "ai_quota_exceeded",
  "ai_rate_limited",
  "ai_disabled",
  "ai_context_forbidden",
  "ai_output_invalid",
  "ai_provider_error",
]);

const SUGGESTIONS = ["suggestion_overdue", "suggestion_meetings", "suggestion_chat"] as const;

function resolveErrorKey(err: unknown): string {
  const code = errorCode(err) ?? "";
  if (KNOWN_ERRORS.has(code)) return code;
  const message = (err as { message?: unknown } | null)?.message;
  const candidate = typeof message === "string" ? message : "";
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
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-caption text-foreground hover:bg-surface-hover pointer-coarse:min-h-11"
          >
            <span className="font-mono text-muted-foreground">[{c.source_id}]</span>
            <span className="truncate">{c.title || c.kind}</span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function Turn({ message }: { message: Pick<AiMessage, "id" | "role" | "content" | "citations"> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const mine = message.role === "user";
  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <span className="px-1 text-caption font-medium text-muted-foreground">{mine ? t("you") : t("uni")}</span>
      <div
        className={cn(
          "max-w-[94%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-body leading-6",
          mine ? "bg-surface-selected text-surface-selected-foreground" : "border border-border bg-surface text-foreground",
        )}
      >
        {message.content}
        {mine ? null : <Citations citations={message.citations} />}
      </div>
    </li>
  );
}

/** The ⌘J panel (spec F-09 §6): ClickUp-Brain-style sidebar, read-only answers with sources. */
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const askReset = ask.reset;
  const answeredConversation = ask.data?.conversation_id;
  useEffect(() => {
    if (answeredConversation && answeredConversation !== conversationId) askReset();
  }, [conversationId, answeredConversation, askReset]);

  if (!enabled) return null;

  const askQuestion = (raw: string) => {
    const q = raw.trim();
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
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    askQuestion(question);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const turns: Pick<AiMessage, "id" | "role" | "content" | "citations">[] = [...(messages.data ?? [])];
  if (pendingQuestion) turns.push({ id: "pending", role: "user", content: pendingQuestion, citations: [] });
  const showHome = !conversationId && !pendingQuestion;
  const recent = conversations.data ?? [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" closeLabel={t("close")}>
        <SheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 pr-8">
            {!showHome ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 shrink-0"
                aria-label={t("back_conversations")}
                onClick={() => select(null)}
              >
                <ArrowLeft aria-hidden className="size-4" />
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 text-title">
                <IconTile icon={Sparkles} size="sm" tone="violet" />
                {t("title")}
              </SheetTitle>
              <SheetDescription className="mt-0.5 line-clamp-2">{t("description")}</SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8"
                aria-label={t("new_conversation")}
                onClick={() => select(null)}
              >
                <MessageSquarePlus aria-hidden className="size-4" />
              </Button>
              {conversationId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8"
                  aria-label={t("delete_conversation")}
                  disabled={remove.isPending}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete_confirm_title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("delete_confirm_description")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={remove.isPending}>{t("delete_cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!conversationId) return;
                    remove.mutate(conversationId, {
                      onSuccess: () => {
                        setConfirmDelete(false);
                        select(null);
                      },
                    });
                  }}
                >
                  {t("delete_confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {showHome ? (
            <div className="flex h-full flex-col gap-6">
              <div className="flex flex-col items-center gap-3 pt-6 text-center">
                <IconTile icon={Sparkles} size="lg" tone="violet" />
                <div className="flex max-w-[40ch] flex-col gap-1">
                  <p className="text-body font-semibold text-foreground">{t("empty_title")}</p>
                  <p className="text-caption text-muted-foreground">{t("empty_description")}</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={ask.isPending}
                    onClick={() => askQuestion(t(key))}
                  >
                    {t(key)}
                  </Button>
                ))}
              </div>
              {recent.length > 0 ? (
                <div className="mt-auto space-y-2 border-t border-border pt-4">
                  <p className="text-caption font-medium text-muted-foreground">{t("conversations")}</p>
                  <ul className="space-y-1">
                    {recent.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left text-body hover:border-border hover:bg-surface-hover pointer-coarse:min-h-11"
                          onClick={() => select(c.id)}
                        >
                          <span className="min-w-0 flex-1 truncate">{c.title || t("untitled")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-4" aria-live="polite">
              {turns.map((m) => (
                <Turn key={m.id} message={m} />
              ))}
              {ask.isPending ? (
                <li className="flex items-center gap-2 text-caption text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {t("asking")}
                </li>
              ) : null}
            </ul>
          )}
          {ask.isError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-caption text-destructive"
            >
              {t(`errors.${resolveErrorKey(ask.error)}`)}
            </p>
          ) : null}
          {ask.data && !ask.isPending ? (
            <p className="mt-4 text-caption text-muted-foreground tabular-nums">
              {t("usage_tokens", { in: ask.data.usage.input_tokens, out: ask.data.usage.output_tokens })}
            </p>
          ) : null}
        </div>

        <form onSubmit={submit} className="border-t border-border bg-surface/60 p-3">
          <div className="rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
            <Textarea
              aria-label={t("placeholder")}
              aria-describedby="ask-uni-hint"
              placeholder={t("placeholder")}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={2000}
              className="min-h-[3.25rem] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-1">
              <p id="ask-uni-hint" className="text-caption text-muted-foreground">
                <Kbd>{t("key_enter")}</Kbd> {t("hint_send")}
              </p>
              <Button type="submit" size="sm" className="rounded-full px-4" disabled={!question.trim() || ask.isPending}>
                {ask.isPending ? <Spinner className="size-3.5" /> : null}
                {t("ask")}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
