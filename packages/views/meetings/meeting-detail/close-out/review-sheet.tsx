"use client";
import { ChevronDown, CircleAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useConvertMeetingActionItems,
  useLinkMeetingActionItem,
  type MeetingActionItem,
} from "@uniwork/core/meetings/action-items";
import { useMeetingEvidenceOf } from "@uniwork/core/meetings/summary";
import { actionItemTaskDefaults, convertActionItemInput } from "@uniwork/core/meetings/summary-task-items";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../../common/date-field";
import { PriorityPicker } from "../../../tasks/pickers/priority-picker";
import { PriorityIcon } from "../../../tasks/icons/priority-icon";
import { SearchableOptionPicker } from "../../../tasks/pickers/searchable-option-picker";
import { duplicateLinkTarget } from "../../meeting-action-items/duplicate-link";
import { actionItemTaskDescription } from "../../meeting-action-items/action-item-task-description";
import { meetingLocale } from "../../meeting-datetime";
import { summaryErrorText } from "../../meeting-summary/summary-error-copy";
import { useDetail } from "../detail-context";
import { EvidenceTimeChip } from "../overview/evidence-chip";
import { kitButton } from "../ui/kit-buttons";
import { NoticeLine } from "../ui/notice-line";
import { SideSheet } from "../ui/overlay";
import { PersonTag, useDueWords } from "./action-item-row";
import { recipients } from "./owner-groups";
import type { CloseOut } from "./use-close-out";

const CELL =
  "-ml-2 inline-flex h-8 max-w-full items-center justify-start gap-1 overflow-visible [&_svg]:shrink-0 rounded-md border border-transparent px-2 text-label font-medium whitespace-nowrap text-foreground hover:border-input hover:bg-transparent max-[37.5rem]:ml-0 max-[37.5rem]:h-11 max-[37.5rem]:border-border";
const CHEV = "[&>svg:last-child]:size-3 [&>svg:last-child]:text-faint-foreground";

/**
 * The review sheet (kit `.sheet-r` 560, brief "Review sheet"): every picked
 * row with its owner, due date and priority, editable in place, grouped by
 * who receives it; guessed due dates flagged twice. [Giao n việc] is the only
 * way a task is made (ADR 0010: agents propose, humans confirm). A refusal
 * stays in the sheet; success closes it and hands the new tasks to the dock, with its undo.
 */
