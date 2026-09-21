"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";

/*
 * One dialog anatomy for every chat flow — create a group, write a poll,
 * rename a room: a bordered header (title, one line of why), a body that
 * scrolls on its own, and a footer with Cancel then the primary action on
 * the right. Two widths: md for a single field or a picker, lg for a form
 * with several sections.
 */

const WIDTH = { md: "sm:max-w-md", lg: "sm:max-w-lg" } as const;

export function ChatDialogContent({
  size = "md",
  className,
  children,
}: {
  size?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DialogContent className={cn("gap-0 overflow-hidden p-0", WIDTH[size], className)} showCloseButton>
      {children}
    </DialogContent>
  );
}

export function ChatDialogHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <DialogHeader className="gap-1 border-b border-border py-3.5 pr-12 pl-5">
      <DialogTitle className="text-title-sm font-semibold text-balance">{title}</DialogTitle>
      {description ? <DialogDescription className="text-pretty">{description}</DialogDescription> : null}
    </DialogHeader>
  );
}

export function ChatDialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("max-h-[min(70vh,40rem)] space-y-4 overflow-y-auto px-5 py-4", className)}>{children}</div>;
}

/**
 * Cancel, then the primary action. While the action runs its label becomes
 * the "…ing" form and both buttons hold still, so a second click cannot
 * send twice.
 */
export function ChatDialogFooter({
  onCancel,
  cancelLabel,
  submitLabel,
  submittingLabel,
  submitting = false,
  submitDisabled = false,
  onSubmit,
  submitType = "button",
  form,
  destructive = false,
  leading,
}: {
  onCancel: () => void;
  cancelLabel?: string;
  submitLabel: string;
  submittingLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  onSubmit?: () => void;
  submitType?: "button" | "submit";
  /** Id of the form the primary button submits, when the footer sits outside it. */
  form?: string;
  destructive?: boolean;
  /** Left-aligned content: a hint about why the action is not ready yet. */
  leading?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <DialogFooter className="items-center px-5 py-3">
      {leading ? <div className="mr-auto min-w-0 text-caption text-muted-foreground">{leading}</div> : null}
      <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
        {cancelLabel ?? t("common.cancel")}
      </Button>
      <Button
        type={submitType}
        form={form}
        variant={destructive ? "destructive" : "default"}
        disabled={submitDisabled || submitting}
        aria-busy={submitting || undefined}
        onClick={onSubmit}
      >
        {submitting && submittingLabel ? submittingLabel : submitLabel}
      </Button>
    </DialogFooter>
  );
}

/**
 * The one confirmation every destructive chat action goes through — remove
 * a member, archive a channel, delete a follow-up. Never window.confirm.
 */
export function ChatConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
