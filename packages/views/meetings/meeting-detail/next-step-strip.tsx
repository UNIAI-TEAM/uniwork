"use client";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useDetail } from "./detail-context";
import type { DetailStatus } from "./detail-model";
import { StripLiveRows } from "./live/strip-live-rows";
import { capJobs, type StripJob } from "./next-step-jobs";
import { PhonePrimary, usePhoneBar } from "./phone-frame";
import { StripRsvpRow } from "./scheduled/strip-rsvp-row";
import { StripJobRow, type StripHandlers } from "./strip-rows";
import { kitButton } from "./ui/kit-buttons";
import { Strip } from "./ui/strip";

/**
 * The next-step strip under the title (kit `.strip`): the viewer's jobs from
 * `nextStepJobs`, at most three rows and a count of the rest. Live, package
 * F's lobby and vote rows follow the head row; before the meeting an invitee
 * gets package G's RSVP row (its full-width variant in the phone's bottom bar).
 * No job, no strip.
 */
/**
 * The phone boards space the strip by state: after the meeting it hangs 8 under the people row,
 * open below and tight rows (PhoneAfter); live 20 under the time bar (PhoneLive); before, 16 (PhoneScheduled).
 */
const PHONE_STRIP: Partial<Record<DetailStatus, string>> = {
  ENDED:
    "@max-[37.5rem]/meeting:mt-2 @max-[37.5rem]/meeting:border-b-0 @max-[37.5rem]/meeting:[&>div]:min-h-0 @max-[37.5rem]/meeting:[&>div]:pt-3 @max-[37.5rem]/meeting:[&>div]:pb-1",
  IN_PROGRESS: "@max-[37.5rem]/meeting:mt-5",
  OVERTIME: "@max-[37.5rem]/meeting:mt-5",
  SCHEDULED: "@max-[37.5rem]/meeting:mt-4",
};

export function NextStepStrip({ jobs, handlers }: { jobs: StripJob[]; handlers: StripHandlers }) {
  const { t } = useTranslation();
  const { displayStatus } = useDetail();
  const phone = usePhoneBar();
  const { shown, more } = capJobs(jobs);
  if (shown.length === 0) return null;
  const outsider = shown.some((j) => j.kind === "outsider");
  const live = shown.some((j) => j.kind === "live" || j.kind === "overtime");
  // "Cần bạn · n" heads the live rows under it: no hairline between them (LiveHost).
  const headed = shown.some((j) => j.kind === "live" && j.need > 0);
  return (
    // Rows wrap their actions under the text when both do not fit (the calendar panel);
    // a row whose only action moved to the phone's bottom bar keeps no empty action box.
    <Strip
      aria-label={t(outsider ? "meetings.detail.strip.ariaOutsider" : "meetings.detail.strip.aria")}
      className={cn("[&>div]:flex-wrap [&>div>div:empty]:hidden", headed && "[&>:first-child]:border-b-0", PHONE_STRIP[displayStatus], "[[data-panel=roll]_&]:mt-4")}
    >
      {shown.map((job) =>
        job.kind === "rsvp" ? (
          <div key={job.kind}>
            <StripRsvpRow
              variant="strip"
              actions={
                <Button type="button" size="lg" variant="outline" className={cn(kitButton.base, kitButton.outline)} onClick={handlers.onJoin}>
                  <Video aria-hidden />
                  {t("meetings.join")}
                </Button>
              }
            />
            {phone ? (
              <PhonePrimary>
                <StripRsvpRow variant="phoneBar" />
              </PhonePrimary>
            ) : null}
          </div>
        ) : (
          <StripJobRow key={job.kind} job={job} handlers={handlers} />
        ),
      )}
      {live ? <StripLiveRows /> : null}
      {more > 0 ? <p className="py-3 text-caption text-muted-foreground">{t("meetings.detail.strip.more", { count: more })}</p> : null}
    </Strip>
  );
}
