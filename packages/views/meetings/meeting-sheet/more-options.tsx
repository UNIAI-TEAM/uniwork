"use client";
import type { ReactNode } from "react";
import { CircleAlert, Lock, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { parseQuorum } from "./draft-validation";
import { CONTROL, PROPERTY_CHIP } from "./sheet-styles";

/** The sheet's optional parts: guest links, votes, the attendance minimum. */
type OptionKey = "guests" | "votes" | "roll";

/**
 * The optional parts not in use yet, as quiet dashed chips under Thư ký UNI,
 * each with the icon its part keeps once open: one press opens the part and
 * starts it. What each one does is the chip's hover hint, not a line of text.
 */
export function OptionChips({
  items,
  readOnly,
}: {
  items: { key: OptionKey; icon: LucideIcon; label: string; hint: string; onOpen: () => void }[];
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div role="group" aria-label={t("meetings.sheet.more")} className="mt-5 flex flex-wrap gap-2 group-data-[fresh]/sheet:mt-4">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={readOnly}
          title={item.hint}
          onClick={item.onOpen}
          className={cn(PROPERTY_CHIP, "border-dashed text-muted-foreground hover:text-foreground disabled:cursor-not-allowed")}
        >
          <item.icon aria-hidden />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One optional part in use: its icon, name and count on one line, then the
 * part itself under the name. An empty part closes with ×; one with content
 * keeps showing until its rows are removed, so nothing typed is dropped.
 */
export function OptionSection({
  id,
  icon: Icon,
  title,
  count,
  onClose,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  count?: number;
  /** Only while the part is empty. */
  onClose?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby={`${id}-title`} className="mt-5">
      <div className="flex h-7 items-center gap-2">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h3 id={`${id}-title`} className="text-label font-medium">
          {title}
        </h3>
        {count ? <span className="text-caption text-muted-foreground tabular-nums">{count}</span> : null}
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label={t("meetings.sheet.optionClose", { name: title })}
            title={t("meetings.sheet.optionClose", { name: title })}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="pl-6">{children}</div>
    </section>
  );
}

/** Điểm danh: the minimum attendance on one line, read-only with its reason once the roll is finalized. */
export function QuorumSection({
  value,
  onChange,
  showError,
  onBlur,
  locked,
  readOnly,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  showError: boolean;
  onBlur: () => void;
  locked?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const invalid = parseQuorum(value).invalid && showError;
  if (locked) {
    return (
      <div className="mt-1 flex items-start gap-2">
        <Lock aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <p className="text-body">{value ? `${value}%` : t("meetings.sheet.quorumNone")}</p>
          <p className="text-caption text-muted-foreground">{t("meetings.governance.errors.attendance_finalized")}</p>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor="sheet-quorum" className="text-body text-muted-foreground">
          {t("meetings.quorumLabel")}
        </label>
        <div className={cn(CONTROL, "inline-flex overflow-hidden p-0 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring", invalid && "border-destructive")}>
          <input
            id="sheet-quorum"
            inputMode="numeric"
            value={value}
            readOnly={readOnly}
            // The part was opened to set it: the field takes the focus.
            autoFocus={autoFocus}
            placeholder={t("meetings.sheet.quorumNone")}
            aria-label={t("meetings.sheet.quorumAria")}
            aria-invalid={invalid || undefined}
            aria-describedby="sheet-quorum-hint"
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className="w-36 bg-transparent px-2.5 text-body outline-none placeholder:text-muted-foreground"
          />
          <span aria-hidden className="grid w-8 place-items-center border-l border-input bg-muted text-muted-foreground">
            %
          </span>
        </div>
      </div>
      {/* The hint is the chip's hover text; here it stays for screen readers, and shows only to explain an error. */}
      <p id="sheet-quorum-hint" className={invalid ? "mt-1.5 flex items-center gap-1 text-caption text-destructive" : "sr-only"}>
        {invalid ? <CircleAlert aria-hidden className="size-3.5" /> : null}
        {t(invalid ? "meetings.quorumInvalid" : "meetings.quorumHint")}
      </p>
    </>
  );
}
