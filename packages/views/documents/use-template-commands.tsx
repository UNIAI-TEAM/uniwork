"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMarkDocumentTemplate, useUnmarkDocumentTemplate } from "@uniwork/core/documents/hooks-templates";
import { DocumentTemplateWidenDialog } from "./document-template-widen-dialog";
import type { DocumentSummaryRow } from "./library-rows";

type TemplateTarget = Pick<DocumentSummaryRow, "id" | "title" | "visibility">;

export interface TemplateCommands {
  /** Đánh dấu là mẫu: a restricted document asks first, any other is marked at once. */
  onMarkTemplate: (doc: TemplateTarget) => void;
  /** Bỏ khỏi Mẫu: the document stays where it is. */
  onUnmarkTemplate: (doc: TemplateTarget) => void;
  isBusy: (documentId: string) => boolean;
  /** The widen confirmation, rendered beside the other row dialogs. */
  dialog: ReactNode;
}

/**
 * The template mark commands of a row. Both await the server and then toast:
 * no optimistic update (State Rules). One click, one request per document.
 */
export function useTemplateCommands(wsId: string): TemplateCommands {
  const { t } = useTranslation();
  const mark = useMarkDocumentTemplate(wsId);
  const unmark = useUnmarkDocumentTemplate(wsId);
  const [widening, setWidening] = useState<TemplateTarget | null>(null);
  const busyRef = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const track = (id: string, on: boolean) => {
    if (on) busyRef.current.add(id);
    else busyRef.current.delete(id);
    setBusy(new Set(busyRef.current));
  };

  const run = (doc: TemplateTarget, send: () => Promise<unknown>, okKey: string, failKey: string) => {
    if (busyRef.current.has(doc.id)) return;
    track(doc.id, true);
    const title = doc.title || t("documents.detail.untitled");
    void send()
      .then(
        () => toast.success(t(okKey, { title })),
        () => toast.error(t(failKey)),
      )
      .finally(() => track(doc.id, false));
  };

  const onMarkTemplate = (doc: TemplateTarget) => {
    if (doc.visibility === "restricted") {
      setWidening(doc);
      return;
    }
    run(doc, () => mark.mutateAsync({ documentId: doc.id }), "documents.templates.marked", "documents.templates.mark_failed");
  };
  const onUnmarkTemplate = (doc: TemplateTarget) =>
    run(doc, () => unmark.mutateAsync(doc.id), "documents.templates.unmarked", "documents.templates.unmark_failed");

  return {
    onMarkTemplate,
    onUnmarkTemplate,
    isBusy: (documentId) => busy.has(documentId),
    dialog: widening ? (
      <DocumentTemplateWidenDialog
        open
        onOpenChange={(next) => {
          if (!next) setWidening(null);
        }}
        wsId={wsId}
        doc={widening}
      />
    ) : null,
  };
}
