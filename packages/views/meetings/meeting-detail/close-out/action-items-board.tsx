"use client";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingActionItems, type MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { useProject } from "@uniwork/core/tasks";
import { CreateTaskDialog } from "../../../tasks/create-task-dialog";
import { useActionItemConversion } from "../../meeting-action-items/use-action-item-conversion";
import { MeetingRowsSkeleton, MeetingSectionError } from "../../meeting-section-state";
import { useDetail } from "../detail-context";
import { Byline, Section } from "../ui/section";
import { TextButton } from "../ui/text-button";
import { PendingItemRow, RowMenu, useDueWords } from "./action-item-row";
import { ConvertedFold, DismissDialog, DismissedFold, GroupHeader, groupMeta, MemberItems, OutsiderItems } from "./board-parts";
import { earliestDue, FLAT_AFTER_OWNERS, GROUP_ROWS, ownerGroups, ownerOf } from "./owner-groups";
import { ReviewSheet } from "./review-sheet";
import { SelectionBar } from "./selection-bar";
import { useCloseOut } from "./use-close-out";
import { ScribeSign } from "../../scribe-sign";

const NO_ITEMS: readonly MeetingActionItem[] = [];
/** The anchor the strip's "Rà và giao" and the rail outline scroll to. */
export const ACTION_ITEMS_ANCHOR = "action-items";

/**
 * "Việc cần làm" on the ended overview (brief §2, AfterAssign): a clerk
 * reviews and assigns, a member reads its own and everyone's, an outsider
 * sees only what was handed out. Counts are never shown to an outsider.
 */
export function ActionItemsBoard() {
  const { t } = useTranslation();
  const { meeting, viewer, isClerk, aiReadable } = useDetail();
  const query = useMeetingActionItems(meeting.id);
  const all = query.data?.items ?? NO_ITEMS;
  const outsider = viewer === "outsider" || !aiReadable;

  if (query.isPending || (query.isError && !query.data)) {
    return (
      <Section id={ACTION_ITEMS_ANCHOR} title={t("meetings.detail.closeOut.heading")}>
        {query.isPending ? (
          <MeetingRowsSkeleton rows={3} rowClassName="px-0" />
        ) : (
          <MeetingSectionError message={t("meetings.actionItemsSection.loadFailed")} onRetry={() => void query.refetch()} />
        )}
      </Section>
    );
  }
  // Kept on the client too, so an older server's full list never reaches an outsider.
  if (outsider) return <OutsiderItems items={all.filter((item) => item.status === "CONVERTED")} />;
  if (!isClerk) return <MemberItems items={all} />;
  return <ClerkBoard items={all} />;
}

