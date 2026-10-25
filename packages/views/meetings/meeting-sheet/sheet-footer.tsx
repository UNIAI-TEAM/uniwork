"use client";
import { Fragment, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { kitButton } from "../meeting-detail/ui/kit-buttons";

export type FooterLine = { text: ReactNode; tone: "muted" | "destructive" | "status" };

/**
 * The sheet's 64px foot (create brief §2.1): one caption on the left — an
 * error first, then the status of a running submit, then the invitation
 * note — and [Hủy] + the primary on the right. The primary is never disabled:
 * while busy it is `aria-disabled` + `aria-busy` with a spinner. On a phone
 * only the full-width primary stays (the caption moves into the body).
 */
export function SheetFooter({
  line,
  cancelLabel,
  onCancel,
  primaryLabel,
  busyLabel,
  busy,
  onPrimary,
  primaryType = "submit",
  form,
  extra,
  kbd = true,
  stacked = false,
}: {
  line: FooterLine | null;
  cancelLabel?: string;
  onCancel?: () => void;
  primaryLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onPrimary?: () => void;
  primaryType?: "submit" | "button";
  form?: string;
  /** A button left of the primary ([Thử lại tất cả]). */
  extra?: ReactNode;
  kbd?: boolean;
  /** Phone: the caption over [Hủy] + the primary (edit, follow-up) instead of one full-width primary (create). */
  stacked?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex h-16 flex-none items-center justify-between gap-4 rounded-bl-lg border-t border-border bg-popover px-6 max-sm:h-auto max-sm:rounded-none max-sm:px-4 max-sm:pt-3",
        stacked
          ? "max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:pb-[calc(2.125rem+env(safe-area-inset-bottom))] max-sm:group-data-[mode=edit]/sheet:pb-[calc(1rem+env(safe-area-inset-bottom))]"
          : "max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
      )}
    >
      <p
        className={cn(
          "min-w-0 text-caption",
          !stacked && "max-sm:hidden",
          line?.tone === "destructive" ? "flex items-start gap-1.5 text-destructive" : "text-muted-foreground",
        )}
        role={line?.tone === "destructive" ? "alert" : "status"}
      >
        {line?.tone === "destructive" ? <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" /> : null}
        {/* A two-line caption breaks with <br> (CreatePartial), so its text reads as one sentence pair. */}
        {typeof line?.text === "string"
          ? line.text.split("\n").map((part, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {part}
              </Fragment>
            ))
          : line?.text}
      </p>
      <div className="flex flex-none gap-2 max-sm:flex-1">
        {extra}
        {onCancel ? (
          <Button type="button" variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost, stacked ? "max-sm:h-11 max-sm:flex-1" : "max-sm:hidden")} onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
        ) : null}
        <Button
          type={primaryType}
          form={form}
          variant="brand"
          size="lg"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          aria-keyshortcuts={kbd ? "Meta+Enter Control+Enter" : undefined}
          onClick={(e) => {
            if (busy) e.preventDefault();
            else onPrimary?.();
          }}
          className={cn(kitButton.base, "aria-disabled:opacity-100 max-sm:h-11 max-sm:flex-1")}
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          {busy ? (busyLabel ?? primaryLabel) : primaryLabel}
          {kbd && !busy ? (
            <span aria-hidden className="ml-0.5 text-caption font-normal group-data-[mode=edit]/sheet:font-medium group-data-[mode=live]/sheet:font-medium group-data-[fresh]/sheet:font-medium text-[color-mix(in_srgb,var(--brand-foreground)_85%,var(--brand))] max-sm:hidden">
              {t("meetings.sheet.kbdSubmit")}
            </span>
          ) : null}
        </Button>
      </div>
    </div>
  );
}
