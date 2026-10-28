"use client";
import { useState } from "react";
import { ChevronRight, ListChecks, RotateCcwClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNotes } from "@uniwork/core/meetings";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { ActionItemsBoard } from "../close-out/action-items-board";
import { useDetail } from "../detail-context";
import { NoteRows, NotesFeed } from "../live/notes-feed";
import { HistoryDrawer } from "../rail/history-drawer";
import { showsHistoryLink } from "../rail/rail-model";
import { Section } from "../ui/section";
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
  return (
    <RecapSection id="ghi-chu" title={t("meetings.detail.notes.title")} count={data.length}>
      <NoteRows notes={data} />
    </RecapSection>
  );
}

/** Phone: "Lịch sử thao tác ›", the last row of the accordion; a phone draws only the rail's properties, not its history link. */
function PhoneHistoryRow() {
  const { t } = useTranslation();
  const { viewer } = useDetail();
  const [open, setOpen] = useState(false);
  if (!showsHistoryLink(viewer)) return null;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-13 w-full items-center gap-2 rounded-sm text-left"
      >
        <RotateCcwClock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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
  transcribing: "meetings.detail.overview.itemsAfterTranscribing",
} as const;

/** Việc cần làm: C's board, or — while no summary has proposed any — a quiet placeholder saying when they come. */
function ActionItems({ model }: { model: OverviewSummaryModel | null }) {
  const { t } = useTranslation();
  const { meeting, transcribing } = useDetail();
  const items = useMeetingActionItems(meeting.id).data;
  const state = model?.state;
  const waiting = state === "running" || state === "none" || state === "failed";
  if (waiting && model?.gen.aiOn !== false && items?.items.length === 0) {
    return (
      <Section id="action-items" title={t("meetings.detail.overview.itemsTitle")}>
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
          <IconTile icon={ListChecks} size="sm" tone="muted" />
          <p className="text-body text-muted-foreground">{t(ITEMS_LATER[transcribing ? "transcribing" : state])}</p>
        </div>
      </Section>
    );
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