function ClerkBoard({ items }: { items: readonly MeetingActionItem[] }) {
  const { t } = useTranslation();
  const { workspaceId, meeting, isPhone, memberIndex } = useDetail();
  const closeOut = useCloseOut(items);
  const due = useDueWords();
  const { data: project } = useProject(workspaceId, meeting.project_id || "");
  const flow = useActionItemConversion({ workspaceId, meetingId: meeting.id, projectId: project?.id, items, announce: () => {} });
  const addRef = useRef<HTMLButtonElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dismissing, setDismissing] = useState<MeetingActionItem | null>(null);

  const groups = ownerGroups(items);
  const pending = items.filter((item) => item.status === "PENDING");
  const converted = items.filter((item) => item.status === "CONVERTED");
  const done = converted.filter((item) => item.task?.done).length;
  const aiCount = items.filter((item) => item.source !== "MANUAL").length;
  const flat = groups.length > FLAT_AFTER_OWNERS;
  const canTick = !isPhone || selecting;
  const allTicked = pending.length > 0 && closeOut.picked.length === pending.length;
  const nameOf = (id: string) => memberIndex.memberOf(id)?.display_name ?? t("meetings.detail.closeOut.ownerNone");
  // Behind the open sheet the selection controls sit after their counts, so they stay left of it (AfterAssign).
  const besideSheet = closeOut.reviewOpen && !isPhone;

  // The review shows the list from its heading, as the clerk returns to it (AfterAssign).
  useEffect(() => {
    if (closeOut.reviewOpen) document.getElementById(ACTION_ITEMS_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [closeOut.reviewOpen]);

  const count = [
    pending.length > 0 ? t(isPhone ? "meetings.detail.closeOut.countPendingShort" : "meetings.detail.closeOut.countPending", { count: pending.length }) : null,
    converted.length > 0 ? t("meetings.detail.closeOut.countAssigned", { count: converted.length }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const selectAll = (
    <TextButton onClick={() => closeOut.setMany(pending.map((p) => p.id), !allTicked)}>
      {allTicked
        ? t("meetings.detail.closeOut.clearAll", { count: pending.length })
        : t("meetings.detail.closeOut.selectAll", { count: pending.length })}
    </TextButton>
  );
  const end =
    pending.length === 0 ? null : !isPhone ? (
      selectAll
    ) : selecting ? (
      <span className="flex gap-3">
        {selectAll}
        <TextButton
          onClick={() => {
            setSelecting(false);
            closeOut.clear();
          }}
        >
          {t("common.cancel")}
        </TextButton>
      </span>
    ) : (
      <TextButton onClick={() => setSelecting(true)}>{t("meetings.detail.closeOut.select")}</TextButton>
    );

  const row = (item: MeetingActionItem) => (
    <PendingItemRow
      key={item.id}
      item={item}
      values={closeOut.valuesOf(item)}
      phone={isPhone}
      ticked={canTick ? closeOut.isTicked(item.id) : undefined}
      onTick={canTick ? (on) => closeOut.toggle(item.id, on) : undefined}
      onOverride={(patch) => closeOut.setOverride(item.id, patch)}
      onOpen={() => flow.edit(item.id)}
      menu={<RowMenu onEdit={() => flow.edit(item.id)} onDismiss={() => setDismissing(item)} />}
    />
  );

  const picked = closeOut.picked;
  const people = new Set(picked.map((item) => closeOut.valuesOf(item).assignee_id).filter(Boolean)).size;
  const earliest = due(earliestDue(picked.map((item) => closeOut.valuesOf(item).due_date)));

  return (
    <Section
      id={ACTION_ITEMS_ANCHOR}
      title={t("meetings.detail.closeOut.heading")}
      count={count || undefined}
      end={end}
      className={besideSheet ? "[&>div:first-child>div]:ml-4" : undefined}
      byline={
        aiCount > 0 ? (
          <Byline>
            {/* Kit `.byline`: the scribe's mark, then the words in their own span. */}
            <ScribeSign />
            <span>
              {pending.length > 0
                ? t("meetings.detail.closeOut.bylineClerk", { count: aiCount })
                : t("meetings.detail.closeOut.bylineRead", { count: aiCount })}
            </span>
          </Byline>
        ) : null
      }
    >
      {items.length === 0 ? <p className="text-body text-muted-foreground">{t("meetings.actionItemsSection.empty")}</p> : null}
      {/* The list owns the keys (brief: ↑/↓, ⌘/Ctrl+Enter); Space is each checkbox's own. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- arrow keys delegate to the rows' checkboxes */}
      <div className="flex flex-col" onKeyDown={closeOut.onListKeyDown}>
        {flat ? (
          <ul className="flex flex-col">{[...pending].sort((a, b) => nameOf(ownerOf(a)).localeCompare(nameOf(ownerOf(b)))).map(row)}</ul>
        ) : (
          groups.map((group) => {
            const ids = group.pending.map((p) => p.id);
            const groupTicked = ids.length > 0 && ids.every((id) => closeOut.isTicked(id));
            const open = expanded.has(group.ownerId);
            const shown = open ? group.pending : group.pending.slice(0, GROUP_ROWS);
            return (
              <div key={group.ownerId} className="mt-2 flex flex-col first:mt-0">
                <GroupHeader label={groupMeta(t, nameOf(group.ownerId), group)} className={besideSheet ? "justify-start" : undefined}>
                  {ids.length > 0 && canTick ? (
                    <TextButton onClick={() => closeOut.setMany(ids, !groupTicked)}>
                      {t(groupTicked ? "meetings.detail.closeOut.clearGroup" : "meetings.detail.closeOut.selectGroup")}
                    </TextButton>
                  ) : null}
                </GroupHeader>
                {shown.length > 0 ? (
                  <ul aria-label={t("meetings.detail.closeOut.groupLabel", { name: nameOf(group.ownerId) })} className="flex flex-col">
                    {shown.map(row)}
                  </ul>
                ) : null}
                {group.pending.length > shown.length ? (
                  <TextButton className="ml-7" onClick={() => setExpanded((prev) => new Set(prev).add(group.ownerId))}>
                    {t("meetings.detail.closeOut.moreInGroup", { count: group.pending.length - shown.length, name: nameOf(group.ownerId) })}
                  </TextButton>
                ) : null}
                {!isPhone && group.converted.length > 0 ? <ConvertedFold items={group.converted} done={group.done} /> : null}
              </div>
            );
          })
        )}
        {(isPhone || flat) && converted.length > 0 ? <ConvertedFold items={converted} done={done} /> : null}
        <button
          ref={addRef}
          type="button"
          onClick={() => flow.setComposerOpen(true)}
          className="-mx-2 mt-1 inline-flex h-9 items-center gap-3 self-start rounded-md pr-2.5 pl-2 text-body font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground pointer-coarse:h-11 @max-[37.5rem]/meeting:mt-0 @max-[37.5rem]/meeting:h-11"
        >
          <Plus aria-hidden className="size-4" />
          {t("meetings.detail.closeOut.add")}
        </button>
        <DismissedFold items={items.filter((item) => item.status === "DISMISSED")} canRestore />
      </div>
      {picked.length > 0 ? (
        <SelectionBar
          count={picked.length}
          people={people}
          earliest={earliest}
          phone={isPhone}
          besideSheet={besideSheet}
          onClear={closeOut.clear}
          onReview={() => closeOut.setReviewOpen(true)}
        />
      ) : null}
      <ReviewSheet
        closeOut={closeOut}
        projectId={project?.id}
        projectTitle={project?.title}
        allItems={items}
        onAssigned={() => {
          setSelecting(false);
          addRef.current?.focus();
        }}
      />
      <DismissDialog item={dismissing} onClose={() => setDismissing(null)} />
      {/* The task screen's own composer: "Sửa…" opens an item's values, "Thêm việc" a blank one. */}
      <CreateTaskDialog
        workspaceId={workspaceId}
        open={flow.composerOpen}
        onOpenChange={flow.setComposerOpen}
        showTrigger={false}
        defaults={flow.composerDefaults}
        submitter={flow.submitter}
        heading={t("meetings.actionItemsSection.addHeading")}
        finalFocus={addRef}
      />
    </Section>
  );
}
