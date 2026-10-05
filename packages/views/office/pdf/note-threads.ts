import type { PdfNoteRow, PdfNoteThread } from "./notes/types";

/** A note row as a host's file reader reports it. Structurally the browser
 * engine reader's row, declared here so views never import the engine. */
type ReadNoteRow = Omit<PdfNoteRow, "binding">;

interface ReadNoteThread {
  id: string;
  root: ReadNoteRow;
  replies: readonly ReadNoteRow[];
}

/** Map one reader row onto the views' shape. A row the reader skipped cannot be
 * acted on, so it is marked unbound; a reply is unbound only when the reader
 * skipped it, never because its root was. */
function toNoteRow(row: ReadNoteRow, unbound: ReadonlySet<string>): PdfNoteRow {
  const mapped: PdfNoteRow = {
    id: row.id,
    page: row.page,
    pageIndex: row.pageIndex,
    objNum: row.objNum,
    rect: row.rect,
    contents: row.contents,
    binding: unbound.has(row.id) ? "unbound" : "bound",
  };
  if (row.author !== undefined) mapped.author = row.author;
  if (row.resolved !== undefined) mapped.resolved = row.resolved;
  return mapped;
}

/** Turn a file reader's threads and skipped notes into the panel's threads.
 * Both hosts (web, desktop) read the same pure pdf-lib reader and share this. */
export function toNoteThreads(
  read: { threads: readonly ReadNoteThread[]; skipped: readonly { pageIndex: number; objNum: number }[] },
): PdfNoteThread[] {
  const unbound = new Set(read.skipped.map((skip) => `${skip.pageIndex}:${skip.objNum}`));
  return read.threads.map((thread) => ({
    id: thread.id,
    root: toNoteRow(thread.root, unbound),
    replies: thread.replies.map((reply) => toNoteRow(reply, unbound)),
  }));
}
