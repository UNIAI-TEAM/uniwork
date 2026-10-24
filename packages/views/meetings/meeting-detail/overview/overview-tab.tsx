"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNotes } from "@uniwork/core/meetings";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { ActionItemsBoard } from "../close-out/action-items-board";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { NotesFeed } from "../live/notes-feed";
import { HistoryDrawer } from "../rail/history-drawer";
import { showsHistoryLink } from "../rail/rail-model";
import { Section } from "../ui/section";
import { TimeGutterRow } from "../ui/time-row";
import { OverviewRecap, RecapSection, recapDrawn } from "./overview-recap";
import { OverviewSummary, useOverviewSummary, type OverviewSummaryModel } from "./overview-summary";

// The first section sits 40 under the tabs on a wide page (kit `.tabs + .section`); on a phone every section is 24 apart (kit `.phone .section`),
// important over Section's `first:mt-8`, whose :first-child outranks a plain container-query class.
// Việc cần làm (close-out's board, kit `.sh-end` + `.pgroup-h`): its heading control keeps a 44 hit area without
// growing the 24 row, and on a phone the owner groups sit 12 apart.
const COLUMN = [
  "flex min-w-0 flex-col pt-2 @max-[37.5rem]/meeting:pt-0 @max-[37.5rem]/meeting:[&>section]:mt-6!",
  "pointer-coarse:[&>#action-items>div:first-child>div]:-my-2.5",
  "@max-[37.5rem]/meeting:[&>#action-items>div:last-child>div:first-child>div+div]:mt-3",
].join(" ");
// The summary sits in a `contents` wrapper, so it carries the same phone margin itself (overview-summary.tsx).

/** Phone: Ghi chú as a closed row of the recap accordion (PhoneAfter); a load error keeps the section and its retry. */
function PhoneNotes() {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const { data, isError } = useNotes(meeting.id);
  if (isError) return <NotesFeed variant="overview" />;
  if (!data?.length) return null;
  // shortcut: mirrors NotesFeed's NoteRows (author only when it changes); use it once live/notes-feed.tsx exports it.
  return (
    <RecapSection id="ghi-chu" title={t("meetings.detail.notes.title")} count={data.length}>
      <ol className="flex flex-col gap-2">
        {data.map((note, i) => {
          const changed = i === 0 || data[i - 1]!.author_id !== note.author_id;
          return (
            <TimeGutterRow
              key={note.id}
              time={clock(note.created_at)}
              author={changed ? note.display_name?.trim() || t("meetings.formerMember") : undefined}
              className={changed && i > 0 ? "mt-2" : undefined}
            >
              <span className="break-words whitespace-pre-wrap">{note.body}</span>
            </TimeGutterRow>
          );
        })}
      </ol>
    </RecapSection>
  );
}

/** Phone: "Lịch sử thao tác ›", the last row of the accordion; a phone draws only the rail's properties, not its history link. */
function PhoneHistoryRow() {
  const { t } = useTranslation();
  const { displayStatus, viewer, isClerk } = useDetail();
  const [open, setOpen] = useState(false);
  if (!showsHistoryLink(displayStatus, viewer, isClerk)) return null;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-13 w-full items-center gap-2 rounded-sm text-left"
      >
        <span className="text-body">{t("meetings.activity")}</span>
        <ChevronRight aria-hidden className="ml-auto size-4 text-muted-foreground" />
      </button>
      <HistoryDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}

const ITEMS_LATER = {
  running: "meetings.detail.overview.itemsAfterRunning",
  none: "meetings.detail.overview.itemsAfterNone",
  failed: "meetings.detail.overview.itemsAfterFailed",
} as const;

/** Việc cần làm: C's board, or — while no summary has proposed any — one line saying when they come. */
function ActionItems({ model }: { model: OverviewSummaryModel | null }) {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const items = useMeetingActionItems(meeting.id).data;
  const state = model?.state;
  const waiting = state === "running" || state === "none" || state === "failed";
  if (waiting && model?.gen.aiOn !== false && items?.items.length === 0) {
    return <Section id="action-items" title={t("meetings.detail.overview.itemsTitle")} count={t(ITEMS_LATER[state])} />;
  }
  return <ActionItemsBoard />;
}

/**
 * Tổng quan of an ended meeting (brief §4.9, AfterAIStates): Tóm tắt →
 * Việc cần làm → Quyết định → Câu hỏi còn mở → Chủ đề → Ghi chú; a section
 * with nothing in it is not drawn. With the scribe off and no summary, the
 * notes lead. An outsider sees the assigned work only.
 */
export function OverviewTab() {
  const { sections } = useDetail();
  if (!sections.ai) {
    return (
      <div className={COLUMN}>
        {sections.actionItems ? <ActionItemsBoard /> : null}
        {sections.notes ? <NotesFeed variant="overview" /> : null}
      </div>
    );
  }
  return <OverviewWithSummary />;
}

function OverviewWithSummary() {
  const { sections, isPhone } = useDetail();
  const model = useOverviewSummary();
  const notes = sections.notes ? <NotesFeed variant="overview" /> : null;
  const items = sections.actionItems ? <ActionItems model={model} /> : null;
  if (model.state === "off") {
    return (
      <div className={COLUMN}>
        {notes}
        {items}
        <OverviewRecap summary={null} voted={model.gen.voted} />
      </div>
    );
  }
  return (
    <div className={COLUMN}>
      <OverviewSummary model={model} />
      {items}
      <OverviewRecap summary={model.gen.summary} voted={model.gen.voted}>
        {/* A phone folds the notes and the history into the recap's accordion (PhoneAfter); with no recap the notes stay open (AfterAIStates). */}
        {isPhone && recapDrawn(model.gen.summary, model.gen.voted) ? (
          <>
            {sections.notes ? <PhoneNotes /> : null}
            <PhoneHistoryRow />
          </>
        ) : (
          notes
        )}
      </OverviewRecap>
    </div>
  );
}
