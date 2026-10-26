"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, CalendarDays, Maximize2, Minimize2, Ellipsis, PanelBottomClose, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { useCreateDriveTaskProposal, useDriveConnections, useLinkDriveFiles, type DriveTaskProposal } from "@uniwork/core/drive";
import { useDriveFile, useDriveFiles } from "@uniwork/core/drive-library";
import { toUploadResult, type UploadResult } from "@uniwork/core/hooks/use-file-upload";
import { editorAttachmentPurpose } from "@uniwork/core/constants/upload";
import { paths } from "@uniwork/core/paths";
import { useShortcut } from "@uniwork/core/shortcuts";
import { useProjects, useTasks, useUploadWorkspaceAttachment } from "@uniwork/core/tasks";
import { useCreateTaskDraftStore, type CreateTaskDraft } from "@uniwork/core/tasks/stores/create-task-draft-store";
import type { Agent } from "@uniwork/core/types/agent";
import { Logo } from "@uniwork/ui/brand";
import { FileUploadButton } from "@uniwork/ui/components/common/file-upload-button";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { AgentBadge } from "../agents/agent-badge";
import { PillButton } from "../common/pill-button";
import { ContentEditor, FileDropOverlay, useFileDropZone, useUploadGate, type ContentEditorRef } from "../editor";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { CreateTaskDriveChips } from "./create-task-drive-attachments";
import { CreateTaskSubmitButton } from "./create-task-submit-button";
import { DriveProposalErrorNotice, DriveRecreateWarning, handOffDriveProposalToReview, resolveDriveProposalError, type DriveProposalErrorResolution } from "./drive-task-proposal-popover";
import { PriorityIcon } from "./icons/priority-icon";
import { CreateTaskDateField } from "./pickers/create-task-overflow-fields";
import { PriorityPicker } from "./pickers/priority-picker";
import { CreateTaskProjectField } from "./pickers/create-task-project-fields";
import { PickerEmpty, PickerItem, PickerSection, PropertyPicker } from "./pickers/property-picker";
import { draftFromDefaults } from "./use-create-task-manual";

