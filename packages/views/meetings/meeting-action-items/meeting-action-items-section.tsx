"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import {
  useMeetingActionItems,
  useRestoreMeetingActionItem,
  type MeetingActionItem,
  type MeetingActionItemCounts,
} from "@uniwork/core/meetings/action-items";
import { paths } from "@uniwork/core/paths";
import { useProject } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { apiErrorCopy } from "../../api-error-copy";
import { MeetingSectionError, MeetingSectionLoading } from "../meeting-section-state";
import { SummaryLiveRegion, useAnnouncement } from "../meeting-summary/summary-generate-controls";
import { useMemberIndex } from "../use-member-index";
import { ConvertedRow, DismissedRow, LIST_CLASS, PendingRow, type ActionItemsVariant } from "./action-item-rows";
import { MeetingEvidenceChip } from "../meeting-evidence-chip";
import { ClerkPendingList, focusPendingRow, ROW_CHANGED_ELSEWHERE } from "./clerk-pending-list";
import { RoomConvertedRow, RoomGroupHeading, RoomPendingRow } from "./room-rows";
import { ActionItemsSelectionBar } from "./selection-bar";
import { useActionItemConversion, type ActionItemSelection } from "./use-action-item-conversion";

/** "2/5 done · 1 overdue", once anything is assigned; the groups carry their own counts. */
function ProgressLine({ counts }: { counts: MeetingActionItemCounts }) {
  const { t } = useTranslation();
  if (counts.converted === 0) return null;
  return (
    <p className="text-caption text-muted-foreground tabular-nums">
      {t("meetings.actionItemsSection.progress", { done: counts.tasks_done, total: counts.converted })}
      {counts.tasks_overdue > 0 ? (
        <>
          <span aria-hidden> · </span>
          <span className="font-medium text-destructive">
            {t("meetings.actionItemsSection.overdue", { count: counts.tasks_overdue })}
          </span>
        </>
      ) : null}
    </p>
  );
}

const NO_ITEMS: readonly MeetingActionItem[] = [];

function GroupHeading({ children }: { children: string }) {
  return <h3 className="mb-2 text-label font-semibold text-foreground">{children}</h3>;
}

