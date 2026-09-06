"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Textarea } from "@uniwork/ui/components/ui/textarea";

/** The server's floor (sdi.ReasonSDI minLength); the dialog mirrors it so the 400 never happens. */
export const REASON_MIN = 10;

interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra fields above the reason (a plan picker, a scope). */
  children?: ReactNode;
  /** Blocks submit beyond the reason length, e.g. no plan picked yet. */
  submitDisabled?: boolean;
  pending?: boolean;
  destructive?: boolean;
  onSubmit: (reason: string) => void;
}

/**
 * Every admin write goes through here: the reason is what the admin_actions
 * row and the audit trail keep, so the dialog refuses to submit under ten
 * characters rather than letting the server say no.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  submitDisabled,
  pending,
  destructive,
  onSubmit,
}: ReasonDialogProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.reason" });
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const tooShort = trimmed.length < REASON_MIN;

  const handleOpenChange = (next: boolean) => {
    if (!next) setReason("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (tooShort || submitDisabled || pending) return;
            onSubmit(trimmed);
          }}
        >
          {children}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-reason">{t("label")}</Label>
            <Textarea
              id="admin-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("placeholder")}
              rows={3}
              aria-describedby="admin-reason-hint"
              aria-invalid={reason.length > 0 && tooShort ? true : undefined}
            />
            <p id="admin-reason-hint" className="text-caption text-muted-foreground">
              {t("hint", { min: REASON_MIN })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={tooShort || submitDisabled || pending}
              aria-busy={pending}
            >
              {pending ? <Spinner aria-hidden aria-label={undefined} role="presentation" /> : null}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
