// Edit-lock copy and the "Download my copy" file (UNI-1645, addendum §9, §11.4).

/** The lost-lock sentence for an `edit_lock_lost` reason; an unknown or missing one reads generic. */
const LOST_KEYS: Record<string, string> = {
  taken_over: "documents.editLock.lostTakenOver",
  handed_over: "documents.editLock.lostHandedOver",
  moved_here: "documents.editLock.lostMovedHere",
  expired: "documents.editLock.lostExpired",
  access_lost: "documents.editLock.lostAccessLost",
};

export function lostCopyKey(reason: string | null | undefined): string {
  return (reason && LOST_KEYS[reason]) || "documents.editLock.lostGeneric";
}

/**
 * A lock time in the reader's clock: today by its time alone, any other day
 * with the date too. An unreadable value reads empty rather than "Invalid Date".
 */
export function formatLockTime(iso: string | null | undefined, locale: string, now = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" }).format(at);
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Characters no file system accepts in a name; the title keeps everything else. */
const unsafeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The page's unsaved bytes as a file (addendum §9 FE-4): the editor's live
 * HTML in a minimal document, named `{title} (my copy).html`, downloaded the
 * way the file actions download (an `<a download>` over an object URL).
 * Returns the file name it used.
 */
export function downloadPageCopy(html: string, title: string, copyName: string): string {
  const fileName = `${unsafeName(copyName) || "document"}.html`;
  const body = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>\n${html}\n</body></html>\n`;
  const url = URL.createObjectURL(new Blob([body], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
