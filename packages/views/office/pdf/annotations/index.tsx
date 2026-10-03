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

function copy(t: ReturnType<typeof useTranslation>["t"], key: string, fallback: string, values?: Record<string, unknown>): string {
  return t(key, { ...values, defaultValue: fallback });
}

function identityFor(annotation: PdfSavedAnnotation): PdfSavedAnnotationIdentity | null {
  if (annotation.binding === "unbound" || !BOUND_SUBTYPES.has(annotation.kind as PdfSavedAnnotationSubtype)) return null;
  if (!Number.isSafeInteger(annotation.pageIndex) || !Number.isSafeInteger(annotation.objNum) || !annotation.rect || annotation.rect.length !== 4) return null;
  return {
    pageIndex: annotation.pageIndex!,
    objNum: annotation.objNum!,
    subtype: annotation.kind as PdfSavedAnnotationSubtype,
    rect: [...annotation.rect] as PdfAnnotationIdentityRect,
    ...(annotation.contents !== undefined ? { contents: annotation.contents } : {}),
  };
}

type PdfAnnotationIdentityRect = [number, number, number, number];

function annotationLabel(t: ReturnType<typeof useTranslation>["t"], annotation: PdfSavedAnnotation): string {
  const key = annotation.kind === "highlight" || annotation.kind === "underline" || annotation.kind === "strikeout" ? `office.pdf.markups.${annotation.kind}` : "office.pdf.annotations.kind";
  return copy(t, key, annotation.kind === "note" ? "Note" : annotation.kind === "ink" ? "Ink" : annotation.kind === "image" ? "Image" : "Annotation");
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
    <section className={cn("grid gap-2", className)} data-testid="pdf-annotations-panel" aria-label={copy(t, "office.pdf.commands.annotations", "Annotations")}>
      <h2 className="text-label font-medium">{copy(t, "office.pdf.commands.annotations", "Annotations")}</h2>
      {annotations.length === 0 ? <p className="text-caption text-muted-foreground">{copy(t, "office.pdf.markups.label", "No saved annotations.")}</p> : (
        <ul className="grid gap-1" aria-label={copy(t, "office.pdf.commands.annotations", "Annotations")}>
          {annotations.map((annotation) => {
            const identity = identityFor(annotation);
            const canDelete = identity !== null && (provider !== undefined || deleteSavedAnnot !== undefined);
            const pending = pendingId === annotation.id;
            const label = annotationLabel(t, annotation);
            return (
              <li key={annotation.id} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5" data-testid={`pdf-annotation-${annotation.id}`}>
                <div className="min-w-0">
                  <p className="truncate text-body">{label}</p>
                  <p className="text-caption text-muted-foreground">{copy(t, "office.pdf.pages.page", "Page {{page}}", { page: annotation.page })}{annotation.contents ? ` · ${annotation.contents}` : ""}</p>
                </div>
                {canDelete ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={copy(t, "office.pdf.annotations.delete", "Delete annotation")} disabled={disabled || pending} onClick={() => { if (identity) void remove(annotation, identity); }}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : <span className="shrink-0 text-caption text-muted-foreground">{copy(t, "office.pdf.annotations.readOnly", "Read-only")}</span>}
                {errorId === annotation.id ? <span role="alert" className="sr-only">{copy(t, "office.pdf.annotations.deleteError", "The annotation could not be deleted. Try again.")}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">{copy(t, "office.pdf.annotations.contentNotice", "Annotations stay separate from PDF content.")}</p>
    </section>
  );
}
