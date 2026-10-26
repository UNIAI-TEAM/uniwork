"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ListChecks, PencilLine, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import { useDismissMeetingActionItem, type MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { CreateTaskDialog } from "../../tasks/create-task-dialog";
import { apiErrorCopy } from "../../api-error-copy";
import { MeetingEvidenceChip } from "../meeting-evidence-chip";
import { meetingAvatarTint } from "../meeting-detail/avatar-tint";
import { useMemberIndex } from "../use-member-index";
import { DismissActionItemButton, LIST_CLASS, PendingRow, type ActionItemsVariant } from "./action-item-rows";
import { RoomPendingRow } from "./room-rows";
import type { useActionItemConversion } from "./use-action-item-conversion";

/**
 * Refusals that mean the row changed elsewhere (assigned, restored, or gone
 * with a regenerated summary): the refetch moves it away with its popover, so
 * the refusal is a toast and focus goes where a successful command sends it.
 */
export const ROW_CHANGED_ELSEWHERE = new Set(["action_item_not_pending", "action_item_not_found", "action_item_not_dismissed"]);

/** Focuses a pending row's checkbox; false when that row is not on screen. */
export function focusPendingRow(root: HTMLElement | null, id: string | undefined): boolean {
  const row = id
    ? Array.from(root?.querySelectorAll<HTMLElement>("[data-action-item]") ?? []).find((el) => el.dataset.actionItem === id)
    : undefined;
  const box = row?.querySelector<HTMLElement>('[role="checkbox"]');
  box?.focus();
  return Boolean(box);
}

/**
 * The clerk's pending list: tick, then "Assign" makes the tasks at once on
 * the meeting's suggestions (what needs changing is changed on the task);
 * dismiss one with an optional reason; "Add task" opens the task screen's
 * composer for one the summary missed. The call to action stays rendered
 * once there is any item, even with none left pending (aria-disabled, with
 * the reason beside it), so focus has somewhere to land; it is the primary
 * button only once something is ticked. In the room the rows are the room's
 * and "Assign" lives on the section's floating bar, shown only while ticked.
 */
export function ClerkPendingList({
  workspaceId,
  meetingId,
  items,
  pending,
  variant,
  announce,
  flow,
  addRef,
}: {
  workspaceId: string;
  meetingId: string;
  items: readonly MeetingActionItem[];
  pending: readonly MeetingActionItem[];
  variant: ActionItemsVariant;
  announce: (message: string) => void;
  flow: ReturnType<typeof useActionItemConversion>;
  addRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const reasonId = useId();
  const { memberOf, members } = useMemberIndex(workspaceId);
  // A face with its tint, as on the UNI empty state.
  const person = (userId?: string | null) => {
    const m = memberOf(userId);
    return m && { ...m, tint: meetingAvatarTint(m.user_id, members) };
  };
  const dismiss = useDismissMeetingActionItem(meetingId);
  const [dismissError, setDismissError] = useState<{ id: string; text: string } | null>(null);
  const room = variant === "room";
  const assignRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // A dismissed row unmounts with its focused button: once it leaves, focus the next row, else Add item.
  const landing = useRef<{ leaving: string; next?: string } | null>(null);
  const count = flow.pickedPending.length;
  const blocked = count === 0 || flow.pending;

  useEffect(() => {
    const l = landing.current;
    if (!l || pending.some((p) => p.id === l.leaving)) return;
    landing.current = null;
    if (!focusPendingRow(listRef.current, l.next)) (addRef.current ?? assignRef.current)?.focus();
  }, [pending, addRef]);

  return (
    <div className="space-y-2.5">
      {pending.length > 0 ? (
        <ul ref={listRef} className={LIST_CLASS[variant]}>
          {pending.map((item, at) => {
            const row = {
              item,
              checked: flow.picked.has(item.id),
              onCheckedChange: (on: boolean) => flow.toggle(item.id, on),
              evidence: <MeetingEvidenceChip meetingId={meetingId} evidence={item.evidence} />,
            };
            const edit = () => flow.edit(item.id);
            const dismissButton = (
              <DismissActionItemButton
                icon={room}
                title={item.title}
                // One shared mutation: TanStack runs only the latest mutate()'s callbacks, so a
                // second dismiss while one is in flight would lose the first's done/toast.
                pending={dismiss.isPending}
                error={dismissError?.id === item.id ? dismissError.text : undefined}
                onDismiss={(reason, done) => {
                  setDismissError(null);
                  landing.current = { leaving: item.id, next: (pending[at + 1] ?? pending[at - 1])?.id };
                  dismiss.mutate(
                    { itemId: item.id, reason },
                    {
                      onSuccess: () => {
                        done();
                        announce(t("meetings.actionItemsSection.dismissed"));
                      },
                      onError: (err) => {
                        if (ROW_CHANGED_ELSEWHERE.has(errorCode(err) ?? "")) {
                          toast.error(t("meetings.actionItemsSection.changedElsewhere"));
                          return;
                        }
                        landing.current = null;
                        setDismissError({
                          id: item.id,
                          text: apiErrorCopy(err) ?? t("meetings.actionItemsSection.dismissFailed"),
                        });
                      },
                    },
                  );
                }}
              />
            );
            return room ? (
              <RoomPendingRow
                key={item.id}
                {...row}
                assignee={person(item.suggested_assignee_id)}
                onEdit={edit}
                actions={
                  <>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      aria-label={t("meetings.panel.actions.editLabel", { title: item.title })}
                      onClick={edit}
                    >
                      <PencilLine aria-hidden />
                    </Button>
                    {dismissButton}
                  </>
                }
              />
            ) : (
              <PendingRow
                key={item.id}
                {...row}
                variant={variant}
                suggestedName={memberOf(item.suggested_assignee_id)?.display_name}
                action={
                  <div className="flex shrink-0 items-center gap-1">
                    {/* The same values "Assign" would use, in the composer, to change first. */}
                    <Button type="button" size="sm" variant="ghost" onClick={edit}>
                      {t("meetings.actionItemsSection.editAssign")}
                    </Button>
                    {dismissButton}
                  </div>
                }
              />
            );
          })}
        </ul>
      ) : null}
      <div
        data-testid="action-items-bar"
        className="flex flex-wrap items-center gap-2"
      >
        {/* The room assigns from its floating bar instead (ActionItemsSelectionBar). */}
        {items.length > 0 && !room ? (
          <Button
            ref={assignRef}
            type="button"
            size="sm"
            variant={count > 0 ? "default" : "outline"}
            aria-disabled={blocked || undefined}
            aria-busy={flow.pending || undefined}
            aria-describedby={count === 0 ? reasonId : undefined}
            onClick={flow.assign}
          >
            {flow.pending ? <Spinner data-icon="inline-start" /> : <ListChecks aria-hidden />}
            {count > 0 ? t("meetings.actionItemsSection.assign", { count }) : t("meetings.actionItemsSection.assignNone")}
          </Button>
        ) : null}
        <Button ref={addRef} type="button" size="sm" variant="ghost" onClick={() => flow.setComposerOpen(true)}>
          <Plus aria-hidden />
          {t("meetings.actionItemsSection.add")}
        </Button>
        {count === 0 && items.length > 0 && !room ? (
          <p id={reasonId} className="text-caption text-muted-foreground">
            {pending.length > 0
              ? t("meetings.actionItemsSection.pickReason")
              : t("meetings.actionItemsSection.nothingPending")}
          </p>
        ) : null}
      </div>
      {/* The task screen's own composer: an item's values to change first, or a task the summary missed. */}
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
    </div>
  );
}
