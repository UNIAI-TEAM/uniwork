"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PdfSavedAnnotation, PdfSavedAnnotationIdentity, PdfAnnotationsPanelProps, PdfSavedAnnotationSubtype } from "./types";

export { createPdfAnnotationOperationProvider } from "./provider";
export type { PdfAnnotationOperationProvider, PdfAnnotationOperationSubmitter, PdfDeleteSavedAnnot, PdfDeleteSavedAnnotOperation, PdfSavedAnnotation, PdfSavedAnnotationIdentity, PdfSavedAnnotationSubtype, PdfAnnotationsPanelProps } from "./types";

const BOUND_SUBTYPES = new Set<PdfSavedAnnotationSubtype>(["highlight", "underline", "strikeout", "note"]);

type Translate = ReturnType<typeof useTranslation>["t"];

/** One label key per representable kind; any other kind falls back to the
    generic annotation label. */
const KIND_LABEL_KEYS: Record<string, string> = {
  highlight: "office.pdf.markups.highlight",
  underline: "office.pdf.markups.underline",
  strikeout: "office.pdf.markups.strikeout",
  note: "office.pdf.annotations.kind.note",
  ink: "office.pdf.annotations.kind.ink",
  image: "office.pdf.annotations.kind.image",
};

function identityFor(annotation: PdfSavedAnnotation): PdfSavedAnnotationIdentity | null {
  const { pageIndex, objNum, rect } = annotation;
  if (annotation.binding === "unbound" || !BOUND_SUBTYPES.has(annotation.kind as PdfSavedAnnotationSubtype)) return null;
  if (typeof pageIndex !== "number" || typeof objNum !== "number") return null;
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || !Number.isSafeInteger(objNum) || objNum < 0) return null;
  if (!rect || rect.length !== 4) return null;
  return {
    pageIndex,
    objNum,
    subtype: annotation.kind as PdfSavedAnnotationSubtype,
    rect: [...rect],
    ...(annotation.contents !== undefined ? { contents: annotation.contents } : {}),
  };
}

function annotationLabel(t: Translate, annotation: PdfSavedAnnotation): string {
  return t(KIND_LABEL_KEYS[annotation.kind] ?? "office.pdf.annotations.kind.unknown");
}

/**
 * Lists saved PDF annotations and only exposes deletion where the host can
 * provide the full guarded identity. Unbound kinds remain visible as rows so
 * users are not misled into thinking they were dropped or rewritten.
 */
export function PdfAnnotationsPanel({ annotations, deleteSavedAnnot, provider, disabled = false, className }: PdfAnnotationsPanelProps) {
  const { t } = useTranslation();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  const remove = async (annotation: PdfSavedAnnotation, identity: PdfSavedAnnotationIdentity) => {
    if (disabled || pendingId !== null) return;
    setPendingId(annotation.id);
    setErrorId(null);
    try {
      if (provider) await provider.deleteSavedAnnot(identity);
      else if (deleteSavedAnnot) await deleteSavedAnnot(identity);
    } catch {
      setErrorId(annotation.id);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className={cn("grid gap-2", className)} data-testid="pdf-annotations-panel" aria-label={t("office.pdf.commands.annotations")}>
      <h2 className="text-label font-medium">{t("office.pdf.commands.annotations")}</h2>
      {annotations.length === 0 ? <p className="text-caption text-muted-foreground">{t("office.pdf.annotations.empty")}</p> : (
        <ul className="grid gap-1" aria-label={t("office.pdf.commands.annotations")}>
          {annotations.map((annotation) => {
            const identity = identityFor(annotation);
            const canDelete = identity !== null && (provider !== undefined || deleteSavedAnnot !== undefined);
            const label = annotationLabel(t, annotation);
            return (
              <li key={annotation.id} className="grid gap-1 rounded-md border border-border px-2 py-1.5" data-testid={`pdf-annotation-${annotation.id}`}>
                <div className="flex min-h-11 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-body">{label}</p>
                    <p className="text-caption text-muted-foreground">{t("office.pdf.pages.page", { page: annotation.page })}{annotation.contents ? ` · ${annotation.contents}` : ""}</p>
                  </div>
                  {canDelete ? (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("office.pdf.annotations.delete", { kind: label, page: annotation.page })} disabled={disabled || pendingId !== null} onClick={() => { if (identity) void remove(annotation, identity); }}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : <span className="shrink-0 text-caption text-muted-foreground">{t("office.pdf.annotations.readOnly")}</span>}
                </div>
                {errorId === annotation.id ? <p role="alert" className="text-caption text-destructive">{t("office.pdf.annotations.deleteError")}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">{t("office.pdf.annotations.contentNotice")}</p>
    </section>
  );
}