/** Shaped like the rows it turns into: a tick, a title and a line under it. */
function RowsSkeleton() {
  return (
    <MeetingSectionLoading className="divide-y divide-border rounded-lg border border-border">
      {["w-48", "w-36"].map((w) => (
        <div key={w} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </MeetingSectionLoading>
  );
}

/**
 * "After the meeting" (spec meeting follow-through §9.2 item 1): the meeting's
 * action items in three groups — pending, assigned (with each task's state)
 * and dismissed (folded). A clerk (host, secretary, workspace admin) works the
 * pending list down; everyone else reads. This is the in-room Copilot's list;
 * the detail page reviews and assigns through meeting-detail/close-out.
 */
export function MeetingActionItemsSection({
  workspaceId,
  meetingId,
  projectId,
  canClerk,
  aiRestricted = false,
  variant = "compact",
  selection,
  editItemId,
  onEditHandled,
  onSelectionChange,
}: {
  workspaceId: string;
  meetingId: string;
  /** The meeting's project: new tasks start there while it still exists. */
  projectId?: string;
  canClerk: boolean;
  /**
   * The viewer may not read the meeting's AI content (meeting.ai_content_readable false):
   * only the tasks it handed out, which is all the server sends them, and no evidence chips.
   */
  aiRestricted?: boolean;
  /** `room`: the UNI tab's clerk list (ticks, chips, floating bar); `compact`: the Copilot's. */
  variant?: Extract<ActionItemsVariant, "compact" | "room">;
  /** Ticks kept by a screen that unmounts this section; else kept here. */
  selection?: ActionItemSelection;
  /** A pending item whose "Edit & assign" composer opens once the list is in; then `onEditHandled`. */
  editItemId?: string;
  onEditHandled?: () => void;
  /** How many items are ticked, so the room's shell can hide its composer under the bar. */
  onSelectionChange?: (count: number) => void;
}) {
  const { t } = useTranslation();
  const query = useMeetingActionItems(meetingId);
  const restore = useRestoreMeetingActionItem(meetingId);
  const { memberOf } = useMemberIndex(workspaceId);
  // A project deleted after the meeting was linked stays on the meeting row (no FK).
  const { data: project } = useProject(workspaceId, projectId || "");
  const workspace = useOptionalWorkspace()?.workspace;
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  // Sequenced, so a second identical "dismissed" is announced again.
  const [announcement, announce] = useAnnouncement();
  const [showDismissed, setShowDismissed] = useState(false);
  const [restoreError, setRestoreError] = useState<{ id: string; text: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // A restored row unmounts with its focused button: follow the item back to its pending row.
  const restoring = useRef<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const editHandled = useRef<string | undefined>(undefined);
  const room = variant === "room";

  const all = query.data?.items ?? NO_ITEMS;
  // Kept on the client too, so an older server's full list never reaches an outsider.
  const items = aiRestricted ? all.filter((item) => item.status === "CONVERTED") : all;
  const pending: MeetingActionItem[] = [];
  const converted: MeetingActionItem[] = [];
  const dismissed: MeetingActionItem[] = [];
  for (const item of items) {
    switch (item.status) {
      case "PENDING":
        pending.push(item);
        break;
      case "CONVERTED":
        converted.push(item);
        break;
      case "DISMISSED":
        dismissed.push(item);
        break;
      default:
        // A state a newer server adds is left out rather than guessed at.
        break;
    }
  }

  const flow = useActionItemConversion({ workspaceId, meetingId, projectId: project?.id, items, announce, selection });
  const picked = flow.pickedPending.length;

  const editable = canClerk && pending.some((item) => item.id === editItemId);
  useEffect(() => {
    if (!editItemId) {
      editHandled.current = undefined;
      return;
    }
    if (query.isPending || editHandled.current === editItemId) return;
    editHandled.current = editItemId;
    if (editable) flow.edit(editItemId);
    onEditHandled?.();
  }, [editItemId, query.isPending, editable, flow, onEditHandled]);

  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange(picked);
    return () => onSelectionChange(0);
  }, [picked, onSelectionChange]);

  useEffect(() => {
    const id = restoring.current;
    if (!id || items.some((item) => item.id === id && item.status === "DISMISSED")) return;
    restoring.current = null;
    focusPendingRow(bodyRef.current, id);
  }, [items]);

  const body = query.isPending ? (
    <RowsSkeleton />
  ) : query.isError && !query.data ? (
    <MeetingSectionError message={t("meetings.actionItemsSection.loadFailed")} onRetry={() => void query.refetch()} />
  ) : (
    <div ref={bodyRef} className="space-y-4" data-testid="meeting-action-items">
      {items.length > 0 && query.data && !room ? <ProgressLine counts={query.data.counts} /> : null}
      {aiRestricted ? (
        <p className="text-label text-muted-foreground">{t("meetings.actionItemsSection.restrictedNote")}</p>
      ) : null}
      {items.length === 0 && !canClerk && !aiRestricted ? (
        <p className="text-label text-muted-foreground">{t("meetings.actionItemsSection.emptyReadOnly")}</p>
      ) : null}
      {(canClerk && !aiRestricted) || pending.length > 0 ? (
        <section>
          {pending.length > 0 && room ? (
            <RoomGroupHeading
              pick={
                canClerk
                  ? { picked, total: pending.length, onPickAll: (on) => flow.pickOnly(on ? pending.map((p) => p.id) : []) }
                  : undefined
              }
            >
              {t("meetings.actionItemsSection.pendingGroup", { count: pending.length })}
            </RoomGroupHeading>
          ) : pending.length > 0 ? (
            <GroupHeading>{t("meetings.actionItemsSection.pendingGroup", { count: pending.length })}</GroupHeading>
          ) : null}
          {items.length === 0 ? (
            <p className="mb-2 text-label text-muted-foreground">{t("meetings.actionItemsSection.empty")}</p>
          ) : null}
          {canClerk ? (
            <ClerkPendingList
              workspaceId={workspaceId}
              meetingId={meetingId}
              items={items}
              pending={pending}
              variant={variant}
              announce={announce}
              flow={flow}
              addRef={addRef}
            />
          ) : (
            <ul className={LIST_CLASS[variant]}>
              {pending.map((item) => {
                const evidence = aiRestricted ? null : <MeetingEvidenceChip meetingId={meetingId} evidence={item.evidence} />;
                return room ? (
                  <RoomPendingRow key={item.id} item={item} assignee={memberOf(item.suggested_assignee_id)} evidence={evidence} />
                ) : (
                  <PendingRow key={item.id} item={item} variant={variant} evidence={evidence} />
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
      {converted.length > 0 ? (
        <section>
          {room ? (
            <RoomGroupHeading>{t("meetings.actionItemsSection.convertedGroup", { count: converted.length })}</RoomGroupHeading>
          ) : (
            <GroupHeading>{t("meetings.actionItemsSection.convertedGroup", { count: converted.length })}</GroupHeading>
          )}
          <ul className={LIST_CLASS[variant]}>
            {converted.map((item) =>
              room ? (
                <RoomConvertedRow
                  key={item.id}
                  item={item}
                  taskHref={item.task && wsPaths ? wsPaths.task(item.task.id) : null}
                  assignee={memberOf(item.task?.assignee_id)}
                />
              ) : (
              <ConvertedRow
                key={item.id}
                item={item}
                variant={variant}
                taskHref={item.task && wsPaths ? wsPaths.task(item.task.id) : null}
                assigneeName={memberOf(item.task?.assignee_id)?.display_name}
                evidence={aiRestricted ? null : <MeetingEvidenceChip meetingId={meetingId} evidence={item.evidence} />}
              />
              ),
            )}
          </ul>
        </section>
      ) : null}
      {dismissed.length > 0 ? (
        <Collapsible open={showDismissed} onOpenChange={setShowDismissed}>
          <CollapsibleTrigger
            render={
              <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground aria-expanded:bg-transparent">
                {t("meetings.actionItemsSection.dismissedGroup", { count: dismissed.length })}
                <ChevronDown
                  aria-hidden
                  className={cn("transition-transform duration-standard", showDismissed && "rotate-180")}
                />
              </Button>
            }
          />
          <CollapsibleContent>
            <ul className={cn("mt-2", LIST_CLASS[variant])}>
              {dismissed.map((item) => (
                <DismissedRow
                  key={item.id}
                  item={item}
                  variant={variant}
                  restoring={restore.isPending && restore.variables === item.id}
                  error={restoreError?.id === item.id ? restoreError.text : undefined}
                  onRestore={
                    canClerk
                      ? () => {
                          // Same shared-mutation reason as dismiss: one restore at a time.
                          if (restore.isPending) return;
                          setRestoreError(null);
                          restoring.current = item.id;
                          restore.mutate(item.id, {
                            onSuccess: () => announce(t("meetings.actionItemsSection.restored")),
                            onError: (err) => {
                              if (ROW_CHANGED_ELSEWHERE.has(errorCode(err) ?? "")) {
                                toast.error(t("meetings.actionItemsSection.changedElsewhere"));
                                return;
                              }
                              restoring.current = null;
                              setRestoreError({
                                id: item.id,
                                text: apiErrorCopy(err) ?? t("meetings.actionItemsSection.restoreFailed"),
                              });
                            },
                          });
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );

  return (
    <section className="space-y-3">
      <SummaryLiveRegion message={announcement.text} seq={announcement.seq} />
      {body}
      {room && canClerk && picked > 0 ? (
        <ActionItemsSelectionBar
          count={picked}
          busy={flow.pending}
          onClear={() => flow.pickOnly([])}
          onAssign={flow.assign}
          fallbackFocus={addRef}
        />
      ) : null}
    </section>
  );
}
