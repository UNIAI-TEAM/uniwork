"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { useCopyDocument } from "@uniwork/core/documents/hooks-copies";
import type { Document } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

export interface DocumentCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: Document;
  /** Called with the new document after a verified copy. */
  onCopied?: (copy: Document) => void;
  /**
   * The route is not on this deployment (404/501): the caller hides the action
   * for the rest of the session instead of offering a button that cannot work.
   */
  onUnavailable?: () => void;
}

/**
 * File-document copy with explicit consent (G2-07a surface; C-01 §14.4; G1-08,
 * UNI-682). The copy keeps the source's ACL snapshot and provenance: it never
 * widens access and never re-uploads the bytes. Consent is a real control, not
 * copy: the button stays disabled until the user checks the acknowledgement,
 * and the request still carries `consent: "copy"` because the server refuses
 * anything else by name (409 copy_consent_required).
 *
 * The endpoint lands with G2-07a; until it is on this deployment the route
 * answers 404/501 and this dialog reports that upward so the action is hidden.
 */
export function DocumentCopyDialog({
  open,
  onOpenChange,
  wsId,
  doc,
  onCopied,
  onUnavailable,
}: DocumentCopyDialogProps) {
  const { t } = useTranslation();
  const copy = useCopyDocument(wsId);
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setConsent(false);
      setError(null);
      keyRef.current = null;
    }
  }, [open]);

  const submit = async () => {
    if (copy.isPending || !consent) return;
    setError(null);
    keyRef.current ??= createSafeId();
    try {
      const created = await copy.mutateAsync({
        documentId: doc.id,
        consent: "copy",
        title: title.trim() || undefined,
        idempotencyKey: keyRef.current,
      });
      keyRef.current = null;
      toast.success(t("documents.copy.done", { title: created.title }));
      onOpenChange(false);
      onCopied?.(created);
    } catch (err) {
      const cls = classifyDocumentError(err);
      if (cls.cls === "missing" || cls.code === "unsupported_operation" || cls.code === "storage_unavailable") {
        setError(t("documents.copy.unavailable"));
        onUnavailable?.();
      } else if (cls.code === "copy_consent_required") {
        setError(t("documents.copy.consent_required"));
      } else if (cls.code === "owner_requires_copy") {
        setError(t("documents.copy.owner_requires_copy"));
      } else if (cls.code === "page_copy_not_supported") {
        setError(t("documents.copy.page_not_supported"));
      } else {
        setError(apiErrorMessage(err) ?? t("documents.copy.failed"));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !copy.isPending ? onOpenChange(false) : undefined)}>
      <DialogContent className="sm:max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("documents.copy.title")}</DialogTitle>
          <DialogDescription>{t("documents.copy.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-copy-title">{t("documents.copy.title_label")}</Label>
            <Input
              id="document-copy-title"
              value={title}
              maxLength={500}
              disabled={copy.isPending}
              placeholder={t("documents.copy.title_placeholder", { title: doc.title })}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex items-start gap-2 text-body text-foreground">
            <Checkbox
              checked={consent}
              disabled={copy.isPending}
              onCheckedChange={(next) => setConsent(next === true)}
              aria-label={t("documents.copy.consent_label")}
            />
            <div className="min-w-0">
              <p className="font-medium">{t("documents.copy.consent_label")}</p>
              <p className="text-caption text-muted-foreground">{t("documents.copy.consent_hint")}</p>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={copy.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!consent || copy.isPending}
            aria-busy={copy.isPending || undefined}
            onClick={() => void submit()}
          >
            {copy.isPending ? (
              <>
                <Spinner aria-hidden role="presentation" />
                {t("documents.copy.submitting")}
              </>
            ) : (
              <>
                <Copy aria-hidden className="size-3.5" />
                {t("documents.copy.submit")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
