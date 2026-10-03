"use client";

// C2 (UNI-924): Review ▸ Compare — pick a .docx from disk and read a
// read-only diff against the open document. The current side comes from the
// live editor (through the command runtime's text reader), the other side is
// parsed off-session from the picked file; neither the open document nor the
// save path is touched, and the result is never applied anywhere.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { DocxCompareResult } from "./compare-result";
import { compareTextBlocks, type CompareEntry } from "./diff";
import { readCompareFile, type CompareReadFailure, type CompareReadResult } from "./read-compare";

export interface DocxCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live document text blocks, read when the comparison builds its result —
   * after the picked file finishes parsing. The live document is only read —
   * never edited, saved or replaced. */
  currentTexts: () => string[];
  /** Read seam. Production reads and parses the picked file; tests inject a
   * fake so the dialog's states are exercised without real bytes. */
  readFile?: (file: File) => Promise<CompareReadResult>;
}

/** Parse refusals are named by the seam; an unexpected throw anywhere in the
 * read/build path maps to the generic "failed". */
type CompareFailure = CompareReadFailure | "failed";

type ComparePhase =
  | { phase: "idle" }
  | { phase: "reading"; fileName: string }
  | { phase: "result"; fileName: string; entries: CompareEntry[] }
  | { phase: "failed"; fileName: string; reason: CompareFailure };

export function DocxCompareDialog({ open, onOpenChange, currentTexts, readFile = readCompareFile }: DocxCompareDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [state, setState] = useState<ComparePhase>({ phase: "idle" });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const request = ++requestRef.current;
    setState({ phase: "reading", fileName: file.name });
    try {
      const result = await readFile(file);
      // A newer pick (or a dialog unmounted mid-read) must not overwrite the
      // newer state with a stale result.
      if (requestRef.current !== request) return;
      if (!result.ok) {
        setState({ phase: "failed", fileName: file.name, reason: result.reason });
        return;
      }
      setState({ phase: "result", fileName: file.name, entries: compareTextBlocks(currentTexts(), result.texts) });
    } catch {
      // Never leave the dialog spinning: an unexpected throw is a failure the
      // user can retry, not an unhandled rejection.
      if (requestRef.current !== request) return;
      setState({ phase: "failed", fileName: file.name, reason: "failed" });
    }
  };

  const pickLabel = state.phase === "result" || state.phase === "failed" ? t("office.docx.compare.pickAnother") : t("office.docx.compare.pick");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("office.docx.compare.close")} className="max-h-[85dvh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("office.docx.compare.title")}</DialogTitle>
          <DialogDescription>{t("office.docx.compare.description")}</DialogDescription>
        </DialogHeader>
        <p className="text-caption text-muted-foreground">{t("office.docx.compare.limit")}</p>
        {state.phase === "reading" ? (
          <p role="status" data-testid="docx-compare-reading" className="flex items-center gap-2 text-body text-muted-foreground">
            <Spinner />
            {t("office.docx.compare.reading", { name: state.fileName })}
          </p>
        ) : null}
        {state.phase === "failed" ? (
          <p role="alert" data-testid="docx-compare-error" className="rounded-md bg-destructive-soft px-2 py-1 text-body text-destructive-soft-foreground">
            {t(`office.docx.compare.errors.${state.reason}`)}
          </p>
        ) : null}
        {state.phase === "result" ? <DocxCompareResult fileName={state.fileName} entries={state.entries} /> : null}
        <DialogFooter className="sm:justify-between">
          <input
            ref={inputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={(event) => {
              void pick(event.target.files?.[0]);
              event.target.value = "";
            }}
            data-testid="docx-compare-file-input"
          />
          <Button type="button" variant="outline" disabled={state.phase === "reading"} onClick={() => inputRef.current?.click()} data-testid="docx-compare-pick">
            {pickLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="docx-compare-close">
            {t("office.docx.compare.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
