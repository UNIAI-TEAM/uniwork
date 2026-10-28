"use client";
import { ArrowRight, CalendarClock, Keyboard, Undo2, UserPen } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { NumberFlow } from "@uniwork/ui/components/ui/number-flow";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { UI_EASE_OUT, UI_EASE_SETTLE } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../../common/date-field";
import { SearchableOptionPicker } from "../../../tasks/pickers/searchable-option-picker";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { kitButton } from "../ui/kit-buttons";
import { CountdownRing, DrawnCheck, POP } from "./assign-motion";
import { UNDO_MS } from "./use-close-out";

const ICON_BUTTON =
  "grid size-8.5 place-items-center rounded-[9px] text-muted-foreground hover:bg-surface-hover hover:text-foreground pointer-coarse:size-11 [&>svg:last-child:not(:first-child)]:hidden";
const SEP = <span aria-hidden className="mx-1 h-5.5 w-px shrink-0 bg-border" />;

/**
 * The floating assign dock (clip G, kit `.selbar`): it rises once a row is
 * picked, with the count rolling, the picked owners' faces, a shared owner
 * and due date for every picked row, Bỏ chọn, and Giao, which opens the
 * review sheet as before. Once the server has made the tasks it says so,
 * with Hoàn tác and its 8-second ring.
 */
export function SelectionBar({
  count,
  owners,
  people,
  earliest,
  assigned,
  phone,
  besideSheet,
  onClear,
  onReview,
  onSetOwner,
  onSetDue,
  onUndo,
  undoing,
}: {
  count: number;
  /** The picked rows' owners, each once, in list order. */
  owners: readonly string[];
  people: number;
  /** "T2 26/10", or "" when no picked row has a due date. */
  earliest: string;
  /** The last assignment, while its undo lasts; shown once nothing is picked. */
  assigned: { count: number; at: number } | null;
  phone?: boolean;
  /** The review sheet is open: the dock moves left of it, and the list's keys are idle. */
  besideSheet?: boolean;
  onClear: () => void;
  onReview: () => void;
  onSetOwner: (id: string | null) => void;
  onSetDue: (date: string | null) => void;
  onUndo: () => void;
  undoing: boolean;
}) {
  const { t } = useTranslation();
  const { memberIndex } = useDetail();
  const reduced = useReducedMotion() ?? false;
  const pane = count > 0 ? "select" : assigned ? "done" : null;
  const meta = earliest
    ? t("meetings.detail.closeOut.selMeta", { count: people, date: earliest })
    : t("meetings.detail.closeOut.selMetaNoDue", { count: people });
  const fade = reduced
    ? {}
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, ease: UI_EASE_OUT } };

  return (
    <AnimatePresence>
      {pane ? (
        <motion.div
          key="dock"
          role="region"
          aria-label={t("meetings.detail.closeOut.selRegion")}
          layout={!reduced}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.26, ease: UI_EASE_OUT, layout: { duration: 0.45, ease: UI_EASE_SETTLE } }}
          className={cn(
            "z-10 flex h-13 w-fit items-center gap-1.5 overflow-hidden rounded-[14px] border border-border bg-popover pr-2 pl-2.5 whitespace-nowrap shadow-floating",
            phone
              ? "fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] w-auto"
              : cn("sticky bottom-6 mx-auto mt-4", besideSheet && "ml-0"),
          )}
        >
          {/* The dock's own child: a modal sheet keeps live regions readable, and the panes beside it hide whole. */}
          <p aria-live="polite" className="sr-only">
            {pane === "select" ? `${t("meetings.detail.closeOut.selCount", { count })} · ${meta}` : null}
          </p>
          {pane === "select" ? (
            <motion.div key="select" className="flex min-w-0 flex-1 items-center gap-1.5" {...fade}>
              <span aria-hidden className="inline-grid h-6.5 min-w-6.5 place-items-center rounded-full bg-primary px-1.5 text-label font-semibold text-primary-foreground">
                <NumberFlow value={count} />
              </span>
              <span aria-hidden className="mr-1 text-body font-medium text-foreground">
                {t("meetings.motion.assign.selected")}
              </span>
              <span aria-hidden className="mr-0.5 flex gap-0.5">
                <AnimatePresence initial={false}>
                  {owners.map((id) => (
                    <motion.span key={id} {...(reduced ? {} : POP)} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                      <MeetingPersonAvatar name={memberIndex.memberOf(id)?.display_name ?? "?"} size={24} tint={meetingAvatarTint(id, memberIndex.members)} />
                    </motion.span>
                  ))}
                </AnimatePresence>
              </span>
              {phone ? <span className="flex-1" /> : <DockEdits onSetOwner={onSetOwner} onSetDue={onSetDue} besideSheet={besideSheet} onClear={onClear} />}
              <Button type="button" variant="brand" size="lg" className={cn(kitButton.base, "rounded-[10px] pr-3.5 pl-4")} aria-haspopup="dialog" onClick={onReview}>
                {t("meetings.closeOut.assignAction")}
                <ArrowRight aria-hidden />
              </Button>
            </motion.div>
          ) : assigned ? (
            <motion.div key={`done-${assigned.at}`} className="flex items-center gap-1.5" {...fade}>
              <DrawnCheck className="size-6.5" />
              <p role="status" className="mr-1 text-body font-medium text-foreground">
                {t("meetings.motion.assign.done", { count: assigned.count })}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className={cn(kitButton.base, kitButton.ghost, "gap-2 pr-2 pl-2.5 text-primary hover:text-primary")}
                aria-disabled={undoing || undefined}
                onClick={onUndo}
              >
                <Undo2 aria-hidden />
                {t("notifications.undo")}
                <CountdownRing seconds={UNDO_MS / 1000} />
              </Button>
            </motion.div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Đổi người nhận and Đặt hạn for every picked row, the keys help, then Bỏ chọn. */
function DockEdits({
  onSetOwner,
  onSetDue,
  onClear,
  besideSheet,
}: {
  onSetOwner: (id: string | null) => void;
  onSetDue: (date: string | null) => void;
  onClear: () => void;
  besideSheet?: boolean;
}) {
  const { t } = useTranslation();
  const { memberIndex } = useDetail();
  return (
    <>
      {SEP}
      <SearchableOptionPicker
        value={null}
        onChange={onSetOwner}
        options={memberIndex.members.map((m) => ({ value: m.user_id, label: m.display_name }))}
        emptyOption={{ value: "", label: t("meetings.detail.closeOut.ownerNone") }}
        ariaLabel={t("meetings.motion.assign.changeOwner")}
        searchPlaceholder={t("meetings.detail.closeOut.ownerSearch")}
        noResultsLabel={t("meetings.detail.closeOut.ownerNoMatch")}
        triggerClassName={cn(ICON_BUTTON, "border-0 bg-transparent p-0")}
      >
        <UserPen aria-hidden className="size-4" />
      </SearchableOptionPicker>
      <DateField
        value=""
        onChange={(d) => onSetDue(d || null)}
        ariaLabel={t("meetings.motion.assign.setDue")}
        triggerRender={<button type="button" title={t("meetings.motion.assign.setDue")} className={ICON_BUTTON} />}
        renderTrigger={() => <CalendarClock aria-hidden className="size-4" />}
      />
      {besideSheet ? null : <KeysHelp />}
      {SEP}
      <Button type="button" variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost, "px-2.5 text-muted-foreground")} onClick={onClear}>
        {t("meetings.detail.closeOut.selClear")}
      </Button>
    </>
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
            className={cn(kitButton.ghost, kitButton.icon, "text-muted-foreground")}
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
