// UNI-927 W14 - the save-point rebase of a pptx runtime's edit journal.
//
// A pptx runtime snapshot is a journal replayed onto the base bytes. Once a
// Save commits, the saved bytes are the document's base (the draft store
// relabels every later checkpoint with the new base), so the journal must
// lose the entries those bytes already contain - otherwise a recovered draft
// replays them a second time onto a deck that holds them. The web and desktop
// runtimes (mirrors) both move their history through this one function.

/** The runtime history fields the rebase moves (mutated in place). */
export interface PptxJournalHistory<E> {
  journal: E[];
  /** Entries the live model holds; entries past it wait on redo. */
  cursor: number;
  /** History step boundaries, ascending; the cursor is 0 or one of them. */
  steps: number[];
  /** Equals the cursor: one runtime revision per applied entry. */
  revision: number;
}

/**
 * Drop the saved prefix: `saved` is journal[0..k) as it stood when the
 * committed bytes were serialized. Entries after it (typing that landed while
 * the Save was in flight, and any redo tail past it) stay, shifted down by k.
 * Their replay refs were recorded on decks that already held the prefix, so
 * they resolve against the saved bytes, which are exactly that deck.
 *
 * Returns false and leaves the history untouched when the live model no longer
 * holds that prefix (fewer applied entries, or a different entry at some
 * index): the saved bytes and the history then share no common base.
 */
export function rebasePptxJournal<E>(
  history: PptxJournalHistory<E>,
  saved: readonly unknown[],
  same: (live: E, saved: unknown) => boolean,
): boolean {
  const count = saved.length;
  if (history.cursor < count) return false;
  for (let i = 0; i < count; i += 1) {
    if (!same(history.journal[i] as E, saved[i])) return false;
  }
  history.journal.splice(0, count);
  history.cursor -= count;
  history.revision -= count;
  history.steps = history.steps.filter((step) => step > count).map((step) => step - count);
  return true;
}
