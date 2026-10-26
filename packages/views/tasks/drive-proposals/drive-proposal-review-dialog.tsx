"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCheckDriveTaskProposalDuplicates,
  useCreateTasksFromDriveProposal,
  useDeleteDriveTaskProposal,
  useDriveTaskProposal,
  type DriveTaskProposal,
} from "@uniwork/core/drive";
import { paths } from "@uniwork/core/paths";
import { useProjects, useTaskLabels, useTasks } from "@uniwork/core/tasks";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Dialog, DialogContent } from "@uniwork/ui/components/ui/dialog";
import { Sheet, SheetContent } from "@uniwork/ui/components/ui/sheet";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import {
  useStatusCatalog,
  useWorkspaceAssigneeOptions,
} from "../pickers";
import {
  applyDuplicateResults,
  buildBatchCreateItems,
  createItemDraftsFromProposal,
  formatProposalCreatedToast,
  isProposalExpired,
  resolveDriveProposalCreateError,
  type DriveProposalCreateErrorResolution,
  type DriveProposalItemDraft,
  type DuplicateDecision,
} from "./drive-proposal-helpers";
import { DriveProposalItemCard } from "./drive-proposal-item-card";
import {
  DriveProposalBatchSection,
  DriveProposalDiscardAlertDialog,
  DriveProposalPriorCreationsBanner,
  DriveProposalReviewFooter,
  DriveProposalReviewHeader,
  DriveProposalStatusView,
} from "./drive-proposal-review-sections";

export interface DriveProposalReviewDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeded proposal handed over by W6's `DriveProposalReviewProvider` or fetched by `proposalId`. */
  proposal?: DriveTaskProposal | null;
  /** Optional proposal ID when opening by ID before the proposal payload is loaded. */
  proposalId?: string;
}

