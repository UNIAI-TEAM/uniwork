"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiConversations, useAiPanelStore } from "@uniwork/core/ai";
import { askDisplayAttachments, type StagedAskFile } from "@uniwork/core/ai/attachments";
import type { AskOutcome } from "@uniwork/core/ai/stream";
import type { AiAttachment, AskUniInput } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniAttachmentRow } from "./ask-uni-attachment-chip";
import { entityKindIcon } from "./ask-uni-entity";
import { AskUniEditor, type AskUniEditorHandle, type AskUniQuestion } from "./ask-uni-editor";
import { AskUniComposerNotes, AskUniComposerNotesSign } from "./ask-uni-composer-notes";
import { AskUniModeButton, useAskUniMode } from "./ask-uni-mode-button";
import { AskUniModelPicker, useAskModelSelection } from "./ask-uni-model-picker";
import { useEffectiveFocus, useShownPage } from "./ask-uni-page-context";
import { AskUniScopePicker } from "./ask-uni-scope-picker";
import type { AskUniAttachments } from "./use-ask-uni-attachments";

const MAX_MENTIONS = 5;
const EMPTY: AskUniQuestion = { question: "", mentions: [] };

/** The file a refusal names: the server ends `ai_attachment_unreadable`'s message with it, quoted. */
function namedFile(message: string): string | null {
  const quoted = /("(?:[^"\\]|\\.)*")\s*$/.exec(message)?.[1];
  if (!quoted) return null;
  try {
    return JSON.parse(quoted) as string;
  } catch {
    return quoted.slice(1, -1);
  }
}

function Chip({ label, remove, onRemove, icon: Icon }: { label: string; remove: string; onRemove: () => void; icon?: LucideIcon }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted pl-2.5 text-caption text-foreground">
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className="truncate">{label}</span>
      {/* The primitive carries the 44px coarse-pointer target. */}
      <Button type="button" variant="ghost" size="icon-xs" aria-label={remove} className="rounded-full text-muted-foreground" onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </span>
  );
}

/**
 * The docked panel's composer: one frame with the focus chip, the files, the question box (`@` cards in the text) and
 * the buttons. `attachments` turns on file attaching (the "+" menu's upload row, pasted images and the chip row);
 * without it the composer takes no files.
 */
