/**
 * Speaker-notes pane state (task A5 UI, UNI-927).
 *
 * Pure derivations kept out of the component so the pane's honesty rules are
 * unit-testable: which mode the pane is in, what its dirty status says, and
 * whether a commit is allowed. The component only renders what these decide.
 */

/** What the pane can show. `unbound` / `no_slide` are honest refusals, never a
 * fake empty editor. */
export type PptxNotesPaneMode = "unbound" | "no_slide" | "loading" | "ready";

export interface PptxNotesPaneModeInput {
  /** 0-based selected slide; null when no deck/slide is bound. */
  slideIndex: number | null;
  /** The host is fetching the selected slide's notes. */
  loading: boolean;
  /** No notes port is bound to the editor. */
  unbound: boolean;
}

/** Resolution order: unbound, then no slide, then loading, then ready. */
export function notesPaneMode(input: PptxNotesPaneModeInput): PptxNotesPaneMode {
  if (input.unbound) return "unbound";
  if (input.slideIndex === null || !Number.isInteger(input.slideIndex) || input.slideIndex < 0) {
    return "no_slide";
  }
  if (input.loading) return "loading";
  return "ready";
}

/** The status line the pane reports: a pending commit outranks dirty. */
export type PptxNotesStatus = "saved" | "dirty" | "pending";

export function notesStatus(input: { dirty: boolean; pending: boolean }): PptxNotesStatus {
  if (input.pending) return "pending";
  return input.dirty ? "dirty" : "saved";
}

export interface PptxNotesCommitInput {
  /** The bound notes text, or null while the host has not loaded it. */
  bound: string | null;
  /** The live draft in the textarea. */
  draft: string;
  /** A commit is already in flight. */
  pending: boolean;
  /** The document is read-only. */
  readonly: boolean;
  /** A commit port is bound. */
  boundPort: boolean;
}

/**
 * Commit only a real change with a bound port and a loaded baseline. Without a
 * loaded baseline (`bound === null`) the pane cannot know what it would
 * overwrite, so it never writes - the same refusal the engine applies to a
 * target it cannot resolve.
 */
export function notesCommitAllowed(input: PptxNotesCommitInput): boolean {
  if (!input.boundPort || input.readonly || input.pending) return false;
  if (input.bound === null) return false;
  return input.draft !== input.bound;
}
