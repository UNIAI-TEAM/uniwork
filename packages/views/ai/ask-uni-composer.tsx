"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import type { AskUniInput } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniMentionPicker, type MentionPick } from "./ask-uni-mention-picker";
import { AskUniModelPicker, useAskModelSelection } from "./ask-uni-model-picker";
import { AskUniScopePicker } from "./ask-uni-scope-picker";

const MAX_MENTIONS = 5;
const TRIGGER = /(^|\s)@([^\s@]*)$/;

type Focus = NonNullable<AskUniInput["focus"]> & { label: string };

/** The `@query` the caret sits in, if any; `start` is the index of its `@`. */
function findTrigger(text: string, caret: number) {
  const m = TRIGGER.exec(text.slice(0, caret));
  return m ? { start: m.index + (m[1]?.length ?? 0), query: m[2] ?? "" } : null;
}

function Chip({ label, remove, onRemove }: { label: string; remove: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-caption text-foreground">
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={remove}
        onClick={onRemove}
        className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}

/** The docked panel's composer: question box, `@` mentions, "+" scope, model choice, send or stop. */
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
  const conversationId = useAiPanelStore((s) => s.conversationId);
  const pendingFocus = useAiPanelStore((s) => s.pendingFocus);
  const clearPendingFocus = useAiPanelStore((s) => s.clearPendingFocus);
  const { model, effort } = useAskModelSelection(workspace.id);

  const box = useRef<HTMLTextAreaElement>(null);
  const nextCaret = useRef<number | null>(null);
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [mentions, setMentions] = useState<MentionPick[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [notice, setNotice] = useState("");

  const trigger = findTrigger(value, caret);
  const pickerOpen = trigger !== null && trigger.start !== dismissedAt;
  const kindLabel = (kind: string) => t(`scope.kind.${kind}`, { defaultValue: kind });

  // Typing starts at once: when the panel opens, a conversation is chosen, and after a turn ends.
  useEffect(() => {
    if (!streaming) box.current?.focus();
  }, [conversationId, streaming]);

  // An entry point's focus becomes the chip once.
  useEffect(() => {
    if (!pendingFocus) return;
    setFocus({ kind: pendingFocus.kind, id: pendingFocus.id, label: kindLabel(pendingFocus.kind) });
    clearPendingFocus();
    box.current?.focus();
    // kindLabel only reads the language, which a pending focus does not outlive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus, clearPendingFocus]);

  // After a pick the caret belongs after the inserted name.
  useLayoutEffect(() => {
    if (nextCaret.current === null || !box.current) return;
    box.current.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  });

  const pick = (p: MentionPick) => {
    if (!trigger) return;
    if (!mentions.some((m) => m.kind === p.kind && m.id === p.id)) {
      if (mentions.length >= MAX_MENTIONS) {
        setNotice(t("mention.limit", { max: MAX_MENTIONS }));
        setDismissedAt(trigger.start);
        return;
      }
      setMentions([...mentions, p]);
    }
    setNotice("");
    const insert = `@${p.label} `;
    setValue(value.slice(0, trigger.start) + insert + value.slice(caret));
    nextCaret.current = trigger.start + insert.length;
    setCaret(nextCaret.current);
    box.current?.focus();
  };

  const send = () => {
    const question = value.trim();
    if (!question || streaming) return;
    onSend({
      question,
      conversation_id: conversationId ?? undefined,
      focus: focus ? { kind: focus.kind, id: focus.id } : undefined,
      mentions: mentions.map(({ kind, id }) => ({ kind, id })),
      model,
      effort,
      locale: i18n.language,
    });
    setValue("");
    setCaret(0);
    setMentions([]);
    setNotice("");
  };

  const canSend = value.trim() !== "";
  return (
    <div className="relative flex flex-col gap-2 border-t border-border bg-background p-3" data-slot="ask-uni-composer">
      {pickerOpen && trigger ? (
        <AskUniMentionPicker
          wsId={workspace.id}
          query={trigger.query}
          inputRef={box}
          onPick={pick}
          onDismiss={() => setDismissedAt(trigger.start)}
        />
      ) : null}
      {focus || mentions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {focus ? (
            <Chip
              label={focus.label}
              remove={t("scope.remove", { name: focus.label })}
              onRemove={() => setFocus(null)}
            />
          ) : null}
          {mentions.map((m) => (
            <Chip
              key={`${m.kind}:${m.id}`}
              label={m.label}
              remove={t("mention.remove", { name: m.label })}
              onRemove={() => setMentions((all) => all.filter((x) => x !== m))}
            />
          ))}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-caption text-destructive">
          {notice}
        </p>
      ) : null}
      <Textarea
        ref={box}
        rows={1}
        value={value}
        aria-label={t("composer_label")}
        placeholder={t("placeholder")}
        className="max-h-[8lh] min-h-0 resize-none overflow-y-auto"
        onChange={(e) => {
          const next = findTrigger(e.target.value, e.target.selectionStart);
          if (next?.start !== dismissedAt) setDismissedAt(null);
          setValue(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          // Telex/VNI confirm a syllable with Enter; that must never send.
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          send();
        }}
      />
      <div className="flex flex-wrap items-center gap-1">
        {focus ? null : <AskUniScopePicker onPick={(p) => setFocus({ kind: p.kind, id: p.id, label: `${kindLabel(p.kind)}: ${p.title}` })} />}
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
              onClick={canSend ? send : undefined}
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
