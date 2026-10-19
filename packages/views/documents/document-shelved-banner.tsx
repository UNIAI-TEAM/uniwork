"use client";

import { useRef } from "react";
import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useUnshelveDocument } from "@uniwork/core/documents/hooks-collections";
import { canManageTrashed, type Document } from "@uniwork/core/types/document";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";
import { documentErrorMessage } from "./document-error-message";

/** "Archived" beside a shelved document's title (ARCHIVE-01 U-7); the words live only in i18n. */
export function DocumentShelvedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={className}>
      <Archive aria-hidden data-icon="inline-start" />
      {t("documents.shelved_doc.label")}
    </Badge>
  );
}

/**
 * The read-only banner of a shelved document page or Office frame (U-7, U-8).
 * A manager (the same rule as the trash: `my_level` manage or admin_scope)
 * also gets Unarchive; it waits for the server and one click is one request.
 */
export function DocumentShelvedBanner({
  wsId,
  doc,
  className,
}: {
  wsId: string;
  doc: Pick<Document, "id" | "title" | "my_level" | "admin_scope">;
  className?: string;
}) {
  const { t } = useTranslation();
  const unshelve = useUnshelveDocument(wsId);
  // The query client reports `isPending` a tick late, so a double click is stopped by a ref.
  const inFlight = useRef(false);
  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // mutateAsync, not mutate's callbacks: the banner unmounts the moment the document is unarchived,
      // and a callback of an unmounted observer would never show the toast.
      const res = await unshelve.mutateAsync(doc.id);
      toast.success(t("documents.shelved_doc.unshelved", { title: res.document.title || doc.title }));
    } catch (error) {
      toast.error(documentErrorMessage(error, t, "documents.shelved_doc.unshelve_failed"));
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <Notice
      tone="info"
      icon={Archive}
      className={className}
      action={
        canManageTrashed(doc) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={unshelve.isPending || undefined}
            aria-busy={unshelve.isPending || undefined}
            onClick={() => void run()}
          >
            {t("documents.shelved_doc.unshelve")}
          </Button>
        ) : undefined
      }
    >
      {t("documents.shelved_doc.banner")}
    </Notice>
  );
}
