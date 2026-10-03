"use client";

// B7 (UNI-924): Insert ▸ Table of contents. Insert opens the depth dialog,
// Update regenerates the existing TOC's entries (disabled until one exists).
// The notice is inline status text — a role="status" line that survives on
// both hosts, no toast provider assumed.
import { ListTree, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxTocDialog } from "./toc-dialog";
import type { DocxTocFieldOptions } from "./toc-model";

type TocMode = "insert" | "update";

function noticeKey(outcome: string): string {
  switch (outcome) {
    case "inserted":
      return "office.docx.toc.notice.inserted";
    case "updated":
      return "office.docx.toc.notice.updated";
    case "empty":
      return "office.docx.toc.notice.empty";
    case "missing":
      return "office.docx.toc.notice.missing";
    case "read_only":
      return "office.docx.toc.notice.readOnly";
    default:
      return "office.docx.toc.notice.refused";
  }
}

export function TocGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TocMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const blocked = readOnly || saving || !commands;
  const hasToc = format?.docxTocPresent === true;

  const apply = (options: DocxTocFieldOptions) => {
    if (commands) {
      const result = mode === "update" ? commands.updateDocxToc(options) : commands.insertDocxToc(options);
      const key = noticeKey(result.outcome);
      setNotice(
        result.outcome === "inserted" || result.outcome === "updated"
          ? t(key, { count: result.entries })
          : t(key),
      );
    }
    setMode(null);
  };

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.toc.open")}
        aria-haspopup="dialog"
        disabled={blocked}
        data-testid="docx-toc-insert"
        onClick={() => {
          setNotice(null);
          setMode("insert");
        }}
      >
        <ListTree aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.toc.update")}
        aria-haspopup="dialog"
        disabled={blocked || !hasToc}
        title={hasToc ? undefined : t("office.docx.toc.updateHint")}
        data-testid="docx-toc-update"
        onClick={() => {
          setNotice(null);
          setMode("update");
        }}
      >
        <RefreshCw aria-hidden />
      </Button>
      {notice ? (
        <span role="status" data-testid="docx-toc-notice" className="text-caption text-muted-foreground">
          {notice}
        </span>
      ) : null}
      {mode ? (
        <DocxTocDialog
          open
          mode={mode}
          onOpenChange={(next) => {
            if (!next) setMode(null);
          }}
          headingCount={(maxLevel) => commands?.readDocxTocHeadings(maxLevel).length ?? 0}
          onApply={apply}
        />
      ) : null}
    </>
  );
}