export function AskUniComposer({
  onSend,
  onStop,
  streaming,
  attachments,
}: {
  /** Resolves with whether the server took the question; until then, and after a refusal, the composer keeps it. */
  onSend: (input: AskUniInput, display?: { attachments: AiAttachment[] }) => Promise<AskOutcome> | void;
  onStop: () => void;
  streaming: boolean;
  attachments?: AskUniAttachments;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const focus = useAiPanelStore((s) => s.focus);
  const setFocus = useAiPanelStore((s) => s.setFocus);
  const conversationId = useAiPanelStore((s) => s.conversationId);
  const pendingFocus = useAiPanelStore((s) => s.pendingFocus);
  const clearPendingFocus = useAiPanelStore((s) => s.clearPendingFocus);
  const page = useShownPage();
  const sent = useEffectiveFocus();
  const dismissPage = useAiPanelStore((s) => s.dismissPage);
  const { model, effort } = useAskModelSelection(workspace.id);
  const askMode = useAskUniMode(workspace.id)?.mode;
  const tainted = useAiConversations(workspace.id).data?.find((c) => c.id === conversationId)?.tainted ?? false;

  const box = useRef<AskUniEditorHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const wasStreaming = useRef(streaming);
  const [draft, setDraft] = useState<AskUniQuestion>(EMPTY);
  // The box as of now, read when a send resolves; draft is the render's copy.
  const typed = useRef<AskUniQuestion>(EMPTY);
  // Why the server refused the last question before taking it, as an `ai.errors` code.
  const [refusal, setRefusal] = useState<string | null>(null);
  const kindLabel = (kind: string) => t(`scope.kind.${kind}`, { defaultValue: kind });

  // Typing starts at once when the panel opens and when a conversation is chosen.
  useEffect(() => {
    box.current?.focus();
  }, [conversationId]);

  // A turn ends: bring the caret back only if the reader is not typing somewhere else in the app.
  useEffect(() => {
    const ended = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!ended) return;
    const active = document.activeElement;
    if (!active || active === document.body || root.current?.closest('[data-slot="ask-uni-panel"]')?.contains(active) || root.current?.contains(active)) {
      box.current?.focus();
    }
  }, [streaming]);

  // An entry point's focus becomes the chip once.
  useEffect(() => {
    if (!pendingFocus) return;
    setFocus({ kind: pendingFocus.kind, id: pendingFocus.id, label: pendingFocus.label });
    clearPendingFocus();
    box.current?.focus();
  }, [pendingFocus, clearPendingFocus, setFocus]);

  // A hand-picked focus wins over the page; a removed page chip stays off until another page.
  const shownPage = focus ? null : page;
  const focusLabel = focus ? (focus.label ? `${kindLabel(focus.kind)}: ${focus.label}` : kindLabel(focus.kind)) : "";
  const placeholderKind = sent?.kind;
  const pageLabel = shownPage ? t("page_chip", { label: shownPage.label || kindLabel(shownPage.kind) }) : "";

  // A file still uploading is not yet a file, and a failed one would silently drop out: the question waits for both.
  const filesWait = !!attachments && (attachments.busy || attachments.blocked);
  // Marks the staged chip a refusal names, and says whether one was found.
  const markUnreadable = (sentFiles: StagedAskFile[], message: string) => {
    const name = namedFile(message);
    const named = sentFiles.filter((x) => (x.uploaded?.name ?? x.file.name) === name);
    for (const x of named) attachments?.fail(x.key, "ai_attachment_unreadable");
    return named.length > 0;
  };

  const send = ({ question, mentions }: AskUniQuestion) => {
    if (!question || streaming || filesWait) return;
    const ids = attachments?.ids ?? [];
    const sentFiles = attachments?.files.filter((x) => x.status === "ready") ?? [];
    setRefusal(null);
    const outcome = onSend(
      {
        question,
        conversation_id: conversationId ?? undefined,
        focus: sent ? { kind: sent.kind, id: sent.id } : undefined,
        mentions,
        attachment_ids: ids.length > 0 ? ids : undefined,
        model,
        effort,
        ...(askMode ? { mode: askMode } : {}),
        locale: i18n.language,
      },
      ids.length > 0 ? { attachments: askDisplayAttachments(attachments?.files ?? []) } : undefined,
    );
    // The question leaves the box once the server took it; anything typed meanwhile stays.
    const taken = () => {
      if (typed.current.question === question) box.current?.clear();
      attachments?.clear(sentFiles.map((x) => x.key));
    };
    if (!outcome) {
      taken();
      return;
    }
    void outcome.then((o) => {
      if (o.accepted) taken();
      // A turn stopped or replaced before it was taken has nothing to report.
      else if (o.code && !(o.code === "ai_attachment_unreadable" && markUnreadable(sentFiles, o.message))) setRefusal(o.code);
    });
  };

  const canSend = draft.question !== "" && !filesWait;
  return (
    <div ref={root} className="bg-background p-3" data-slot="ask-uni-composer">
      <AskUniComposerNotes wsId={workspace.id} tainted={tainted} />
      <div
        data-slot="ask-uni-composer-frame"
        className="relative flex flex-col gap-2 rounded-2xl border border-border bg-[var(--ask-input)] p-2 transition-colors has-[.ProseMirror-focused]:border-ring has-[.ProseMirror-focused]:ring-2 has-[.ProseMirror-focused]:ring-ring/30"
      >
        <AskUniComposerNotesSign wsId={workspace.id} tainted={tainted} />
        {focus ? (
          <div className="flex flex-wrap gap-1.5">
            <Chip
              label={focusLabel}
              remove={t("scope.remove", { name: focusLabel })}
              onRemove={() => {
                setFocus(null);
                box.current?.focus();
              }}
            />
          </div>
        ) : null}
        {shownPage ? (
          <div className="flex flex-wrap gap-1.5">
            <Chip
              icon={entityKindIcon(shownPage.kind === "room" ? "chat" : shownPage.kind)}
              label={pageLabel}
              remove={t("scope.remove", { name: pageLabel })}
              onRemove={() => {
                dismissPage();
                box.current?.focus();
              }}
            />
          </div>
        ) : null}
        {attachments ? <AskUniAttachmentRow attachments={attachments} /> : null}
        {refusal ? (
          <p role="alert" className="text-caption text-destructive">
            {t(`errors.${refusal}`, { defaultValue: t("errors.default") })}
          </p>
        ) : null}
        <AskUniEditor
          ref={box}
          wsId={workspace.id}
          placeholder={placeholderKind ? t(`placeholder_${placeholderKind}`, { defaultValue: t("placeholder") }) : t("placeholder")}
          maxMentions={MAX_MENTIONS}
          onSubmit={send}
          onChange={(q) => {
            typed.current = q;
            setDraft(q);
          }}
          onPasteFiles={attachments?.attach}
        />
        <div className="flex flex-wrap items-center gap-1">
          <AskUniScopePicker
            finalFocus={() => {
              box.current?.focus();
              return false;
            }}
            onPick={(p) => setFocus({ kind: p.kind, id: p.id, label: p.title })}
            onFiles={attachments?.attach}
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            <AskUniModeButton wsId={workspace.id} />
            <AskUniModelPicker />
            {streaming ? (
              <Button type="button" size="icon-sm" aria-label={t("stop")} onClick={onStop}>
                <Square aria-hidden />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                aria-label={t("ask")}
                aria-disabled={!canSend || undefined}
                onClick={canSend ? () => send(draft) : undefined}
              >
                <ArrowUp aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
