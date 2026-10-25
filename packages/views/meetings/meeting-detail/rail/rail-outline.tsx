"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useNotes } from "@uniwork/core/meetings";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { useMeetingSummary, useMeetingSummaryRun } from "@uniwork/core/meetings/summary";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { DETAIL_SCROLLER_ID } from "../layout";
import { useChapterTitle, useTranscriptChapters } from "../transcript/chapter-bar";
import { chapterAnchor } from "../transcript/transcript-list";
import { OutlineRow, RailGroup } from "../ui/rail";

type Entry = { id: string; label: ReactNode; count?: ReactNode };

/** Where a section counts as being read: its top above this share of the viewport. */
const SPY_LINE = 0.3;

/**
 * The tab's top-level sections as the page draws them, in order: the anchor
 * id, the heading's title (its first span when the heading is a button) and
 * the count printed beside the heading.
 */
function scanSections(root: ParentNode): Entry[] {
  return [...root.querySelectorAll<HTMLElement>("section[id]")]
    .filter((el) => !el.closest("aside, [role=dialog]") && !el.parentElement?.closest("section[id]"))
    .flatMap((el) => {
      const heading = el.querySelector("h2");
      if (!heading) return [];
      const label = ((heading.querySelector("span") ?? heading).textContent ?? "").trim();
      const next = heading.nextElementSibling;
      const count = next?.tagName === "SPAN" ? (next.textContent ?? "").trim() : "";
      return label ? [{ id: el.id, label, count: count || undefined }] : [];
    });
}

/**
 * The minutes document's sections (`section[data-outline]`) with the count the
 * rail prints (AfterMinutes): the topics under "Nội dung", an attendance ratio
 * ("3/3") in the first paragraph, else the rows of its list or table.
 */
function scanMinutes(root: ParentNode, topics: (count: number) => string): Entry[] {
  return [...root.querySelectorAll<HTMLElement>("section[data-outline]")].map((el) => {
    const ratio = /\b\d+\/\d+\b/.exec(el.querySelector("p")?.textContent ?? "")?.[0];
    const h4 = el.querySelectorAll("h4").length;
    const rows = el.querySelectorAll("li, tbody tr").length;
    const count = h4 ? topics(h4) : (ratio ?? (rows ? String(rows) : undefined));
    return { id: el.id, label: el.dataset.outline ?? "", count };
  });
}

/** The overview's counts in the rail's words (Main, AfterMember, AfterAIStates). */
function useOverviewCounts(on: boolean): Record<string, string | undefined> {
  const { t } = useTranslation();
  const { meeting, isClerk } = useDetail();
  const me = useAuthStore((s) => s.user?.id);
  const id = on ? meeting.id : "";
  const summary = useMeetingSummary(id).data;
  const running = (useMeetingSummaryRun(id).data?.status ?? "idle") !== "idle";
  const items = useMeetingActionItems(id).data;
  const notes = useNotes(id).data;
  const open = (items?.items ?? []).filter((i) => i.status !== "DISMISSED");
  const pending = items?.counts.pending ?? 0;
  const converted = items?.counts.converted ?? 0;
  const mine = open.filter((i) => (i.task?.assignee_id ?? i.suggested_assignee_id) === me).length;
  const itemsCount = !items
    ? undefined
    : open.length === 0
      ? running
        ? undefined
        : t("meetings.detail.rail.outlineNone")
      : isClerk || mine === 0
        ? t("meetings.detail.rail.outlineItems", { pending, converted })
        : t("meetings.detail.rail.outlineItemsMine", { mine, total: pending + converted });
  const n = (list: readonly unknown[] | null | undefined) => (list?.length ? String(list.length) : undefined);
  return {
    summary: !summary && running ? t("meetings.detail.rail.outlineDrafting") : undefined,
    "action-items": itemsCount,
    decisions: n(summary?.decisions),
    "open-questions": n(summary?.open_questions),
    topics: n(summary?.topics),
    "ghi-chu": n(notes),
  };
}

