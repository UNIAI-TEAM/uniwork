"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { downloadAskAttachment } from "@uniwork/core/api/endpoints/ai-attachments";
import type { AiAttachment, AiFileNote } from "@uniwork/core/types";
import { AskUniAttachmentChip } from "./ask-uni-attachment-chip";

/** Hand a fetched file to the browser to save. */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next task: Safari reads the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The files a question carried, as a row of chips under its bubble. With `wsId` a chip downloads its file under the
 * file's own name; without it (a live or optimistic question, whose ids are still upload ids) the chips are plain labels.
 */
export function AskUniQuestionFiles({ files, wsId }: { files: AiAttachment[]; wsId?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.attachments" });
  const busy = useRef(new Set<string>());
  if (files.length === 0) return null;
  const open = (file: AiAttachment) => {
    if (!wsId || busy.current.has(file.id)) return;
    busy.current.add(file.id);
    downloadAskAttachment(wsId, file.id)
      .then((blob) => saveFile(blob, file.name || "file"))
      .catch(() => toast.error(t("download_failed", { name: file.name })))
      .finally(() => busy.current.delete(file.id));
  };
  return (
    <ul className="flex max-w-[94%] flex-wrap justify-end gap-1.5">
      {files.map((file) => (
        <li key={file.id} className="max-w-full">
          <AskUniAttachmentChip
            name={file.name}
            size={file.size}
            mime={file.mime}
            status="ready"
            onOpen={wsId ? () => open(file) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}

const UNITS = new Set(["page", "slide", "row", "paragraph", "line"]);

/**
 * The note's copy: rows as a count (each sheet of a workbook gives its first rows, not one leading range), other units
 * as the range read from the start, which for one unit is that unit alone.
 */
function noteKey(n: AiFileNote): string {
  if (n.unit === "row") return "read_note_row";
  return n.read === 1 ? `read_note_${n.unit}_first` : `read_note_${n.unit}`;
}

/**
 * One line per file UNI read only in part. A unit the client does not know, or a count that makes no sense, says only
 * that the start was read, rather than a raw key or a made-up count.
 */
export function AskUniFileNotes({ notes }: { notes: AiFileNote[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.attachments" });
  return (
    <>
      {notes.map((n, i) => (
        <p key={`${i}-${n.name}`} className="mt-2 break-words text-caption text-muted-foreground">
          {UNITS.has(n.unit) && n.read > 0 && n.total > 0
            ? t(noteKey(n), { read: n.read, total: n.total, name: n.name })
            : t("read_note_partial", { name: n.name })}
        </p>
      ))}
    </>
  );
}
