// The files of unsent messages (audit R1): a picked photo, document or a
// recorded voice clip lives in a cache directory the OS may empty, so before
// the message is queued its file is copied to documentDirectory/outbox/
// <clientMsgId>/ and the queued entry points there. The copy is deleted once
// the server acknowledged the message, when the person discards it, and
// every one of them on sign-out. A copy that fails keeps the picker's file:
// the send still goes, it just may not survive the OS clearing its cache.
// The stored URI is absolute and iOS may move the app's container on an
// update, so a delivery finds the copy again from the entry's id and file
// name (`resolve`), and a file that is gone is reported as such instead of
// failing every upload as a network error.
import { Directory, File, Paths } from "expo-file-system";
import type { PendingFile } from "@/lib/send-pipeline";
import { createLogger } from "./logger";

export interface OutboxFiles {
  /** The outbox copy of `file`, for the entry `clientMsgId`. */
  keep(clientMsgId: string, file: PendingFile): Promise<PendingFile>;
  /**
   * The file to upload for the entry: its outbox copy where the app's
   * documents directory is now, else the stored file if it is still there,
   * else null (the OS purged it). A check that cannot run answers `file`.
   */
  resolve(clientMsgId: string, file: PendingFile): PendingFile | null;
  /** Drops the entry's copy, if any. */
  release(clientMsgId: string): void;
  /** Drops every copy (sign-out). */
  releaseAll(): void;
}

const log = createLogger("outbox-files");

const outboxRoot = () => new Directory(Paths.document, "outbox");

/** A file name the directory can hold: no separators, never empty. */
export function outboxFileName(name: string): string {
  const safe = name.replace(/[/\\\0]/g, "_").replace(/^\.+/, "").trim();
  return safe || "file";
}

function drop(directory: Directory, what: string): void {
  try {
    if (directory.exists) directory.delete();
  } catch (error) {
    log.warn("outbox copy not deleted", { what, error: error instanceof Error ? error.name : typeof error });
  }
}

export const outboxFiles: OutboxFiles = {
  async keep(clientMsgId, file) {
    try {
      const directory = new Directory(outboxRoot(), clientMsgId);
      directory.create({ intermediates: true, idempotent: true });
      const target = new File(directory, outboxFileName(file.name));
      await new File(file.uri).copy(target, { overwrite: true });
      return { ...file, uri: target.uri };
    } catch (error) {
      log.warn("outbox copy failed, sending from the picked file", { error: error instanceof Error ? error.name : typeof error });
      return file;
    }
  },
  resolve(clientMsgId, file) {
    try {
      const copy = new File(new Directory(outboxRoot(), clientMsgId), outboxFileName(file.name));
      if (copy.exists) return { ...file, uri: copy.uri };
      if (new File(file.uri).exists) return file;
      log.warn("outbox file gone");
      return null;
    } catch (error) {
      log.warn("outbox file not checked", { error: error instanceof Error ? error.name : typeof error });
      return file;
    }
  },
  release(clientMsgId) {
    drop(new Directory(outboxRoot(), clientMsgId), "entry");
  },
  releaseAll() {
    drop(outboxRoot(), "all");
  },
};