export function ReviewSheet({
  closeOut,
  projectId,
  projectTitle,
  allItems,
  onAssigned,
}: {
  closeOut: CloseOut;
  /** The meeting's project while it exists: the tasks start there. */
  projectId?: string;
  projectTitle?: string;
  allItems: readonly MeetingActionItem[];
  onAssigned: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { workspaceId, meeting, memberIndex } = useDetail();
  const due = useDueWords();
  const convert = useConvertMeetingActionItems(workspaceId, meeting.id);
  const link = useLinkMeetingActionItem(workspaceId, meeting.id);
  const [error, setError] = useState<{ text: string; link?: { itemId: string; taskId: string } } | null>(null);
  const open = closeOut.reviewOpen;
  const rows = closeOut.picked;
  const evidence = useMeetingEvidenceOf(meeting.id, rows, open);
  const values = new Map(rows.map((item) => [item.id, closeOut.valuesOf(item)]));
  const owners = recipients(rows.map((item) => values.get(item.id)?.assignee_id ?? ""));
  const guessed = rows.filter((item) => values.get(item.id)?.guessed);
  const busy = convert.isPending || link.isPending || (rows.length > 0 && !evidence.settled);
  const nameOf = (id: string) => memberIndex.memberOf(id)?.display_name ?? t("meetings.detail.closeOut.ownerNone");
  const memberOptions = memberIndex.members.map((m) => ({ value: m.user_id, label: m.display_name }));

  function close(next: boolean) {
    closeOut.setReviewOpen(next);
    if (!next) setError(null);
  }

  function assign() {
    if (busy || rows.length === 0) return;
    setError(null);
    const locale = meetingLocale(i18n.language);
    const items = rows.map((item, i) => {
      const v = values.get(item.id)!;
      const description = actionItemTaskDescription(item, evidence.lines[i] ?? [], t, locale);
      return convertActionItemInput(item.id, {
        ...actionItemTaskDefaults(item, projectId, description),
        title: item.title,
        assignee_id: v.assignee_id,
        due_date: v.due_date,
        priority: v.priority,
      });
    });
    convert.mutate(
      { items, locale: i18n.language.startsWith("en") ? "en" : "vi" },
      {
        onSuccess: (result) => {
          close(false);
          closeOut.clear();
          onAssigned();
          // The dock says it, with Hoàn tác for the ids the server made tasks of.
          if (result) closeOut.markAssigned(result.links.map((l) => l.action_item_id));
          else toast.warning(t("meetings.summaryAi.createdUnknown"), { position: "bottom-center" });
        },
        onError: (err) => setError({ text: summaryErrorText(err, t, "tasks", { items: allItems }), link: duplicateLinkTarget(err) ?? undefined }),
      },
    );
  }

  function linkToTask(target: { itemId: string; taskId: string }) {
    link.mutate(target, {
      onSuccess: () => {
        closeOut.toggle(target.itemId, false);
        setError(null);
        toast.success(t("meetings.actionItemsSection.linkedStatus"), { position: "bottom-center" });
      },
      onError: (err) => setError({ text: summaryErrorText(err, t, "tasks", { items: allItems }) }),
    });
  }

  const title = projectTitle
    ? t("meetings.detail.closeOut.reviewTitle", { count: rows.length, project: projectTitle })
    : t("meetings.detail.closeOut.reviewTitleNoProject", { count: rows.length });

  return (
    <SideSheet
      open={open}
      onOpenChange={close}
      width={560}
      title={<span className="text-balance">{title}</span>}
      className="max-[37.5rem]:rounded-none [&>div:nth-last-child(1)]:h-auto [&>div:nth-last-child(1)]:justify-between [&>div:nth-last-child(1)]:gap-6 [&>div:nth-last-child(1)]:py-4 max-[37.5rem]:[&>div:nth-last-child(1)]:flex-col max-[37.5rem]:[&>div:nth-last-child(1)]:items-stretch max-[37.5rem]:[&>div:nth-last-child(1)]:gap-3"
      footer={
        <>
          <p className="max-w-75 text-caption text-muted-foreground max-[37.5rem]:max-w-none">
            {t("meetings.detail.closeOut.reviewFoot", {
              list: owners.map((o) => `${nameOf(o.ownerId)} (${o.count})`).join(", "),
            })}
          </p>
          <div className="flex flex-none gap-2">
            <Button type="button" variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost, "max-[37.5rem]:h-11 max-[37.5rem]:flex-1")} onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="brand"
              size="lg"
              className={cn(kitButton.base, "max-[37.5rem]:h-11 max-[37.5rem]:flex-1")}
              aria-disabled={busy || rows.length === 0 || undefined}
              aria-busy={busy || undefined}
              onClick={assign}
            >
              {convert.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("meetings.detail.closeOut.reviewConfirm", { count: rows.length })}
            </Button>
          </div>
        </>
      }
    >
      <div className="pt-1">
        {error ? (
          <NoticeLine tone="destructive" icon={CircleAlert} role="alert" className="mb-4">
            {error.text}
            {error.link ? (
              <Button type="button" variant="link" className="ml-1 h-auto p-0 text-body" onClick={() => linkToTask(error.link!)}>
                {t("meetings.actionItemsSection.linkToOpenTask")}
              </Button>
            ) : null}
          </NoticeLine>
        ) : null}
        {guessed.length > 0 ? (
          <div>
            <NoticeLine tone="warning" icon={TriangleAlert}>
              <span className="block font-medium text-balance">{t("meetings.detail.closeOut.guessNotice", { count: guessed.length })}</span>
            </NoticeLine>
            <ul className="mt-1.5 flex flex-col gap-0.5 pl-6">
              {guessed.map((item) => (
                <li key={item.id} className="grid grid-cols-[44px_minmax(0,1fr)] items-start text-caption leading-5 text-muted-foreground">
                  <span className="-ml-1.5 grid">
                    {item.evidence.length > 0 ? <EvidenceTimeChip meetingId={meeting.id} refs={item.evidence} /> : null}
                  </span>
                  <span className="min-w-0 truncate">
                    <q className="text-foreground">{item.due_text?.trim()}</q>
                    {/* The latin subset of Inter lacks U+2192 (it falls back to a long system arrow); Inter's `calt` draws "->" as its own arrow. */}
                    {" "}
                    <span aria-hidden>{"->"}</span>
                    <span className="sr-only">→</span>
                    {` ${due(values.get(item.id)?.due_date)} · ${item.title}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <table className="mt-5 w-full table-fixed border-collapse max-[37.5rem]:block">
          <caption className="sr-only">{t("meetings.detail.closeOut.reviewCaption", { count: rows.length })}</caption>
          <thead className="max-[37.5rem]:sr-only">
            <tr className="text-left text-caption font-normal text-muted-foreground">
              <th scope="col" className="pr-2 pb-2 font-normal">{t("meetings.detail.closeOut.colItem")}</th>
              <th scope="col" className="w-21 pr-2 pb-2 font-normal">{t("meetings.detail.closeOut.colOwner")}</th>
              <th scope="col" className="w-28 pr-2 pb-2 font-normal">{t("meetings.detail.closeOut.colDue")}</th>
              <th scope="col" className="w-16 pb-2 font-normal">{t("meetings.detail.closeOut.colPriority")}</th>
            </tr>
          </thead>
          {owners.map((owner, gi) => (
            <tbody key={owner.ownerId} className="max-[37.5rem]:block">
              <tr className="max-[37.5rem]:block max-[37.5rem]:pt-4">
                <td colSpan={4} className={cn("pb-1.5 text-caption font-medium text-muted-foreground max-[37.5rem]:pb-0", gi === 0 ? "pt-1" : "pt-4 max-[37.5rem]:pt-0")}>
                  <span className="flex items-center gap-2">
                    {owner.ownerId ? <PersonTag userId={owner.ownerId} className="[&>span:last-child]:hidden" /> : null}
                    {t("meetings.detail.closeOut.reviewGroup", { name: nameOf(owner.ownerId), count: owner.count })}
                  </span>
                </td>
              </tr>
              {rows
                .filter((item) => (values.get(item.id)?.assignee_id ?? "") === owner.ownerId)
                .map((item) => {
                  const v = values.get(item.id)!;
                  const date = due(v.due_date);
                  const said = item.due_text?.trim() ?? "";
                  const ownerName = memberIndex.memberOf(v.assignee_id)?.display_name;
                  return (
                    <tr key={item.id} className="group/rv hover:bg-surface-hover max-[37.5rem]:flex max-[37.5rem]:flex-wrap max-[37.5rem]:items-center max-[37.5rem]:gap-x-2 max-[37.5rem]:gap-y-1 max-[37.5rem]:border-t max-[37.5rem]:border-border max-[37.5rem]:py-2.5">
                      <th scope="row" className="border-t border-border py-1.5 pr-3 text-left text-body font-normal text-pretty max-[37.5rem]:basis-full max-[37.5rem]:border-0 max-[37.5rem]:p-0 max-[37.5rem]:pb-0.5">
                        {item.title}
                      </th>
                      <td className="h-12 border-t border-border pr-2 max-[37.5rem]:h-auto max-[37.5rem]:border-0 max-[37.5rem]:pr-0">
                        <SearchableOptionPicker
                          value={v.assignee_id}
                          onChange={(id) => closeOut.setOverride(item.id, { assignee_id: id || null })}
                          options={memberOptions}
                          emptyOption={{ value: "", label: t("meetings.detail.closeOut.ownerNone") }}
                          ariaLabel={ownerName ? t("meetings.detail.closeOut.ownerLabel", { name: ownerName }) : t("meetings.detail.closeOut.ownerNoneLabel")}
                          searchPlaceholder={t("meetings.detail.closeOut.ownerSearch")}
                          noResultsLabel={t("meetings.detail.closeOut.ownerNoMatch")}
                          triggerClassName={cn(CELL, CHEV, !ownerName && "text-muted-foreground")}
                        >
                          {ownerName ? <PersonTag userId={v.assignee_id} short bare className="mr-0.5" /> : "—"}
                        </SearchableOptionPicker>
                      </td>
                      <td className="h-12 border-t border-border pr-2 max-[37.5rem]:h-auto max-[37.5rem]:border-0 max-[37.5rem]:pr-0">
                        <DateField
                          value={v.due_date ?? ""}
                          onChange={(d) => closeOut.setOverride(item.id, { due_date: d || null })}
                          ariaLabel={
                            v.guessed
                              ? t("meetings.detail.closeOut.dueGuessedLabel", { said, date })
                              : date
                                ? t("meetings.detail.closeOut.dueLabel", { date })
                                : t("meetings.detail.closeOut.dueNoneLabel")
                          }
                          triggerRender={
                            <button
                              type="button"
                              title={v.guessed ? t("meetings.detail.closeOut.dueGuessedTitle", { said, date }) : undefined}
                              className={cn(CELL, v.guessed && "bg-warning-soft text-warning-soft-foreground hover:border-transparent", !date && "text-muted-foreground")}
                            />
                          }
                          renderTrigger={() => (
                            <>
                              {v.guessed ? <TriangleAlert aria-hidden className="size-3" /> : null}
                              {date ? (v.guessed ? `~${date}` : date) : "—"}
                              <ChevronDown aria-hidden className={cn("size-3", v.guessed ? "text-warning" : "text-faint-foreground")} />
                            </>
                          )}
                        />
                      </td>
                      <td className="h-12 border-t border-border max-[37.5rem]:h-auto max-[37.5rem]:border-0">
                        <PriorityPicker
                          value={v.priority}
                          onChange={(p) => closeOut.setOverride(item.id, { priority: p })}
                          ariaLabel={t("meetings.detail.closeOut.colPriority")}
                          valueLabel={v.priority === "none" ? t("meetings.detail.closeOut.priorityUnset") : t(`tasks.priority_${v.priority}`)}
                          triggerClassName={cn(CELL, v.priority === "none" && "text-muted-foreground")}
                        >
                          {/* The task screen's own priority glyph, in its tint. */}
                          {v.priority === "none" ? null : <PriorityIcon priority={v.priority} className="size-3" />}
                          {v.priority === "none" ? "—" : t(`tasks.priority_${v.priority}`)}
                          <ChevronDown aria-hidden className="size-3 text-faint-foreground" />
                        </PriorityPicker>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          ))}
        </table>
      </div>
    </SideSheet>
  );
}
