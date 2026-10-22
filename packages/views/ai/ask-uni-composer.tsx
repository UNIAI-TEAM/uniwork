"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import type { AskUniInput } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { useWorkspace } from "../layout/workspace-context";
import { entityKindIcon } from "./ask-uni-entity";
import { AskUniEditor, type AskUniEditorHandle, type AskUniQuestion } from "./ask-uni-editor";
import { AskUniModelPicker, useAskModelSelection } from "./ask-uni-model-picker";
import { useEffectiveFocus, useShownPage } from "./ask-uni-page-context";
import { AskUniScopePicker } from "./ask-uni-scope-picker";

const MAX_MENTIONS = 5;
const EMPTY: AskUniQuestion = { question: "", mentions: [] };

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

/** The docked panel's composer: one frame with the focus chip, the question box (`@` cards in the text) and the buttons. */
export function AskUniComposer({
  onSend,
  onStop,
  streaming,
}: {
  onSend: (input: AskUniInput) => void;
  onStop: () => void;
  streaming: boolean;
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

  const box = useRef<AskUniEditorHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const wasStreaming = useRef(streaming);
  const [draft, setDraft] = useState<AskUniQuestion>(EMPTY);
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

  const send = ({ question, mentions }: AskUniQuestion) => {
    if (!question || streaming) return;
    onSend({
      question,
      conversation_id: conversationId ?? undefined,
      focus: sent ? { kind: sent.kind, id: sent.id } : undefined,
      mentions,
      model,
      effort,
      locale: i18n.language,
    });
    box.current?.clear();
  };

  const canSend = draft.question !== "";
  return (
    <div ref={root} className="bg-background p-3" data-slot="ask-uni-composer">
      <div
        data-slot="ask-uni-composer-frame"
        className="relative flex flex-col gap-2 rounded-2xl border border-border p-2 transition-colors has-[.ProseMirror-focused]:border-ring has-[.ProseMirror-focused]:ring-2 has-[.ProseMirror-focused]:ring-ring/30"
      >
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
        <AskUniEditor
          ref={box}
          wsId={workspace.id}
          placeholder={placeholderKind ? t(`placeholder_${placeholderKind}`, { defaultValue: t("placeholder") }) : t("placeholder")}
          maxMentions={MAX_MENTIONS}
          onSubmit={send}
          onChange={setDraft}
        />
        <div className="flex flex-wrap items-center gap-1">
          <AskUniScopePicker
            finalFocus={() => {
              box.current?.focus();
              return false;
            }}
            onPick={(p) => setFocus({ kind: p.kind, id: p.id, label: p.title })}
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
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
