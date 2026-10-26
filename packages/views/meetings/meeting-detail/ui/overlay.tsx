"use client";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { cn } from "@uniwork/ui/lib/utils";

/** The kit scrim (`--scrim`) instead of the primitives' faint blur. */
const SCRIM = "bg-scrim supports-backdrop-filter:backdrop-blur-none";

const WIDTH = {
  560: "data-[side=right]:w-140",
  480: "data-[side=right]:w-120",
} as const;

/**
 * A right side sheet (kit `.sheet-r` 560 / `.drawer` 480): scrim, rounded
 * left edge, a 56 head with the title and our own ×, a scrolling body and a 64
 * foot. It portals to the body and takes focus, so an Esc inside it closes the
 * sheet, never the calendar panel behind it.
 */
export function SideSheet({
  open,
  onOpenChange,
  width,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width: keyof typeof WIDTH;
  title: ReactNode;
  /** Screen-reader description of the sheet. */
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        overlayClassName={SCRIM}
        className={cn(
          "gap-0 rounded-l-lg border-border bg-popover p-0 data-[side=right]:max-w-full data-[side=right]:sm:max-w-none",
          WIDTH[width],
          className,
        )}
      >
        {/* Kit `.ov-head`: 16 around a 36 close button (68 tall), the title balanced over two lines if it must. */}
        <div className="flex flex-none items-center justify-between gap-3 border-b border-border py-4 pr-4 pl-6">
          <SheetTitle className="min-w-0 text-title-sm font-semibold text-balance">{title}</SheetTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-9"
            aria-label={t("common.close")}
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden />
          </Button>
        </div>
        {description ? <SheetDescription className="sr-only">{description}</SheetDescription> : null}
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-none items-center justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * A 440 dialog (kit `.dialog`): r12, 24 padding, title-sm, body-lg text, and
 * a plain footer (no tinted band). `role="alertdialog"` for a confirmation.
 */
export function Dialog440({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  role,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  role?: "dialog" | "alertdialog";
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // An unset role must not override the popup's own "dialog": screen readers would not hear a dialog at all.
        role={role ?? "dialog"}
        showCloseButton={false}
        overlayClassName={SCRIM}
        className={cn("gap-0 rounded-lg border border-border bg-popover p-6 ring-0 sm:max-w-110", className)}
      >
        <DialogTitle className="text-title-sm font-semibold">{title}</DialogTitle>
        {description ? <DialogDescription className="mt-2 text-body-lg text-foreground">{description}</DialogDescription> : null}
        {children}
        <div className="mt-6 flex justify-end gap-2">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}
