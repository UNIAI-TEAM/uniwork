"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMarkDocumentTemplate } from "@uniwork/core/documents/hooks-templates";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

export interface DocumentTemplateWidenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: { id: string; title?: string };
}

/**
 * Confirmation before a restricted document becomes a template: the template
 * is visible to every member of the workspace, so the server widens the
 * document to workspace/edit with the mark. Nothing is sent until the person
 * confirms; the command awaits the server and a failure keeps the dialog.
 */
export function DocumentTemplateWidenDialog({ open, onOpenChange, wsId, doc }: DocumentTemplateWidenDialogProps) {
  const { t } = useTranslation();
  const mark = useMarkDocumentTemplate(wsId);
  const [error, setError] = useState<string | null>(null);
  // Answers a second click that lands before React re-renders the disabled button.
  const sendingRef = useRef(false);
  const pending = mark.isPending;
  const title = doc.title || t("documents.detail.untitled");

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const confirm = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    try {
      await mark.mutateAsync({ documentId: doc.id, widenToWorkspace: true });
      toast.success(t("documents.templates.marked", { title }));
      onOpenChange(false);
    } catch {
      setError(t("documents.templates.mark_failed"));
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !pending ? onOpenChange(false) : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("documents.templates.widen.title")}</AlertDialogTitle>
          <AlertDialogDescription className="text-body text-muted-foreground">
            {t("documents.templates.widen.body", { title })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <Button type="button" variant="default" disabled={pending} aria-busy={pending || undefined} onClick={() => void confirm()}>
            {pending ? <Spinner aria-hidden role="presentation" /> : <LayoutTemplate aria-hidden className="size-3.5" />}
            {t("documents.templates.widen.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