export function DriveProposalReviewDialog({
  workspaceId,
  open,
  onOpenChange,
  proposal: proposalProp,
  proposalId: proposalIdProp,
}: DriveProposalReviewDialogProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const workspaceContext = useOptionalWorkspace();
  const navigation = useOptionalNavigation();

  const resolvedProposalId = proposalProp?.id ?? proposalIdProp ?? "";
  const proposalQuery = useDriveTaskProposal(workspaceId, resolvedProposalId, {
    enabled: open && !proposalProp && Boolean(resolvedProposalId),
  });
  const activeProposal = proposalProp ?? proposalQuery.data ?? null;

  const projectsQuery = useProjects(open ? workspaceId : "");
  const tasksQuery = useTasks(open ? workspaceId : "");
  const labelsQuery = useTaskLabels(open ? workspaceId : "");
  const assignees = useWorkspaceAssigneeOptions(open ? workspaceId : "");
  const statusCatalog = useStatusCatalog(open ? workspaceId : "");

  const defaultTodoStatus = useMemo(() => {
    const todoOpt = statusCatalog.options.find(
      (opt) => opt.category === "todo" || opt.key === "todo",
    );
    return todoOpt?.key ?? statusCatalog.options[0]?.key ?? "todo";
  }, [statusCatalog.options]);

  const [projectId, setProjectId] = useState<string | undefined>(activeProposal?.project_id);
  const [parentTaskId, setParentTaskId] = useState<string | undefined>(
    activeProposal?.parent_task_id ?? activeProposal?.context_task_id,
  );
  const [statusKey, setStatusKey] = useState<string>(defaultTodoStatus);
  const [itemDrafts, setItemDrafts] = useState<DriveProposalItemDraft[]>(() =>
    activeProposal ? createItemDraftsFromProposal(activeProposal.items) : [],
  );
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [createError, setCreateError] = useState<DriveProposalCreateErrorResolution | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const initializedProposalIdRef = useRef<string | null>(null);
  const duplicateReqSeqRef = useRef(0);

  const deleteMutation = useDeleteDriveTaskProposal(workspaceId);
  const duplicatesMutation = useCheckDriveTaskProposalDuplicates(workspaceId);
  const createTasksMutation = useCreateTasksFromDriveProposal(workspaceId);

  useEffect(() => {
    if (!open) {
      initializedProposalIdRef.current = null;
      setDiscardConfirmOpen(false);
      setCreateError(null);
      setLiveAnnouncement("");
      return;
    }
    if (!activeProposal || initializedProposalIdRef.current === activeProposal.id) {
      return;
    }
    initializedProposalIdRef.current = activeProposal.id;
    setProjectId(activeProposal.project_id || undefined);
    setParentTaskId(
      activeProposal.parent_task_id || activeProposal.context_task_id || undefined,
    );
    setStatusKey(defaultTodoStatus);
    setItemDrafts(createItemDraftsFromProposal(activeProposal.items));
    setCreateError(null);
  }, [activeProposal, defaultTodoStatus, open]);

  const wsPaths = useMemo(
    () =>
      workspaceContext
        ? paths.workspace(
            workspaceContext.workspace.organization_slug,
            workspaceContext.workspace.slug,
          )
        : null,
    [workspaceContext],
  );

  const fileHref =
    wsPaths && activeProposal?.drive_file_id
      ? wsPaths.documentsDriveFile(activeProposal.drive_file_id)
      : null;
  const priorCreationsHref = fileHref ? `${fileHref}#drive-tasks-created` : null;

  const projectItems = useMemo(
    () =>
      (projectsQuery.data?.projects ?? []).map((p) => ({
        value: p.id,
        label: p.title,
      })),
    [projectsQuery.data?.projects],
  );

  const parentItems = useMemo(
    () =>
      (tasksQuery.data ?? []).map((task) => ({
        value: task.id,
        label: [task.identifier, task.title].filter(Boolean).join(" · "),
      })),
    [tasksQuery.data],
  );

  const humanAssignees = useMemo(
    () => assignees.options.filter((opt) => opt.kind === "human"),
    [assignees.options],
  );

  const recomputeDuplicates = useCallback(
    async (
      nextProjectId: string | undefined,
      nextParentTaskId: string | undefined,
      currentDrafts: readonly DriveProposalItemDraft[],
    ) => {
      if (!activeProposal || currentDrafts.length === 0) return;
      const titles = currentDrafts.map((d) => d.title.trim() || " ");
      const seq = ++duplicateReqSeqRef.current;
      try {
        const results = await duplicatesMutation.mutateAsync({
          proposalId: activeProposal.id,
          body: {
            project_id: nextProjectId ?? null,
            parent_task_id: nextParentTaskId ?? null,
            titles,
          },
        });
        if (seq !== duplicateReqSeqRef.current) return;
        setItemDrafts((prev) => applyDuplicateResults(prev, results));
      } catch {
        // Non-fatal: batch creation still enforces server duplicate checks.
      }
    },
    [activeProposal, duplicatesMutation],
  );

  const handleProjectChange = (nextProjectId: string | undefined) => {
    setProjectId(nextProjectId);
    void recomputeDuplicates(nextProjectId, parentTaskId, itemDrafts);
  };

  const handleParentChange = (nextParentTaskId: string | undefined) => {
    setParentTaskId(nextParentTaskId);
    void recomputeDuplicates(projectId, nextParentTaskId, itemDrafts);
  };

  const updateItemDraft = (index: number, patch: Partial<DriveProposalItemDraft>) => {
    setItemDrafts((prev) =>
      prev.map((draft) => (draft.index === index ? { ...draft, ...patch } : draft)),
    );
  };

  const handleDuplicateDecision = (index: number, decision: DuplicateDecision) => {
    setItemDrafts((prev) =>
      prev.map((draft) => {
        if (draft.index !== index) return draft;
        if (decision === "skip") {
          return { ...draft, selected: false, duplicateDecision: "skip" };
        }
        return { ...draft, selected: true, duplicateDecision: decision };
      }),
    );
  };

  const expired = isProposalExpired(activeProposal?.expires_at);
  const nonReadyState =
    !activeProposal
      ? null
      : activeProposal.status === "converted"
        ? "converted"
        : activeProposal.status === "discarded"
          ? "discarded"
          : expired
            ? "expired"
            : null;

  const selectedCount = useMemo(
    () =>
      itemDrafts.filter(
        (d) => d.selected && d.duplicateDecision !== "skip" && d.title.trim().length > 0,
      ).length,
    [itemDrafts],
  );

  const createButtonLabel = createTasksMutation.isPending
    ? t("drive.proposals.review.creating")
    : selectedCount > 0
      ? t("drive.proposals.review.create", { count: selectedCount })
      : t("drive.proposals.review.create_none");

  const priorCreatedCount = useMemo(() => {
    if (!activeProposal) return 0;
    const fromGroups = activeProposal.prior_creations.reduce(
      (sum, group) => sum + group.tasks.length,
      0,
    );
    return Math.max(fromGroups, activeProposal.tasks_created?.count ?? 0);
  }, [activeProposal]);

  const showPriorCreationsBanner = Boolean(
    activeProposal &&
      (activeProposal.prior_creations.length > 0 || priorCreatedCount > 0),
  );

  const isBusy = createTasksMutation.isPending || deleteMutation.isPending;

  const requestClose = () => {
    if (isBusy) return;
    if (!activeProposal || nonReadyState !== null) {
      onOpenChange(false);
      return;
    }
    setDiscardConfirmOpen(true);
  };

  const handleConfirmDiscard = async () => {
    if (!activeProposal || deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync({ proposalId: activeProposal.id });
      setDiscardConfirmOpen(false);
      onOpenChange(false);
    } catch {
      toast.error(t("drive.proposals.errors.discard_failed"));
    }
  };

  const handleCreateBatch = async () => {
    if (!activeProposal || isBusy || selectedCount === 0 || nonReadyState !== null) {
      return;
    }
    setCreateError(null);
    setLiveAnnouncement(t("drive.proposals.review.creating"));

    const items = buildBatchCreateItems(
      itemDrafts,
      activeProposal.drive_file_name,
      fileHref,
      t,
    );
    if (items.length === 0) return;

    try {
      const created = await createTasksMutation.mutateAsync({
        proposalId: activeProposal.id,
        body: {
          project_id: projectId ?? null,
          parent_task_id: parentTaskId ?? null,
          status: statusKey || undefined,
          items,
        },
      });
      const count = created.task_ids.length || items.length;
      const parentTask = parentTaskId
        ? (tasksQuery.data ?? []).find((task) => task.id === parentTaskId)
        : undefined;
      const parentLabel = parentTask?.identifier || parentTask?.title || parentTaskId;
      const toastCopy = formatProposalCreatedToast({
        count,
        fileName: activeProposal.drive_file_name,
        parentTaskId,
        parentLabel,
        firstCreatedTaskId: created.task_ids[0],
        taskHref: (tId) => (wsPaths ? wsPaths.task(tId) : null),
        tasksListHref: wsPaths?.tasks() ?? null,
        t,
      });

      setLiveAnnouncement(toastCopy.message);
      toast.success(toastCopy.message, {
        ...(toastCopy.actionHref && navigation
          ? {
              action: {
                label: toastCopy.actionLabel,
                onClick: () => navigation.push(toastCopy.actionHref!),
              },
            }
          : {}),
      });

      onOpenChange(false);
    } catch (err) {
      const resolved = resolveDriveProposalCreateError(err, t);
      setCreateError(resolved);
      setLiveAnnouncement(resolved.message);
    }
  };

  const titleByIndex = useMemo(
    () => new Map(itemDrafts.map((d) => [d.index, d.title.trim() || `#${d.index + 1}`])),
    [itemDrafts],
  );

  const headingText = activeProposal
    ? t("drive.proposals.review.title", { count: itemDrafts.length })
    : t("drive.proposals.review.title_loading");

  const bodyContent = (
    <div className="flex max-h-[calc(100svh-2rem)] min-h-0 flex-1 flex-col overflow-hidden">
      <DriveProposalReviewHeader
        isMobile={isMobile}
        headingText={headingText}
        proposal={activeProposal}
        onRequestClose={requestClose}
      />

      {!activeProposal && proposalQuery.isLoading ? (
        <DriveProposalStatusView kind="loading" onClose={() => onOpenChange(false)} />
      ) : !activeProposal && proposalQuery.isError ? (
        <DriveProposalStatusView
          kind="error"
          errorMessage={resolveDriveProposalCreateError(proposalQuery.error, t).message}
          onClose={() => onOpenChange(false)}
        />
      ) : nonReadyState !== null ? (
        <DriveProposalStatusView kind={nonReadyState} onClose={() => onOpenChange(false)} />
      ) : activeProposal ? (
        <>
          <DriveProposalBatchSection
            workspaceId={workspaceId}
            projectItems={projectItems}
            parentItems={parentItems}
            projectId={projectId}
            parentTaskId={parentTaskId}
            statusKey={statusKey}
            disabled={isBusy}
            onProjectChange={handleProjectChange}
            onParentChange={handleParentChange}
            onStatusChange={setStatusKey}
          />

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
            {showPriorCreationsBanner ? (
              <DriveProposalPriorCreationsBanner
                priorCreatedCount={priorCreatedCount}
                priorCreationsHref={priorCreationsHref}
              />
            ) : null}

            {createError ? (
              <Alert
                variant="destructiveSoft"
                role="alert"
                data-testid="drive-proposal-create-error"
              >
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                <AlertDescription>{createError.message}</AlertDescription>
              </Alert>
            ) : null}

            {itemDrafts.length === 0 ? (
              <p className="py-6 text-center text-body text-muted-foreground">
                {t("drive.proposals.review.state_empty")}
              </p>
            ) : (
              itemDrafts.map((draft, idx) => {
                const blockedTitles = draft.blockedByIndexes
                  .map((bIdx) => titleByIndex.get(bIdx))
                  .filter((val): val is string => Boolean(val));
                return (
                  <DriveProposalItemCard
                    key={draft.index}
                    draft={draft}
                    fileName={activeProposal.drive_file_name}
                    fileHref={fileHref}
                    blockedByTitles={blockedTitles}
                    assigneeOptions={humanAssignees}
                    labels={labelsQuery.data?.labels ?? []}
                    taskHref={(tId) => (wsPaths ? wsPaths.task(tId) : null)}
                    disabled={isBusy}
                    autoFocusTitle={idx === 0}
                    onUpdate={(patch) => updateItemDraft(draft.index, patch)}
                    onDuplicateDecision={(decision) =>
                      handleDuplicateDecision(draft.index, decision)
                    }
                  />
                );
              })
            )}
          </div>

          <DriveProposalReviewFooter
            selectedCount={selectedCount}
            isBusy={isBusy}
            isCreating={createTasksMutation.isPending}
            createButtonLabel={createButtonLabel}
            onCancel={requestClose}
            onSubmit={() => void handleCreateBatch()}
          />
        </>
      ) : null}

      <div
        aria-live="polite"
        data-testid="drive-proposal-live-region"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

      <DriveProposalDiscardAlertDialog
        open={discardConfirmOpen}
        isDiscarding={deleteMutation.isPending}
        onOpenChange={setDiscardConfirmOpen}
        onConfirmDiscard={() => void handleConfirmDiscard()}
      />
    </div>
  );

  const handleContainerOpenChange = (next: boolean) => {
    if (!next) {
      requestClose();
    } else {
      onOpenChange(true);
    }
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleContainerOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          closeLabel={t("drive.proposals.review.close_aria")}
          className="flex h-svh max-h-svh w-full flex-col gap-0 p-0"
        >
          {bodyContent}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleContainerOpenChange}>
      <DialogContent
        showCloseButton={false}
        closeLabel={t("drive.proposals.review.close_aria")}
        className="flex max-h-[calc(100svh-2rem)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        {bodyContent}
      </DialogContent>
    </Dialog>
  );
}
