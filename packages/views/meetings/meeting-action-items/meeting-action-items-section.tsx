"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ListChecks, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useDismissMeetingActionItem,
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
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../../common/panel-card";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { MODULE_ICONS } from "../../layout/module-icons";
import { moduleTone } from "../../layout/module-tones";
import { AiSummaryTasksDialog } from "../../tasks/ai-summary-tasks-dialog";
import { toastApiError } from "../../toast-api-error";
import { MeetingSectionError, MeetingSectionLoading } from "../meeting-section-state";
import { SummaryLiveRegion } from "../meeting-summary/summary-generate-controls";
import { useMemberIndex } from "../use-member-index";
import {
  ConvertedRow,
  DismissActionItemButton,
  DismissedRow,
  LIST_CLASS,
  PendingRow,
  type ActionItemsVariant,
} from "./action-item-rows";
import { MeetingEvidenceChip } from "../meeting-evidence-chip";
import { AddActionItemForm } from "./add-action-item-form";
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
 * The clerk's pending list: tick, review in the shared dialog (title, who,
 * when, priority, project; the server's suggestions are the starting point
 * and the clerk's choices are final), assign; dismiss one with an optional
 * reason; add one the summary missed. The call to action stays rendered
 * (aria-disabled with a reason when nothing is ticked), so the focus the
 * dialog hands back on close has somewhere to land; it is the primary
 * button only once something is ticked, and on a phone it then sticks to
 * the bottom of the screen so it is never below every row.
 */
function ClerkPendingList({
  workspaceId,
  meetingId,
  projectId,
  items,
  pending,
  variant,
  announce,
  selection,
}: {
  workspaceId: string;
  meetingId: string;
  projectId?: string;
  items: readonly MeetingActionItem[];
  pending: readonly MeetingActionItem[];
  variant: ActionItemsVariant;
  announce: (message: string) => void;
  selection?: ActionItemSelection;
}) {
  const { t } = useTranslation();
  const reasonId = useId();
  const flow = useActionItemConversion({ workspaceId, meetingId, items, announce, selection });
  const dismiss = useDismissMeetingActionItem(meetingId);
  const { memberOf } = useMemberIndex(workspaceId);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const count = flow.pickedPending.length;
  const blocked = count === 0 || flow.pending;
  const sticky = variant === "panel" && count > 0;

  // The form unmounts the button that opened it: when it closes, focus goes back there, not to <body>.
  useEffect(() => {
    if (adding || !returnFocus.current) return;
    returnFocus.current = false;
    addRef.current?.focus();
  }, [adding]);
  const closeAdd = () => {
    returnFocus.current = true;
    setAdding(false);
  };

  return (
    <div className="space-y-2.5">
      {pending.length > 0 ? (
        <ul className={LIST_CLASS[variant]}>
          {pending.map((item) => (
            <PendingRow
              key={item.id}
              item={item}
              variant={variant}
              suggestedName={memberOf(item.suggested_assignee_id)?.display_name}
              checked={flow.picked.has(item.id)}
              onCheckedChange={(on) => flow.toggle(item.id, on)}
              evidence={<MeetingEvidenceChip meetingId={meetingId} evidence={item.evidence} />}
              action={
                <DismissActionItemButton
                  title={item.title}
                  // One shared mutation: TanStack runs only the latest mutate()'s callbacks, so a
                  // second dismiss while one is in flight would lose the first's done/toast.
                  pending={dismiss.isPending}
                  onDismiss={(reason, done) =>
                    dismiss.mutate(
                      { itemId: item.id, reason },
                      {
                        onSuccess: () => {
                          done();
                          announce(t("meetings.actionItemsSection.dismissed"));
                        },
                        onError: (err) => toastApiError(err, t("meetings.actionItemsSection.dismissFailed")),
                      },
                    )
                  }
                />
              }
            />
          ))}
        </ul>
      ) : null}
      {adding ? <AddActionItemForm meetingId={meetingId} onDone={closeAdd} announce={announce} /> : null}
      <div
        data-testid="action-items-bar"
        className={cn(
          "flex flex-wrap items-center gap-2",
          sticky &&
            "max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:border-t max-sm:border-border max-sm:bg-surface max-sm:px-4 max-sm:py-3",
        )}
      >
        {pending.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant={count > 0 ? "default" : "outline"}
            aria-disabled={blocked || undefined}
            aria-busy={flow.pending || undefined}
            aria-describedby={count === 0 ? reasonId : undefined}
            onClick={flow.openReview}
          >
            {flow.pending ? <Spinner data-icon="inline-start" /> : <ListChecks aria-hidden />}
            {count > 0 ? t("meetings.actionItemsSection.assign", { count }) : t("meetings.actionItemsSection.assignNone")}
          </Button>
        ) : null}
        {adding ? null : (
          <Button ref={addRef} type="button" size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("meetings.actionItemsSection.add")}
          </Button>
        )}
      </div>
      {count === 0 ? (
        <p id={reasonId} className="sr-only">
          {t("meetings.actionItemsSection.pickReason")}
        </p>
      ) : null}
      <AiSummaryTasksDialog
        open={flow.dialogOpen}
        onOpenChange={flow.setDialogOpen}
        wsId={workspaceId}
        idPrefix={`meeting-action-${meetingId}`}
        seeds={flow.seeds}
        itemNotes={flow.itemNotes}
        initialProjectId={projectId}
        pending={flow.pending}
        copy={{
          title: t("meetings.actionItemsSection.dialogTitle"),
          description: t("meetings.actionItemsSection.dialogDescription", { count: flow.seeds.length }),
          projectLabel: t("meetings.summaryAi.projectLabel"),
          projectNone: t("meetings.summaryAi.projectNone"),
          unassignedLabel: t("meetings.summaryAi.unassigned"),
          suggestedOwner: (name) => t("meetings.actionItemsSection.suggestedOwner", { name }),
          spokenDue: (due) => t("meetings.actionItemsSection.spokenDue", { due }),
          submit: t("meetings.actionItemsSection.submit", { count: flow.seeds.length }),
          submitting: t("meetings.actionItemsSection.submitting"),
          titleLabel: t("meetings.actionItemsSection.titleLabel"),
        }}
        onConfirm={flow.submit}
      />
    </div>
  );
}

