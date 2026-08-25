"use client";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import * as React from "react";
import { cn } from "../../lib/utils";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogContent({
  title,
  srTitle,
  className,
  children,
}: {
  title: string;
  /** Khi `title` rỗng (dialog tự vẽ heading), vẫn cần title cho screen reader. */
  srTitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-4 shadow-xl",
          className,
        )}
      >
        {title ? (
          <BaseDialog.Title className="mb-3 text-base font-semibold text-primary">{title}</BaseDialog.Title>
        ) : (
          <BaseDialog.Title className="sr-only">{srTitle}</BaseDialog.Title>
        )}
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
