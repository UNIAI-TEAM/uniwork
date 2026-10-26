"use client";
import { Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { kitButton } from "../ui/kit-buttons";

/**
 * The selection bar (kit `.selbar`): it appears only after an explicit
 * selection, sticks to the bottom of the reading column (on a phone it takes
 * the bottom bar's place) and says what the review will hold.
 */
export function SelectionBar({
  count,
  people,
  earliest,
  phone,
  besideSheet,
  onClear,
  onReview,
}: {
  count: number;
  people: number;
  /** "T2 26/10", or "" when no picked row has a due date. */
  earliest: string;
  phone?: boolean;
  /** The review sheet is open: the bar narrows to stay left of it, and the list's keys are idle. */
  besideSheet?: boolean;
  onClear: () => void;
  onReview: () => void;
}) {
  const { t } = useTranslation();
  const meta = earliest
    ? t("meetings.detail.closeOut.selMeta", { count: people, date: earliest })
    : t("meetings.detail.closeOut.selMetaNoDue", { count: people });
  return (
    <div
      role="region"
      aria-label={t("meetings.detail.closeOut.selRegion")}
      className={cn(
        "z-10 flex items-center justify-between gap-4 border-border bg-popover shadow-floating",
        phone
          ? "fixed inset-x-0 bottom-0 min-h-24.5 gap-3 px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]"
          : cn("sticky bottom-4 mt-4 min-h-14 rounded-lg border py-2.5 pr-2.5 pl-4", besideSheet && "max-w-126"),
      )}
    >
      <p aria-live="polite" className={cn("min-w-0", phone ? "flex flex-none flex-col" : "text-body")}>
        <strong className={cn("block font-semibold", phone && "text-body")}>
          {t("meetings.detail.closeOut.selCount", { count })}
        </strong>
        {/* Desktop: the meta is the paragraph's own text (kit `.selbar-text`), the count sits above it as a block. */}
        {phone ? <span className="text-caption text-muted-foreground">{meta}</span> : meta}
      </p>
      <div className={cn("flex gap-2", phone && "flex-1 justify-end")}>
        {phone || besideSheet ? null : <KeysHelp />}
        {phone ? null : (
          <Button type="button" variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost)} onClick={onClear}>
            {t("meetings.detail.closeOut.selClear")}
          </Button>
        )}
        <Button
          type="button"
          variant="brand"
          size="lg"
          className={cn(kitButton.base, phone && "h-11 flex-1")}
          aria-haspopup="dialog"
          onClick={onReview}
        >
          {t("meetings.detail.closeOut.selReview")}
        </Button>
      </div>
    </div>
  );
}

/** The "?" the brief asks for: which keys work in the list. */
function KeysHelp() {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn(kitButton.ghost, kitButton.icon)}
            aria-label={t("meetings.detail.closeOut.keys")}
          />
        }
      >
        <Keyboard aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2">
        <PopoverTitle className="text-label font-medium">{t("meetings.detail.closeOut.keys")}</PopoverTitle>
        <ul className="space-y-1 text-caption text-muted-foreground">
          <li>{t("meetings.detail.closeOut.keyMove")}</li>
          <li>{t("meetings.detail.closeOut.keyToggle")}</li>
          <li>{t("meetings.detail.closeOut.keyReview")}</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
