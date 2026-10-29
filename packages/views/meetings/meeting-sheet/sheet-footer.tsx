"use client";
import { Fragment, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { UI_EASE_OUT } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { kitButton } from "../meeting-detail/ui/kit-buttons";

/** The morphing primary: its padding, corners and fill settle over 300 ms; at rest it is the plain kit button. */
const MORPH = "relative min-w-9 transition-[padding,border-radius,background-color,gap] duration-300 ease-settle motion-reduce:transition-none";

/** The ✓ drawn in 300 ms once the meeting exists. */
function DrawnCheck() {
  const reduce = useReducedMotion() ?? false;
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="absolute inset-0 m-auto size-4">
      <motion.path d="M20 6 9 17l-5-5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, ease: UI_EASE_OUT }} />
    </svg>
  );
}

export type FooterLine ={ text: ReactNode; tone: "muted" | "destructive" | "status" };

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
  morph = false,
  landed = false,
  doneLabel,
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
  /** Create (proposal C): busy folds the primary into a 36px ring with a spinner, `landed` turns it into a drawn ✓. */
  morph?: boolean;
  landed?: boolean;
  doneLabel?: string;
}) {
  const { t } = useTranslation();
  const state = landed ? "done" : busy ? "busy" : "idle";
  const kbdHint = (
    <span aria-hidden className="ml-0.5 text-caption font-normal group-data-[mode=edit]/sheet:font-medium group-data-[mode=live]/sheet:font-medium group-data-[fresh]/sheet:font-medium text-[color-mix(in_srgb,var(--brand-foreground)_85%,var(--brand))] max-sm:hidden">
      {t("meetings.sheet.kbdSubmit")}
    </span>
  );
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
          aria-disabled={busy || landed || undefined}
          aria-busy={busy || undefined}
          aria-keyshortcuts={kbd ? "Meta+Enter Control+Enter" : undefined}
          aria-label={morph && state !== "idle" ? (state === "done" ? doneLabel : (busyLabel ?? primaryLabel)) : undefined}
          data-state={morph ? state : undefined}
          onClick={(e) => {
            if (busy || landed) e.preventDefault();
            else onPrimary?.();
          }}
          className={cn(
            kitButton.base,
            "aria-disabled:opacity-100 max-sm:h-11 max-sm:flex-1",
            morph && MORPH,
            morph && state !== "idle" && "gap-0 rounded-[18px] px-0",
            morph && state === "done" && "bg-success-solid text-on-solid hover:bg-success-solid",
          )}
        >
          {morph ? (
            <>
              {state === "busy" ? <Spinner className="absolute inset-0 m-auto size-4" /> : null}
              {state === "done" ? <DrawnCheck /> : null}
              {/* The label folds away (0fr) as the button shrinks to its ring, and opens again on an error. */}
              <span className={cn("grid transition-[grid-template-columns,opacity] duration-300 ease-settle motion-reduce:transition-none", state === "idle" ? "grid-cols-[1fr]" : "grid-cols-[0fr] opacity-0")}>
                <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                  {primaryLabel}
                  {kbd ? kbdHint : null}
                </span>
              </span>
            </>
          ) : (
            <>
              {busy ? <Spinner className="size-3.5" /> : null}
              {busy ? (busyLabel ?? primaryLabel) : primaryLabel}
              {kbd && !busy ? kbdHint : null}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