/**
 * "After the meeting" (spec meeting follow-through §9.2 item 1): the meeting's
 * action items in three groups — pending, assigned (with each task's state)
 * and dismissed (folded). A clerk (host, secretary, workspace admin) works the
 * pending list down; everyone else reads. `compact` is the in-room Copilot's
 * version, without the panel frame.
 */
export function MeetingActionItemsSection({
  workspaceId,
  meetingId,
  projectId,
  canClerk,
  variant = "panel",
  selection,
}: {
  workspaceId: string;
  meetingId: string;
  /** The meeting's project: new tasks start there while it still exists. */
  projectId?: string;
  canClerk: boolean;
  variant?: ActionItemsVariant;
  /** Ticks kept by a screen that unmounts this section; else kept here. */
  selection?: ActionItemSelection;
}) {
  const { t } = useTranslation();
  const query = useMeetingActionItems(meetingId);
  const restore = useRestoreMeetingActionItem(meetingId);
  const { memberOf } = useMemberIndex(workspaceId);
  // A project deleted after the meeting was linked stays on the meeting row (no FK).
  const { data: project } = useProject(workspaceId, projectId || "");
  const workspace = useOptionalWorkspace()?.workspace;
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  const [announcement, setAnnouncement] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);

  const items = query.data?.items ?? [];
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

  const body = query.isPending ? (
    <RowsSkeleton />
  ) : query.isError && !query.data ? (
    <MeetingSectionError message={t("meetings.actionItemsSection.loadFailed")} onRetry={() => void query.refetch()} />
  ) : (
    <div className="space-y-4" data-testid="meeting-action-items">
      {items.length > 0 && query.data ? <ProgressLine counts={query.data.counts} /> : null}
      {items.length === 0 && !canClerk ? (
        <p className="text-label text-muted-foreground">{t("meetings.actionItemsSection.emptyReadOnly")}</p>
      ) : null}
      {canClerk || pending.length > 0 ? (
        <section>
          {pending.length > 0 ? (
            <GroupHeading>{t("meetings.actionItemsSection.pendingGroup", { count: pending.length })}</GroupHeading>
          ) : null}
          {items.length === 0 ? (
            <p className="mb-2 text-label text-muted-foreground">{t("meetings.actionItemsSection.empty")}</p>
          ) : null}
          {canClerk ? (
            <ClerkPendingList
              workspaceId={workspaceId}
              meetingId={meetingId}
              projectId={project?.id}
              items={items}
              pending={pending}
              variant={variant}
              announce={setAnnouncement}
              selection={selection}
            />
          ) : (
            <ul className={LIST_CLASS[variant]}>
              {pending.map((item) => (
                <PendingRow
                  key={item.id}
                  item={item}
                  variant={variant}
                  evidence={<MeetingEvidenceChip meetingId={meetingId} evidence={item.evidence} />}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {converted.length > 0 ? (
        <section>
          <GroupHeading>{t("meetings.actionItemsSection.convertedGroup", { count: converted.length })}</GroupHeading>
          <ul className={LIST_CLASS[variant]}>
            {converted.map((item) => (
              <ConvertedRow
                key={item.id}
                item={item}
                variant={variant}
                taskHref={item.task && wsPaths ? wsPaths.task(item.task.id) : null}
                assigneeName={memberOf(item.task?.assignee_id)?.display_name}
                evidence={<MeetingEvidenceChip meetingId={meetingId} evidence={item.evidence} />}
              />
            ))}
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
                  onRestore={
                    canClerk
                      ? () => {
                          // Same shared-mutation reason as dismiss: one restore at a time.
                          if (restore.isPending) return;
                          restore.mutate(item.id, {
                            onSuccess: () => setAnnouncement(t("meetings.actionItemsSection.restored")),
                            onError: (err) => toastApiError(err, t("meetings.actionItemsSection.restoreFailed")),
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

  if (variant === "compact") {
    return (
      <section className="space-y-3">
        <SummaryLiveRegion message={announcement} />
        {body}
      </section>
    );
  }
  return (
    // clip, not hidden: the phone's sticky assign bar needs a card that is not a scroll container.
    <PanelCard
      id="action-items-heading"
      icon={MODULE_ICONS.tasks}
      iconTone={moduleTone("tasks")}
      title={t("meetings.actionItemsSection.title")}
      className="overflow-clip"
    >
      <SummaryLiveRegion message={announcement} />
      {body}
    </PanelCard>
  );
}
