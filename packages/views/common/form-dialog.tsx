"use client";

import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
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
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";

/*
 * One dialog anatomy for every form flow (chat, meetings, …) — create a
 * group, schedule a meeting, rename a room: a bordered header (title, one line of why), a body that
 * scrolls on its own, and a footer with Cancel then the primary action on
 * the right. Two widths: md for a single field or a picker, lg for a form
 * with several sections.
 */

const WIDTH = { md: "sm:max-w-md", lg: "sm:max-w-lg" } as const;

/** The scrim of a dialog that must own the screen (dialog.tsx, overlayClassName). */
const HEAVY_SCRIM = "bg-black/45";

export function FormDialogContent({
  size = "md",
  className,
  children,
  initialFocus,
  finalFocus,
  showCloseButton = true,
  destructive = false,
}: {
  size?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
  /** Where focus lands on open; the default is the first tabbable element. */
  initialFocus?: ComponentProps<typeof DialogContent>["initialFocus"];
  /** Where focus lands on close; the default is the opener. */
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
  /** False while an action that must not be abandoned is in flight. */
  showCloseButton?: boolean;
  /**
   * The dialog asks for an irreversible step (close an organization, delete a
   * space): the page behind dims harder, so the question is the only thing in
   * view, instead of the light scrim of a form the user can glance past.
   */
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DialogContent
      // Never taller than the screen less a 1rem margin: the body (inside a form or not) shrinks and scrolls instead.
      className={cn(
        "flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 [&>form]:flex [&>form]:min-h-0 [&>form]:flex-col",
        WIDTH[size],
        className,
      )}
      initialFocus={initialFocus}
      finalFocus={finalFocus}
      showCloseButton={showCloseButton}
      closeLabel={t("common.close")}
      overlayClassName={destructive ? HEAVY_SCRIM : undefined}
    >
      {children}
    </DialogContent>
  );
}

export function FormDialogHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <DialogHeader className="gap-1 border-b border-border py-3.5 pr-12 pl-5">
      <DialogTitle className="text-title-sm font-semibold text-balance">{title}</DialogTitle>
      {description ? <DialogDescription className="text-pretty">{description}</DialogDescription> : null}
    </DialogHeader>
  );
}

export function FormDialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("max-h-[min(70vh,40rem)] space-y-4 overflow-y-auto px-5 py-4", className)}>{children}</div>;
}

/**
 * Cancel, then the primary action. While the action runs its label becomes
 * the "…ing" form, a spinner shows, and both buttons hold still, so a second
 * click cannot send twice. Without a submitLabel the footer is Cancel alone: a
 * step whose choices act on their own (pick a method, sign in in a popup).
 *
 * "Hold still" is `aria-disabled`, never `disabled`: a disabled button leaves
 * the tab order, so the focus on the button just pressed falls to <body> and a
 * keyboard user cannot reach a not-ready submit to hear why. The Button
 * primitive blocks the press (and the form submission) itself.
 */
export function FormDialogFooter({
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
  reasonId,
  cancelVariant = "outline",
}: {
  onCancel: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  submittingLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  onSubmit?: () => void;
  submitType?: "button" | "submit";
  /** Id of the form the primary button submits, when the footer sits outside it. */
  form?: string;
  destructive?: boolean;
  /** Left-aligned content (a hint about why the action is not ready yet, a Back button); below sm it stacks under Cancel. */
  leading?: ReactNode;
  /**
   * Id of the element (usually inside `leading`) that says why the submit is
   * not ready. While `submitDisabled` holds, the submit is described by it, so
   * a screen reader hears the reason on the button that cannot be pressed.
   */
  reasonId?: string;
  /** A module's own Cancel look (chat's grey pill is "secondary"). */
  cancelVariant?: ComponentProps<typeof Button>["variant"];
}) {
  const { t } = useTranslation();
  const inert = submitDisabled || submitting;
  return (
    // Below sm the footer stacks: actions take the full width, the size a
    // thumb aims for; from sm up they sit side by side at their own width.
    <DialogFooter className="items-stretch px-5 py-3 sm:items-center">
      {leading ? <div className="min-w-0 text-caption text-muted-foreground sm:mr-auto">{leading}</div> : null}
      <Button type="button" variant={cancelVariant} aria-disabled={submitting || undefined} onClick={onCancel}>
        {cancelLabel ?? t("common.cancel")}
      </Button>
      {submitLabel ? (
        <Button
          type={submitType}
          form={form}
          variant={destructive ? "destructive" : "default"}
          aria-disabled={inert || undefined}
          aria-busy={submitting || undefined}
          aria-describedby={submitDisabled && reasonId ? reasonId : undefined}
          onClick={onSubmit}
        >
          {/* Decorative: aria-busy carries the state for assistive tech. */}
          {submitting ? <Spinner data-icon="inline-start" /> : null}
          {submitting && submittingLabel ? submittingLabel : submitLabel}
        </Button>
      ) : null}
    </DialogFooter>
  );
}

/**
 * The one confirmation every consequential action goes through — remove a
 * member, end a meeting, revoke a link. Never window.confirm. The caller
 * closes it once the action settles, so `pending` shows while it runs.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  pending = false,
  destructive = true,
  nested = false,
  icon,
  tone = destructive ? "destructive" : "info",
  solid = false,
  cancelVariant,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  /** When the action itself is a "cancel" (a subscription), dismissing must not read the same. */
  cancelLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  /** False for a consequential but non-destructive step (hand over the host role). */
  destructive?: boolean;
  /** Asked from inside another dialog (discard a form's edits): dims that dialog too. */
  nested?: boolean;
  /** A 40px soft-tinted tile above the title that names the kind of step. */
  icon?: LucideIcon;
  /** The tile's tint; follows `destructive` unless set. */
  tone?: "destructive" | "warning" | "info";
  /** The confirm button takes the solid fill (destructive-solid when destructive). */
  solid?: boolean;
  cancelVariant?: ComponentProps<typeof AlertDialogCancel>["variant"];
  className?: string;
}) {
  const { t } = useTranslation();
  const confirmVariant = destructive ? (solid ? "destructiveSolid" : "destructive") : "default";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent nested={nested} className={className}>
        <AlertDialogHeader>
          {icon ? <IconTile icon={icon} tone={tone} className="mb-2.5" /> : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* aria-disabled, not disabled: both stay in the tab order while the
              action runs (see FormDialogFooter); Button blocks the press. */}
          <AlertDialogCancel variant={cancelVariant} aria-disabled={pending || undefined}>{cancelLabel ?? t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={onConfirm}
          >
            {/* Decorative: aria-busy carries the state; the spinner is what a
                sighted reader sees change on an action they cannot take back. */}
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
