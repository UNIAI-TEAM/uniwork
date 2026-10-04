"use client";

// B7 (UNI-924): Insert ▸ Captions and citations. The caption dialog writes a
// SEQ field paragraph; the citation dialog writes a bracketed reference text
// (see citation-dialog.tsx for why no CITATION field is authored).
import { Captions, Quote } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxCaptionDialog } from "./caption-dialog";
import { DocxCitationDialog } from "./citation-dialog";

type CaptionMode = "caption" | "citation";

export function CaptionGroup({ commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CaptionMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const blocked = readOnly || saving || !commands;

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.captions.insert")}
        aria-haspopup="dialog"
        disabled={blocked}
        data-testid="docx-caption-insert"
        onClick={() => {
          setNotice(null);
          setMode("caption");
        }}
      >
        <Captions aria-hidden />
      </Button>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.captions.citation")}
        aria-haspopup="dialog"
        disabled={blocked}
        data-testid="docx-citation-insert"
        onClick={() => {
          setNotice(null);
          setMode("citation");
        }}
      >
        <Quote aria-hidden />
      </Button>
      {notice ? (
        <span role="status" data-testid="docx-caption-notice" className="text-caption text-muted-foreground">
          {notice}
        </span>
      ) : null}
      {mode === "caption" ? (
        <DocxCaptionDialog
          open
          onOpenChange={(next) => {
            if (!next) setMode(null);
          }}
          onInsert={(label, text) => {
            const written = commands?.insertDocxCaption(label, text) ?? false;
            setNotice(t(written ? "office.docx.captions.notice.inserted" : "office.docx.captions.notice.refused"));
            setMode(null);
          }}
        />
      ) : null}
      {mode === "citation" ? (
        <DocxCitationDialog
          open
          onOpenChange={(next) => {
            if (!next) setMode(null);
          }}
          onInsert={(author, year) => {
            const written = commands?.insertDocxCitation(author, year) ?? false;
            setNotice(t(written ? "office.docx.captions.notice.cited" : "office.docx.captions.notice.refused"));
            setMode(null);
          }}
        />
      ) : null}
    </>
  );
}
