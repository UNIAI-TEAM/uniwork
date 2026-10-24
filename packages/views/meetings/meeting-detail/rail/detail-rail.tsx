"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingCarriedOverItems } from "@uniwork/core/meetings/action-items";
import { cn } from "@uniwork/ui/lib/utils";
import { useDetail } from "../detail-context";
import { CarriedOverBrief } from "../scheduled/carried-over-brief";
import { SideSheet } from "../ui/overlay";
import { RailGroup, RailLink } from "../ui/rail";
import { HistoryDrawer } from "./history-drawer";
import { PhoneLiveLinks } from "./phone-rail";
import { RailAsk } from "./rail-ask";
import { isLive, showsHistoryLink } from "./rail-model";
import { RailOutline } from "./rail-outline";
import { RailProperties } from "./rail-properties";

/** Groups the stacked rail hides (kit `.rail-hide-compact`): below 1200 and in the calendar panel. */
const COMPACT_HIDDEN = "@max-[58rem]/meeting:hidden";

/** Live: "Việc còn tồn 4 ›", the open work of earlier meetings in a drawer. */
function CarriedOverLink() {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const [open, setOpen] = useState(false);
  const { data } = useMeetingCarriedOverItems(meeting.id);
  if (!data?.total) return null;
  return (
    <RailGroup>
      <RailLink count={data.total} onClick={() => setOpen(true)}>
        {t("meetings.detail.carriedOver.title")}
      </RailLink>
      <SideSheet open={open} onOpenChange={setOpen} width={480} title={t("meetings.detail.carriedOver.title")}>
        <CarriedOverBrief />
      </SideSheet>
    </RailGroup>
  );
}

/**
 * The meeting's properties rail (kit `.rail`, 288): sticky beside main with
 * a left hairline; above main as plain property rows below 1200 and in the
 * calendar panel, where the outline, the history link and Ask are hidden
 * (the header's ⋯ still opens the history).
 */
export function DetailRail() {
  const { t } = useTranslation();
  const { displayStatus, viewer, isClerk, layout, sections, isPhone } = useDetail();
  const [history, setHistory] = useState(false);
  const panel = layout === "panel";
  const live = isLive(displayStatus);
  // A phone draws no stacked rail: before the meeting the body's "Người dự" carries the people
  // (PhoneScheduled), after it the header's people row (PhoneAfter), and live two rows after the notes (PhoneLive).
  if (isPhone && (displayStatus === "SCHEDULED" || displayStatus === "ENDED")) return null;
  if (isPhone && live) return <PhoneLiveLinks />;

  return (
    <aside
      aria-label={t("meetings.detail.rail.label")}
      className={cn(
        // The docked roll takes the rail's place (LiveSecretary).
        "flex min-w-0 flex-col [[data-panel=roll]_&]:hidden",
        panel
          ? "order-first mb-2 border-b border-border pb-3"
          : "sticky top-4 border-l border-border pl-6 @max-[58rem]/meeting:static @max-[58rem]/meeting:order-first @max-[58rem]/meeting:mb-2 @max-[58rem]/meeting:border-b @max-[58rem]/meeting:border-l-0 @max-[58rem]/meeting:pb-3 @max-[58rem]/meeting:pl-0",
      )}
    >
      <RailProperties />
      {panel ? null : (
        <div className={cn("flex flex-col", COMPACT_HIDDEN)}>
          <RailOutline />
          {live && sections.carriedOver ? <CarriedOverLink /> : null}
          {showsHistoryLink(displayStatus, viewer, isClerk) ? (
            <RailGroup>
              <RailLink onClick={() => setHistory(true)}>{t("meetings.activity")}</RailLink>
            </RailGroup>
          ) : null}
          {sections.ai ? <RailAsk /> : null}
        </div>
      )}
      <HistoryDrawer open={history} onOpenChange={setHistory} />
    </aside>
  );
}
