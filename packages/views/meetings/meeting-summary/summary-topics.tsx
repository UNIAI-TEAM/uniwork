"use client";
import { useId } from "react";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingSummaryDecision, MeetingSummaryTopic } from "@uniwork/core/types/meeting";
import { meetingLocale } from "../meeting-datetime";
import { formatMeetingMoment } from "../meeting-detail-format";
import { MeetingEvidenceChip } from "../meeting-evidence-chip";

/** A bulleted line the AI picked out, with the lines it rests on. */
function CitedPoints({ meetingId, points }: { meetingId: string; points: readonly MeetingSummaryDecision[] }) {
  return (
    <ul className="space-y-1.5">
      {points.map((p, i) => (
        <li key={i} className="flex items-start gap-2 text-body text-foreground">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-faint-foreground" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-pretty">{p.text}</p>
            <MeetingEvidenceChip meetingId={meetingId} evidence={p.evidence} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * meeting_summary@7's topics in the order discussed (UNI-1995 #8): each one's
 * title, the time it started, which opens that line of the transcript, and its
 * cited points. Nothing for an older summary, which has none.
 */
export function SummaryTopics({
  meetingId,
  topics,
  shownDay,
}: {
  meetingId: string;
  topics: readonly MeetingSummaryTopic[];
  /** The day the page shows: a time on it is the clock alone. */
  shownDay?: string;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  if (topics.length === 0) return null;
  const locale = meetingLocale(i18n.language);
  return (
    <div className="space-y-3">
      <h3 id={headingId} className="text-label font-semibold text-foreground">
        {t("meetings.summaryTopics")}
      </h3>
      <ol aria-labelledby={headingId} className="space-y-4">
        {topics.map((topic, i) => {
          const time = topic.start_at ? formatMeetingMoment(topic.start_at, locale, shownDay) : "";
          const titleId = `${headingId}-${i}`;
          return (
            <li key={i} aria-labelledby={titleId} className="space-y-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h4 id={titleId} className="min-w-0 break-words text-label font-medium text-foreground">
                  {topic.title}
                </h4>
                {topic.start && time ? (
                  <MeetingEvidenceChip
                    meetingId={meetingId}
                    evidence={[topic.start]}
                    trigger={{
                      label: t("meetings.summaryTopicStart", { time }),
                      content: (
                        <>
                          <Clock aria-hidden />
                          <time dateTime={topic.start_at ?? undefined} className="tabular-nums">
                            {time}
                          </time>
                        </>
                      ),
                    }}
                  />
                ) : null}
              </div>
              <CitedPoints meetingId={meetingId} points={topic.points} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Questions the meeting raised and left open, each with its evidence. */
export function SummaryOpenQuestions({
  meetingId,
  questions,
}: {
  meetingId: string;
  questions: readonly MeetingSummaryDecision[];
}) {
  const { t } = useTranslation();
  if (questions.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-label font-semibold text-foreground">{t("meetings.summaryOpenQuestions")}</h3>
      <CitedPoints meetingId={meetingId} points={questions} />
    </div>
  );
}