/**
 * "Trên trang này" (kit `.ol`): the open tab's sections with their counts,
 * the one being read ticked (scroll-spy); on the transcript tab, "Chương"
 * with each chapter's start and lines. Hidden in the panel and below 1200.
 */
export function RailOutline() {
  const { t } = useTranslation();
  const { meeting, tabs, displayStatus, sections: flags } = useDetail();
  const tab = tabs.current;
  const counts = useOverviewCounts(tab === "overview");
  // The scribe was on but no summary is there or being made (AfterAIStates c2 none, c3 failed): no outline.
  // With the scribe off (c4) the overview keeps its outline of notes and items.
  const summaryId = tab === "overview" && flags.ai && meeting.scribe_enabled !== false ? meeting.id : "";
  const summary = useMeetingSummary(summaryId);
  const summaryRun = useMeetingSummaryRun(summaryId).data?.status ?? "idle";
  const noSummary = summary.isSuccess && !summary.data && summaryRun === "idle";
  const chapters = useTranscriptChapters(meeting, tab === "transcript");
  // The transcript failed (LoadingError c3): the chapters stay as a map, but no line is being read.
  const transcriptFailed = useFullTranscript(meeting.id, tab === "transcript" && displayStatus === "ENDED").isError;
  const chapterTitle = useChapterTitle();
  const [sections, setSections] = useState<Entry[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  // The sections come and go with their data: read them again when the page changes.
  useEffect(() => {
    if (tab === "transcript") return;
    const root = document.querySelector("[data-testid=meeting-detail-content]") ?? document.body;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = tab === "minutes" ? scanMinutes(root, (count) => t("meetings.detail.rail.outlineTopics", { count })) : scanSections(root);
        setSections((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [tab, t]);

  const entries: Entry[] =
    tab === "transcript"
      ? chapters.map((c) => ({
          id: chapterAnchor(c.key),
          // A topic title is its own run (kit `.ol-t`); the opening chapter stays plain text of the row.
          label: c.title ? <span>{chapterTitle(c)}</span> : chapterTitle(c),
          count: (
            <>
              <time className="font-mono font-medium">{clock(new Date(c.startMs).toISOString())}</time>
              {/* No count while the transcript is loading or failed (LoadingError c3): the time alone. */}
              {c.count === null ? null : ` · ${t("meetings.detail.rail.lines", { count: c.count })}`}
            </>
          ),
        }))
      : sections.map((s) => (tab === "overview" ? { ...s, count: counts[s.id] } : s));
  const ids = entries.map((e) => e.id).join(" ");

  // Scroll-spy: the last section whose top has passed the line, else the first.
  useEffect(() => {
    if (!ids) return;
    const list = ids.split(" ");
    let frame = 0;
    const spy = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = window.innerHeight * SPY_LINE;
        // At the top of the page the first section is the one being read, however tall the screen;
        // a section the page does not draw (folded by the transcript search) is never picked.
        const drawn = list.filter((id) => document.getElementById(id));
        let pick = drawn[0] ?? list[0]!;
        if ((document.getElementById(DETAIL_SCROLLER_ID)?.scrollTop ?? Infinity) < 4) {
          setCurrent(pick);
          return;
        }
        for (const id of list) {
          const top = document.getElementById(id)?.getBoundingClientRect().top;
          if (top !== undefined && top <= line) pick = id;
        }
        setCurrent(pick);
      });
    };
    spy();
    document.addEventListener("scroll", spy, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", spy, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  if (!tab || entries.length === 0 || (tab === "overview" && noSummary)) return null;
  return (
    <RailGroup nav label={t(tab === "transcript" ? "meetings.detail.rail.chapters" : "meetings.detail.rail.onThisPage")}>
      {entries.map((e) => (
        <OutlineRow
          key={e.id}
          href={`#${e.id}`}
          current={!(tab === "transcript" && transcriptFailed) && e.id === (current ?? entries[0]!.id)}
          count={e.count}
          // The anchor scrolls (sections carry scroll-mt); the tick moves at once.
          onClick={() => setCurrent(e.id)}
        >
          {e.label}
        </OutlineRow>
      ))}
    </RailGroup>
  );
}
