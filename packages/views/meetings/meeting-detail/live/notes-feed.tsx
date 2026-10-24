"use client";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAddNote, useNotes } from "@uniwork/core/meetings";
import type { MeetingNote } from "@uniwork/core/types/meeting";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../../../toast-api-error";
import { MeetingRowsSkeleton, MeetingSectionError } from "../../meeting-section-state";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { Section } from "../ui/section";
import { TimeGutterRow } from "../ui/time-row";
import { AddMotionLine } from "./strip-vote-block";

type Variant = "overview" | "live" | "scheduled";

/**
 * The shared notes (kit `.rows.notes`): a 56 time gutter, the author only when
 * it changes, the text in body-lg. `live` is the body of the "Ghi chú chung"
 * tab with the composer (focused on load for the secretary, not on phone); `scheduled` is a
 * "Ghi chú" section with the composer (notes written ahead go into the
 * minutes) and, for whoever clerks, "+ Thêm biểu quyết"; `overview` is the
 * read-only "Ghi chú" section of a meeting that is over, drawn only when it
 * has notes. Outsiders get no notes at all, and nothing locks after the end.
 */
export function NotesFeed({ variant }: { variant: Variant }) {
  const { viewer } = useDetail();
  if (viewer === "outsider") return null;
  return <Feed variant={variant} />;
}

function Feed({ variant }: { variant: Variant }) {
  const { t } = useTranslation();
  const { meeting, viewer, isClerk } = useDetail();
  const { data, isPending, isError, refetch } = useNotes(meeting.id);
  const notes = data ?? [];

  const body = isPending ? (
    <MeetingRowsSkeleton rows={2} className="py-1" />
  ) : isError ? (
    <MeetingSectionError message={t("meetings.notesLoadFailed")} onRetry={() => void refetch()} />
  ) : notes.length > 0 ? (
    <NoteRows notes={notes} className={variant === "live" ? "mt-4 first:mt-0 @max-[37.5rem]/meeting:mt-3 [[data-panel=roll]_&]:mt-1" : undefined} />
  ) : variant === "overview" ? null : (
    <p className={cn("text-body text-muted-foreground", variant === "live" && "mt-4 first:mt-0")}>
      {t(variant === "live" ? "meetings.detail.notes.emptyLive" : "meetings.detail.notes.emptyBefore")}
    </p>
  );

  if (variant === "live") {
    return (
      <>
        {body}
        <NoteComposer
          label={t("meetings.detail.notes.composerLabel")}
          placeholder={t("meetings.detail.notes.placeholderLive")}
          autoFocus={viewer === "secretary"}
          className="mt-5 @max-[37.5rem]/meeting:mt-4 [[data-panel=roll]_&]:mt-2"
        />
      </>
    );
  }
  // An ended meeting with no notes draws no empty section (brief §4.12).
  if (variant === "overview" && !isError && notes.length === 0) return null;
  return (
    <>
      <Section id="ghi-chu" title={t("meetings.detail.notes.title")} count={notes.length || undefined}>
        {body}
        {variant === "scheduled" ? (
          <NoteComposer
            label={t("meetings.detail.notes.composerLabelBefore")}
            placeholder={t("meetings.detail.notes.placeholderBefore")}
            className={notes.length > 0 ? undefined : "mt-3"}
          />
        ) : null}
      </Section>
      {variant === "scheduled" && isClerk ? <AddMotionLine /> : null}
    </>
  );
}

function NoteRows({ notes, className }: { notes: MeetingNote[]; className?: string }) {
  const { t } = useTranslation();
  return (
    <ol className={cn("flex flex-col gap-2", className)}>
      {notes.map((note, i) => {
        const changed = i === 0 || notes[i - 1]!.author_id !== note.author_id;
        return (
          <TimeGutterRow
            key={note.id}
            time={clock(note.created_at)}
            author={changed ? note.display_name?.trim() || t("meetings.formerMember") : undefined}
            className={cn(changed && i > 0 && "mt-2")}
          >
            <span className="break-words whitespace-pre-wrap">{note.body}</span>
          </TimeGutterRow>
        );
      })}
    </ol>
  );
}

/**
 * The 44 composer (kit `.composer`): Enter adds the note, Shift+Enter breaks
 * the line, an IME composition is never cut short. The "Enter" hint grows to
 * "Enter để thêm" while the field has focus and hides on phone.
 */
function NoteComposer({
  label,
  placeholder,
  autoFocus = false,
  className = "mt-5",
}: {
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const hintId = useId();
  const addNote = useAddNote(meeting.id);
  const [note, setNote] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // A phone opens its keyboard on focus and hides half the page: a coarse pointer is never autofocused.
    if (autoFocus && !window.matchMedia?.("(pointer: coarse)").matches) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const body = note.trim();
    if (!body || addNote.isPending) return;
    addNote.mutate(body, {
      onSuccess: () => setNote(""),
      onError: (err) => toastApiError(err, t("meetings.noteAddFailed")),
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "group/composer flex min-h-11 items-center gap-2 rounded-control border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring",
        className,
      )}
    >
      <textarea
        ref={field}
        rows={1}
        value={note}
        enterKeyHint="send"
        aria-label={label}
        aria-describedby={hintId}
        aria-busy={addNote.isPending || undefined}
        placeholder={placeholder}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onKeyDown}
        className="field-sizing-content max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-body caret-primary placeholder:text-muted-foreground focus-visible:outline-none"
      />
      <span id={hintId} className="sr-only">
        {t("meetings.notesComposerHint")}
      </span>
      <kbd aria-hidden className="flex-none font-sans text-caption font-medium text-muted-foreground @max-[37.5rem]/meeting:hidden">
        <span className="group-focus-within/composer:hidden">{t("meetings.detail.notes.enter")}</span>
        <span className="hidden group-focus-within/composer:inline">{t("meetings.detail.notes.enterToAdd")}</span>
      </kbd>
    </form>
  );
}
