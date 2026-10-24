"use client";
import { Fragment, useId, type ReactNode } from "react";
import { ChevronRight, CircleAlert, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { defaultStorage } from "@uniwork/core/platform";
import { cn } from "@uniwork/ui/lib/utils";
import type { MeetingDraft } from "./draft-model";
import { parseQuorum } from "./draft-validation";
import { CONTROL, FIELD_LABEL, SECTION_TITLE } from "./sheet-styles";

const OPEN_KEY = "uniwork:meeting-sheet:more-open";

/** The viewer's last choice for "Thêm tùy chọn" (a per-viewer convenience; closed when storage is empty or blocked). */
export function readMoreOpen(): boolean {
  try {
    return defaultStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberMoreOpen(open: boolean) {
  try {
    if (open) defaultStorage.setItem(OPEN_KEY, "1");
    else defaultStorage.removeItem(OPEN_KEY);
  } catch {
    // Storage blocked (private window): the sheet just opens closed next time.
  }
}

/**
 * "Khách bên ngoài: 1 liên kết, chủ trì duyệt · Biểu quyết: 1 nội dung ·
 * Điểm danh: không yêu cầu" — every value spelled out (create brief §2.8).
 */
export function moreSummary(draft: MeetingDraft, existingLinks: number, t: ReturnType<typeof useTranslation>["t"]): string[] {
  const links = draft.links.length + existingLinks;
  const guests =
    links === 0
      ? t("meetings.sheet.summaryNone")
      : links === 1 && (draft.links[0]?.access ?? "REQUEST_APPROVAL") === "REQUEST_APPROVAL"
        ? t("meetings.sheet.summaryOneLinkApproval")
        : t("meetings.sheet.summaryLinks", { count: links });
  const votes = draft.motions.length ? t("meetings.sheet.summaryMotions", { count: draft.motions.length }) : t("meetings.sheet.summaryNone");
  const quorum = parseQuorum(draft.quorum);
  const roll = quorum.value > 0 && !quorum.invalid ? t("meetings.sheet.summaryQuorum", { percent: quorum.value }) : t("meetings.sheet.summaryNoQuorum");
  return [
    t("meetings.sheet.summaryGuests", { value: guests }),
    t("meetings.sheet.summaryVotes", { value: votes }),
    t("meetings.sheet.summaryRoll", { value: roll }),
  ];
}

/**
 * The "Thêm tùy chọn" disclosure: a 52px button with the live summary, then
 * Khách bên ngoài, Biểu quyết and Điểm danh. A section with an error while
 * closed says so in the summary.
 */
export function MoreOptions({
  open,
  onOpenChange,
  summary,
  hasError,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The parts of the summary; a line breaks between them, never inside one. */
  summary: string[];
  hasError: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="mt-6 group-data-[fresh]/sheet:mt-4 group-data-[mode=live]/sheet:mt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-summary`}
        onClick={() => onOpenChange(!open)}
        className="-mx-2 grid min-h-13 w-[calc(100%+16px)] grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2 rounded-md p-2 text-left hover:bg-surface-hover"
      >
        <ChevronRight aria-hidden className={cn("mt-px size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span>
          <span id={`${id}-title`} className="block text-label font-medium">
            {t("meetings.sheet.more")}
          </span>
          <span id={`${id}-summary`} className="mt-0.5 block text-caption text-pretty text-muted-foreground">
            {/* Open, each part is its own unbreakable span (CreateFull); closed, one run of text whose parts
                still never break inside (no-break spaces), as the closed boards draw it (CreateDefault). */}
            {open
              ? summary.map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 ? " · " : null}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ))
              : summary.map((part) => part.replace(/ /g, "\u00a0")).join(" · ")}
            {hasError && !open ? <span className="text-destructive"> · {t("meetings.sheet.moreNeedsFix")}</span> : null}
          </span>
        </span>
      </button>
      <div id={`${id}-panel`} hidden={!open} className="mt-3 space-y-6">
        {children}
      </div>
    </div>
  );
}

/** Điểm danh: the minimum attendance, read-only with its reason once the roll is finalized. */
export function QuorumSection({
  value,
  onChange,
  showError,
  onBlur,
  locked,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  showError: boolean;
  onBlur: () => void;
  locked?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const invalid = parseQuorum(value).invalid && showError;
  return (
    <section className="pt-2" aria-labelledby="sheet-roll-title">
      <h3 id="sheet-roll-title" className={SECTION_TITLE}>
        {t("meetings.governance.attendanceTitle")}
      </h3>
      <label htmlFor="sheet-quorum" className={cn(FIELD_LABEL, "mt-2")}>
        {t("meetings.quorumLabel")}
      </label>
      {locked ? (
        <div className="flex items-start gap-2">
          <Lock aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <p className="text-body">{value ? `${value}%` : t("meetings.sheet.quorumNone")}</p>
            <p className="text-caption text-muted-foreground">{t("meetings.governance.errors.attendance_finalized")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className={cn(CONTROL, "inline-flex overflow-hidden p-0 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring", invalid && "border-destructive")}>
            <input
              id="sheet-quorum"
              inputMode="numeric"
              value={value}
              readOnly={readOnly}
              placeholder={t("meetings.sheet.quorumNone")}
              aria-label={t("meetings.sheet.quorumAria")}
              aria-invalid={invalid || undefined}
              aria-describedby="sheet-quorum-hint"
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              className="w-32 bg-transparent px-2.5 text-body outline-none placeholder:text-muted-foreground group-data-[mode=edit]/sheet:w-30.5 group-data-[mode=live]/sheet:ml-3 group-data-[mode=live]/sheet:h-5 group-data-[mode=live]/sheet:w-26.5 group-data-[mode=live]/sheet:self-center group-data-[mode=live]/sheet:px-0"
            />
            <span aria-hidden className="grid w-8 place-items-center border-l border-input bg-muted text-muted-foreground group-data-[mode=edit]/sheet:w-9 group-data-[mode=edit]/sheet:text-label group-data-[mode=edit]/sheet:font-medium">
              %
            </span>
          </div>
          <p id="sheet-quorum-hint" className={cn("mt-1.5 flex items-center gap-1 text-caption group-data-[mode=edit]/sheet:mt-2 group-data-[mode=live]/sheet:mt-2", invalid ? "text-destructive" : "text-muted-foreground")}>
            {invalid ? <CircleAlert aria-hidden className="size-3.5" /> : null}
            {t(invalid ? "meetings.quorumInvalid" : "meetings.quorumHint")}
          </p>
        </>
      )}
    </section>
  );
}
