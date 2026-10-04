"use client";

/**
 * The speaker-notes pane (task A5 UI, UNI-927).
 *
 * A self-contained panel: it owns the draft, the dirty state and the keyboard
 * contract, and reports exactly one committed edit through `onCommitNotes`.
 * It never touches the shared editor files - the UI-wire round mounts it and
 * binds `onCommitNotes` to the `set_notes` edit kind
 * (packages/office-engine/src/pptx/edits/notes-comment-edits.ts).
 *
 * Honesty rules: with no bound port the pane explains rather than faking an
 * editor; with no selected slide it asks for one; a read-only document keeps
 * the textarea readable (readOnly) and hides the commit control.
 */
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { cn } from "@uniwork/ui/lib/utils";
import { notesCommitAllowed, notesPaneMode, notesStatus, type PptxNotesStatus } from "./notes-pane-state";

export interface PptxNotesPaneProps {
  /** 0-based selected slide; null when no slide is bound. */
  slideIndex: number | null;
  /** The selected slide's notes text, or null while the host has not loaded it. */
  notes: string | null;
  /** Commit one edit: the selected slide's new notes text (an empty string
   *  clears the notes body, mirroring the `set_notes` engine kind). */
  onCommitNotes?: (slideIndex: number, text: string) => Promise<unknown> | unknown;
  /** The host is fetching the selected slide's notes. */
  loading?: boolean;
  /** Read-only document. */
  readonly?: boolean;
  /** No notes port is bound to this editor. */
  unbound?: boolean;
  /** A host error to surface; the pane never swallows it. */
  error?: string | null;
  /** A commit is in flight. */
  pending?: boolean;
  onClose?: () => void;
  className?: string;
}

const STATUS_KEY: Record<PptxNotesStatus, string> = {
  saved: "notes.saved",
  dirty: "notes.dirty",
  pending: "notes.pending",
};

export function PptxNotesPane({
  slideIndex,
  notes,
  onCommitNotes,
  loading = false,
  readonly = false,
  unbound = false,
  error = null,
  pending = false,
  onClose,
  className,
}: PptxNotesPaneProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const boundPort = typeof onCommitNotes === "function";
  const mode = notesPaneMode({ slideIndex, loading, unbound: unbound || !boundPort });
  const [draft, setDraft] = useState<string>(notes ?? "");

  // The bound notes are the source of truth: a slide change or a completed
  // commit resets the draft. A commit that fails leaves `notes` unchanged, so
  // the draft survives and the user does not lose what they typed.
  useEffect(() => {
    setDraft(notes ?? "");
  }, [notes, slideIndex]);

  const dirty = notes !== null && draft !== notes;
  const status = notesStatus({ dirty, pending });
  const canCommit = notesCommitAllowed({ bound: notes, draft, pending, readonly, boundPort });
  const slideLabel = slideIndex === null ? "" : String(slideIndex + 1);

  const commit = useCallback(() => {
    if (!canCommit || slideIndex === null) return;
    const text = draft;
    // Fire-and-forget: the host reports success/failure through `notes` and
    // `error`, and a rejection must not become an unhandled promise.
    void Promise.resolve(onCommitNotes?.(slideIndex, text)).catch(() => undefined);
  }, [canCommit, draft, onCommitNotes, slideIndex]);

  const revert = useCallback(() => setDraft(notes ?? ""), [notes]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      revert();
    }
  };

  return (
    <section
      aria-label={t("notes.title")}
      data-pptx-notes-pane
      data-testid="pptx-notes-pane"
      data-pptx-notes-mode={mode}
      className={cn("flex min-w-0 flex-col gap-2 border-t border-border bg-muted/10 p-2", className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-label font-medium text-foreground">{t("notes.title")}</span>
        {mode === "ready" ? (
          <span className="min-w-0 truncate text-caption text-muted-foreground" data-pptx-notes-slide data-testid="pptx-notes-slide">
            {t("notes.for_slide", { index: slideLabel })}
          </span>
        ) : null}
        {onClose ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="ml-auto shrink-0"
            aria-label={t("notes.close")}
            onClick={onClose}
          >
            <span aria-hidden="true">{"\u00d7"}</span>
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" data-pptx-notes-error className="text-caption text-destructive">
          {t("notes.error_title")} {t("notes.error", { message: error })}
        </p>
      ) : null}

      {mode === "unbound" ? (
        <p className="text-caption text-muted-foreground" data-pptx-notes-unbound data-testid="pptx-notes-unbound">{t("notes.unbound")}</p>
      ) : mode === "no_slide" ? (
        <p className="text-caption text-muted-foreground" data-pptx-notes-no-slide data-testid="pptx-notes-no-slide">{t("notes.no_slide")}</p>
      ) : mode === "loading" ? (
        <p className="text-caption text-muted-foreground" role="status" data-pptx-notes-loading data-testid="pptx-notes-loading">{t("notes.loading")}</p>
      ) : (
        <Textarea
          value={draft}
          rows={4}
          readOnly={readonly}
          aria-label={t("notes.for_slide", { index: slideLabel })}
          placeholder={t("notes.placeholder")}
          className="min-h-20"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
      )}

      {mode === "ready" ? (
        <div className="flex min-w-0 items-center gap-2">
          <span
            role="status"
            aria-live="polite"
            data-pptx-notes-status={status}
            data-testid="pptx-notes-status"
            className={cn("min-w-0 truncate text-caption", status === "dirty" ? "text-warning" : "text-muted-foreground")}
          >
            {readonly ? t("notes.readonly") : t(STATUS_KEY[status])}
          </span>
          {!readonly && boundPort ? (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={!dirty || pending} onClick={revert}>
                {t("notes.revert")}
              </Button>
              <Button type="button" size="sm" disabled={!canCommit} onClick={commit}>
                {t("notes.commit")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {mode === "ready" && !readonly && boundPort ? (
        <p className="text-caption text-muted-foreground">{t("notes.hint")}</p>
      ) : null}
    </section>
  );
}