export type CreateTaskAgentPanelProps = {
  workspaceId: string;
  carry?: Record<string, unknown> | null;
  onClose: (reason?: "saved" | "submitted") => void;
  onSwitchMode: (carry?: Record<string, unknown> | null) => void;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  createAnother: boolean;
  setCreateAnother: (createAnother: boolean) => void;
  /** Seam for W7 (`packages/views/tasks/drive-proposals/`): invoked with the created proposal ID + DTO. */
  onProposalReady?: (proposalId: string, proposal: DriveTaskProposal) => void;
};

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function AgentPicker({ agents, selected, onChange }: { agents: Agent[]; selected: Agent | undefined; onChange: (agent: Agent) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return agents;
    return agents.filter((agent) => agent.name.toLocaleLowerCase().includes(normalized) || agent.handle.toLocaleLowerCase().includes(normalized));
  }, [agents, query]);

  return (
    <PropertyPicker
      open={open}
      onOpenChange={(next) => { if (!next) setQuery(""); setOpen(next); }}
      width="w-64"
      align="start"
      searchable
      searchPlaceholder={t("tasks.create.agent_search_placeholder")}
      searchAriaLabel={t("tasks.create.agent_search_placeholder")}
      onSearchChange={setQuery}
      trigger={
        <span className="flex items-center gap-2 text-caption text-muted-foreground">
          <span>{t("tasks.create.agent_created_by")}</span>
          {selected ? (
            <span className="flex min-w-0 items-center gap-1.5 text-foreground">
              <Avatar size="sm" className="size-5">
                {selected.avatar_url ? <AvatarImage src={selected.avatar_url} alt="" /> : null}
                <AvatarFallback>{initialOf(selected.name)}</AvatarFallback>
              </Avatar>
              <span className="max-w-48 truncate">{selected.name}</span>
              <AgentBadge className="shrink-0" />
            </span>
          ) : <span>{t("tasks.create.agent_pick")}</span>}
        </span>
      }
    >
      {filtered.length > 0 ? (
        <PickerSection label={t("tasks.create.assignee_agents")}>
          {filtered.map((agent) => (
            <PickerItem key={agent.id} selected={agent.id === selected?.id} onClick={() => { onChange(agent); setOpen(false); setQuery(""); }}>
              <Avatar size="sm" className="size-5">
                {agent.avatar_url ? <AvatarImage src={agent.avatar_url} alt="" /> : null}
                <AvatarFallback>{initialOf(agent.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              <AgentBadge className="shrink-0" />
            </PickerItem>
          ))}
        </PickerSection>
      ) : <PickerEmpty>{t("tasks.create.agent_no_agents")}</PickerEmpty>}
    </PropertyPicker>
  );
}

/**
 * Agent quick-create panel (spec §8.1, §8.2, §8.8).
 * Without a Drive chip: remains capability-gated (`tasks.create.agent_unavailable`).
 * With a Drive chip: replaces `AgentPicker` with "Tạo bởi UNI", requires no `selectedAgent`,
 * hides priority/due/upload buttons, shows the reading-account line + re-creation warning,
 * and submits to `POST .../drive-files/{id}/task-proposals`.
 */
export function CreateTaskAgentPanel({ workspaceId, carry, onClose, onSwitchMode, isExpanded, setIsExpanded, createAnother, setCreateAnother, onProposalReady }: CreateTaskAgentPanelProps) {
  const { t } = useTranslation();
  const workspaceContext = useOptionalWorkspace();
  const workspaceName = workspaceContext?.workspace.name ?? t("tasks.new");
  const sendShortcut = useShortcut("send");
  const draftFor = useCreateTaskDraftStore((state) => state.draftFor);
  const settingsFor = useCreateTaskDraftStore((state) => state.settingsFor);
  const persistDraft = useCreateTaskDraftStore((state) => state.setDraft);
  const persistSavedDraft = useCreateTaskDraftStore((state) => state.saveDraft);
  const clearDraft = useCreateTaskDraftStore((state) => state.clearDraft);
  const initialDraft = draftFor(workspaceId) ?? draftFromDefaults(undefined, settingsFor(workspaceId));
  const [draft, setDraft] = useState<CreateTaskDraft>(() => ({
    ...initialDraft,
    projectId: initialDraft.projectId ?? (typeof carry?.project_id === "string" ? carry.project_id : undefined),
    parentTaskId: initialDraft.parentTaskId ?? (typeof carry?.parent_task_id === "string" ? carry.parent_task_id : undefined),
    agentPrompt: initialDraft.agentPrompt ?? (typeof carry?.prompt === "string" ? carry.prompt : initialDraft.description),
  }));
  const draftRef = useRef(draft);
  const editorRef = useRef<ContentEditorRef>(null);
  const uploadCountRef = useRef(0);
  const [uploadCount, setUploadCount] = useState(0);
  const [hasContent, setHasContent] = useState(Boolean(draft.agentPrompt?.trim()));
  const [showPriority, setShowPriority] = useState((draft.priority ?? "none") !== "none");
  const [showDueDate, setShowDueDate] = useState(Boolean(draft.dueDate));
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [proposalError, setProposalError] = useState<DriveProposalErrorResolution | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const primaryDriveChip = draft.driveFiles?.[0];
  const hasDriveChip = Boolean(primaryDriveChip);

  const agentsQuery = useWorkspaceAgents(workspaceId);
  const projectsQuery = useProjects(workspaceId);
  const tasksQuery = useTasks(workspaceId);
  const uploadAttachment = useUploadWorkspaceAttachment(workspaceId);
  const uploadGate = useUploadGate(editorRef);

  const connectionsQuery = useDriveConnections(workspaceId, { enabled: hasDriveChip });
  const driveLibraryQuery = useDriveFiles(workspaceId, {
    connectionId: primaryDriveChip?.connectionId ?? null,
    enabled: hasDriveChip && !primaryDriveChip?.driveFileId,
  });
  const matchingLibraryFile = useMemo(() => {
    if (!primaryDriveChip) return undefined;
    const pages = driveLibraryQuery.data?.pages ?? [];
    for (const page of pages) {
      const found = page.files.find((f) => f.external_file_id === primaryDriveChip.externalFileId);
      if (found) return found;
    }
    return undefined;
  }, [driveLibraryQuery.data?.pages, primaryDriveChip]);

  const resolvedDriveFileId = primaryDriveChip?.driveFileId ?? matchingLibraryFile?.id;
  const driveFileDetailQuery = useDriveFile(workspaceId, resolvedDriveFileId ?? "", {
    enabled: hasDriveChip && Boolean(resolvedDriveFileId),
  });
  const resolvedDriveFile = driveFileDetailQuery.data ?? matchingLibraryFile;

  const linkDriveFilesMutation = useLinkDriveFiles(workspaceId);
  const createProposalMutation = useCreateDriveTaskProposal(workspaceId);
  const isProposing = abortController !== null && (linkDriveFilesMutation.isPending || createProposalMutation.isPending);

  const readerAccountEmail = useMemo(() => {
    if (!primaryDriveChip) return "";
    const conn = connectionsQuery.data?.connections.find((c) => c.id === primaryDriveChip.connectionId);
    return conn?.google_email?.trim() || resolvedDriveFile?.viewer_account_email?.trim() || "";
  }, [connectionsQuery.data?.connections, primaryDriveChip, resolvedDriveFile?.viewer_account_email]);

  const tasksCreated = resolvedDriveFile?.tasks_created ?? primaryDriveChip?.tasksCreated;
  const hasPriorCreations = Boolean(hasDriveChip && (tasksCreated?.count ?? 0) > 0);
  const warningId = `create-task-agent-drive-warning-${draft.idempotencyKey}`;
  const detailHref = workspaceContext && resolvedDriveFileId
    ? `${paths.workspace(workspaceContext.workspace.organization_slug, workspaceContext.workspace.slug).documentsDriveFile(resolvedDriveFileId)}#drive-tasks-created`
    : undefined;

  const agents = useMemo(() => (agentsQuery.data ?? []).filter((agent) => agent.status === "active"), [agentsQuery.data]);
  const selectedAgent = agents.find((agent) => agent.id === draft.agentId);
  const projectItems = useMemo(() => (projectsQuery.data?.projects ?? []).map((project) => ({ value: project.id, label: project.title })), [projectsQuery.data]);
  const parent = (tasksQuery.data ?? []).find((task) => task.id === draft.parentTaskId);

  const updateDraft = useCallback((patch: Partial<CreateTaskDraft>) => {
    const current = draftRef.current;
    const next = { ...current, ...patch, version: (current.version ?? 0) + 1 };
    draftRef.current = next;
    setDraft(next);
    persistDraft(workspaceId, next);
  }, [persistDraft, workspaceId]);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    if (hasDriveChip || selectedAgent || agents.length === 0) return;
    const carriedAgentId = typeof carry?.agent_id === "string" ? carry.agent_id : undefined;
    const seed = agents.find((agent) => agent.id === carriedAgentId) ?? agents[0];
    if (seed) updateDraft({ agentId: seed.id });
  }, [agents, carry?.agent_id, hasDriveChip, selectedAgent, updateDraft]);

  const uploadFile = async (file: File, _uploadId: string): Promise<UploadResult | null> => {
    uploadCountRef.current += 1;
    setUploadCount(uploadCountRef.current);
    try {
      const attachment = await uploadAttachment.mutateAsync({ file, purpose: editorAttachmentPurpose(file) });
      const attachments = draftRef.current.attachments ?? [];
      if (!attachments.some((item) => item.id === attachment.id)) updateDraft({ attachments: [...attachments, attachment] });
      return toUploadResult(attachment);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast.error(t("editor.upload.failed", { filename: file.name, reason }));
      return null;
    } finally {
      uploadCountRef.current = Math.max(0, uploadCountRef.current - 1);
      setUploadCount(uploadCountRef.current);
    }
  };
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((file) => editorRef.current?.uploadFile(file)),
    enabled: !hasDriveChip && !isProposing,
  });
  const isUploading = uploadCount > 0 || uploadGate.uploading;

  const cancelProposalReading = () => { abortController?.abort(); setAbortController(null); linkDriveFilesMutation.reset(); createProposalMutation.reset(); };

  const submitDriveProposal = async () => {
    if (!primaryDriveChip || isProposing || isUploading || uploadGate.isBlocked()) return;
    setProposalError(null);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      let targetDriveFileId = resolvedDriveFileId;
      if (!targetDriveFileId) {
        const linkResults = await linkDriveFilesMutation.mutateAsync({
          connection_id: primaryDriveChip.connectionId,
          external_file_ids: [primaryDriveChip.externalFileId],
        });
        if (controller.signal.aborted) return;
        const firstResult = linkResults.results[0];
        if (!firstResult || firstResult.outcome === "error" || !firstResult.file?.id) {
          setAbortController(null);
          setProposalError(resolveDriveProposalError({ code: firstResult?.error_code ?? "default", name: "ApiError" }, t));
          return;
        }
        targetDriveFileId = firstResult.file.id;
        const updatedDriveFiles = (draftRef.current.driveFiles ?? []).map((df, idx) =>
          idx === 0 ? { ...df, driveFileId: targetDriveFileId } : df,
        );
        updateDraft({ driveFiles: updatedDriveFiles });
      }

      const trimmedPrompt = (editorRef.current?.getMarkdown() ?? draftRef.current.agentPrompt ?? "").trim();
      const proposal = await createProposalMutation.mutateAsync({
        driveFileId: targetDriveFileId,
        body: {
          prompt: trimmedPrompt || undefined,
          project_id: draftRef.current.projectId ?? null,
          parent_task_id: draftRef.current.parentTaskId ?? null,
          context_task_id: draftRef.current.parentTaskId ?? null,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAbortController(null);
      clearDraft(workspaceId, draftRef.current.idempotencyKey);
      onClose("submitted");
      handOffDriveProposalToReview({ proposalId: proposal.id, proposal }, onProposalReady);
    } catch (err) {
      if (controller.signal.aborted) return;
      setAbortController(null);
      setProposalError(resolveDriveProposalError(err, t));
    }
  };

  const submit = () => {
    if (hasDriveChip) { void submitDriveProposal(); return; }
    if (!hasContent || !selectedAgent || uploadGate.isBlocked() || uploadCountRef.current > 0) return;
    toast.error(t("tasks.create.agent_unavailable"));
  };
  const switchToManual = () => {
    if (isProposing || uploadGate.isBlocked() || uploadCountRef.current > 0) return;
    const prompt = editorRef.current?.getMarkdown() ?? draftRef.current.agentPrompt ?? "";
    const current = draftRef.current;
    updateDraft({
      agentPrompt: prompt,
      description: current.description?.trim() ? current.description : prompt,
      assigneeId: current.assigneeId ?? selectedAgent?.id,
      assigneeKind: current.assigneeId ? current.assigneeKind : selectedAgent ? "agent" : undefined,
    });
    onSwitchMode({ project_id: current.projectId, parent_task_id: current.parentTaskId });
  };
  const saveCurrentDraft = () => {
    if (isProposing || uploadGate.isBlocked() || uploadCountRef.current > 0) return;
    const prompt = editorRef.current?.getMarkdown() ?? draftRef.current.agentPrompt ?? "";
    if (prompt !== draftRef.current.agentPrompt) updateDraft({ agentPrompt: prompt });
    persistSavedDraft(workspaceId, draftRef.current);
    onClose("saved");
  };

  const submitLabel = isUploading ? t("tasks.create.agent_uploading") : hasPriorCreations ? t("drive.proposals.submit_anyway") : t("tasks.create.agent_submit");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
        <div className="min-w-0">
          <DialogTitle className="truncate text-body font-medium">
            <span className="font-normal text-muted-foreground">{workspaceName}</span>
            <span className="mx-1.5 text-muted-foreground" aria-hidden>›</span>
            <span className="text-foreground">{t("tasks.create.agent_breadcrumb")}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">{t("tasks.create.sr_agent")}</DialogDescription>
        </div>
        <TooltipProvider delay={300}>
          <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={isExpanded ? t("tasks.create.collapse") : t("tasks.create.expand")} onClick={() => setIsExpanded(!isExpanded)} />}>
              {isExpanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
            </TooltipTrigger>
            <TooltipContent side="bottom">{isExpanded ? t("tasks.create.collapse") : t("tasks.create.expand")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50" aria-label={t("tasks.create.save_draft")} aria-disabled={isUploading || isProposing || undefined} onClick={saveCurrentDraft} />}>
              <PanelBottomClose className="size-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("tasks.create.save_draft")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={t("common.close")} onClick={() => { if (isProposing) cancelProposalReading(); onClose(); }} />}>
              <X className="size-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("common.close")}</TooltipContent>
          </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      <div className="shrink-0 px-5 pt-1 pb-2">
        {hasDriveChip ? (
          <div data-testid="create-task-agent-created-by-uni" className="flex items-center gap-2 text-caption text-muted-foreground">
            <span>{t("tasks.create.agent_created_by")}</span>
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
              <Logo variant="mark" size={16} decorative />
              <span>{t("drive.proposals.created_by_uni")}</span>
              <AgentBadge className="shrink-0" />
            </span>
          </div>
        ) : (
          <AgentPicker agents={agents} selected={selectedAgent} onChange={(agent) => updateDraft({ agentId: agent.id })} />
        )}
      </div>

      <div {...dropZoneProps} className="relative flex min-h-[140px] flex-1 overflow-y-auto px-5 pb-3">
        <ContentEditor
          key={draft.idempotencyKey}
          ref={editorRef}
          defaultValue={draft.agentPrompt ?? ""}
          ariaLabel={t("tasks.create.agent_prompt_aria")}
          placeholder={t("tasks.create.agent_prompt_placeholder")}
          onDocumentChange={(prompt) => { setHasContent(prompt.trim().length > 0); updateDraft({ agentPrompt: prompt }); }}
          onSubmit={submit}
          onUploadFile={uploadFile}
          onUploadingChange={uploadGate.onUploadingChange}
          attachments={draft.attachments}
        />
        {isDragOver ? <FileDropOverlay /> : null}
      </div>

      {hasDriveChip ? (
        <div className="flex shrink-0 flex-col gap-2 pb-2">
          <CreateTaskDriveChips
            driveFiles={draft.driveFiles}
            onRemove={(df) => {
              if (isProposing) return;
              const remaining = (draft.driveFiles ?? []).filter(
                (item) => !(item.connectionId === df.connectionId && item.externalFileId === df.externalFileId),
              );
              setProposalError(null);
              updateDraft({ driveFiles: remaining.length ? remaining : undefined });
            }}
          />
          <p data-testid="create-task-agent-drive-reader-line" className="px-5 text-caption text-muted-foreground">
            {readerAccountEmail ? t("drive.proposals.reader_line", { email: readerAccountEmail }) : t("drive.proposals.reader_line_no_email")}
          </p>
          {hasPriorCreations ? (
            <div className="px-5">
              <DriveRecreateWarning id={warningId} tasksCreated={tasksCreated} detailHref={detailHref} />
            </div>
          ) : null}
          {proposalError ? (
            <div className="px-5">
              <DriveProposalErrorNotice error={proposalError} openUrl={resolvedDriveFile?.open_url} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pb-2">
        <CreateTaskProjectField items={projectItems} value={draft.projectId} noneLabel={t("tasks.create.project_none")} searchPlaceholder={t("tasks.create.project_search_placeholder")} noResultsLabel={t("tasks.create.options_no_results")} clearLabel={t("common.delete")} onChange={(projectId) => updateDraft({ projectId })} />
        {!hasDriveChip && showPriority ? <PriorityPicker appearance="pill" value={(draft.priority ?? "none") as NonNullable<CreateTaskDraft["priority"]>} ariaLabel={t("tasks.priority")} onChange={(priority) => updateDraft({ priority })} /> : null}
        {!hasDriveChip && showDueDate ? <CreateTaskDateField value={draft.dueDate} label={t("tasks.dueDate")} kind="due" open={dueDateOpen} onOpenChange={setDueDateOpen} onChange={(dueDate) => updateDraft({ dueDate })} /> : null}
        {!hasDriveChip && (!showPriority || !showDueDate) ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<PillButton aria-label={t("tasks.create.more_fields")} />}><Ellipsis className="size-3.5" aria-hidden /></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              {!showPriority ? <DropdownMenuItem onClick={() => setShowPriority(true)}><PriorityIcon priority="none" className="size-3.5" />{t("tasks.create.agent_set_priority")}</DropdownMenuItem> : null}
              {!showDueDate ? <DropdownMenuItem onClick={() => { setShowDueDate(true); setTimeout(() => setDueDateOpen(true), 0); }}><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{t("tasks.create.agent_set_due_date")}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {parent ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">{t("tasks.create.agent_subtask_of", { identifier: parent.identifier })}</span> : null}
      </div>

      <div className="grid shrink-0 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2.5 border-t border-surface-border/50 px-4 py-3 sm:flex sm:flex-wrap">
        <div className="flex min-h-7 items-center gap-2 sm:mr-auto">
          {!hasDriveChip ? (
            <FileUploadButton size="sm" multiple onSelect={(file) => editorRef.current?.uploadFile(file)} />
          ) : null}
        </div>
        <button type="button" disabled={isUploading || isProposing} aria-disabled={isUploading || isProposing || undefined} aria-busy={isUploading || isProposing || undefined} title={t("tasks.create.switch_to_manual")} className="flex shrink-0 items-center gap-1.5 justify-self-end rounded-sm px-2 py-1 text-caption text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={switchToManual}>
          <ArrowLeftRight className="size-3.5" aria-hidden />{t("tasks.create.switch_to_manual")}
        </button>
        {!hasDriveChip ? (
          <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-caption text-muted-foreground">
            <Switch checked={createAnother} onCheckedChange={setCreateAnother} aria-label={t("tasks.create.create_another_short")} />
            <span aria-hidden>{t("tasks.create.create_another_short")}</span>
          </label>
        ) : null}
        {isProposing ? (
          <div className="flex items-center gap-2 justify-self-end">
            <span aria-live="polite" className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
              <Spinner className="size-3.5" />
              <span>{t("drive.proposals.reading")}</span>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={cancelProposalReading}>
              {t("drive.proposals.cancel_reading")}
            </Button>
          </div>
        ) : (
          <CreateTaskSubmitButton
            type="button"
            inactive={hasDriveChip ? false : !hasContent || !selectedAgent}
            busy={isUploading}
            label={submitLabel}
            shortcut={sendShortcut}
            ariaDescribedBy={hasPriorCreations ? warningId : undefined}
            onClick={submit}
          />
        )}
      </div>
    </div>
  );
}
