"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, CalendarDays, Maximize2, Minimize2, MoreHorizontal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { toUploadResult, type UploadResult } from "@uniwork/core/hooks/use-file-upload";
import { useShortcut } from "@uniwork/core/shortcuts";
import { useProjects, useTasks, useUploadWorkspaceAttachment } from "@uniwork/core/tasks";
import { useCreateTaskDraftStore, type CreateTaskDraft } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { TASK_PRIORITIES } from "@uniwork/core/types";
import type { Agent } from "@uniwork/core/types/agent";
import { FileUploadButton } from "@uniwork/ui/components/common/file-upload-button";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { AgentBadge } from "../agents/agent-badge";
import { PillButton } from "../common/pill-button";
import { ContentEditor, FileDropOverlay, useFileDropZone, useUploadGate, type ContentEditorRef } from "../editor";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { CreateTaskSubmitButton } from "./create-task-submit-button";
import { PriorityIcon } from "./icons/priority-icon";
import { CreateTaskPriorityField } from "./pickers/create-task-property-fields";
import { CreateTaskProjectField } from "./pickers/create-task-project-fields";
import { PickerEmpty, PickerItem, PickerSection, PropertyPicker } from "./pickers/property-picker";
import { TaskScheduleField } from "./task-schedule-field";
import { draftFromDefaults } from "./use-create-task-manual";

export type CreateTaskAgentPanelProps = {
  workspaceId: string;
  carry?: Record<string, unknown> | null;
  onClose: () => void;
  onSwitchMode: (carry?: Record<string, unknown> | null) => void;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  createAnother: boolean;
  setCreateAnother: (createAnother: boolean) => void;
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

/** Agent quick-create remains capability-gated until the runtime API lands. */
export function CreateTaskAgentPanel({ workspaceId, carry, onClose, onSwitchMode, isExpanded, setIsExpanded, createAnother, setCreateAnother }: CreateTaskAgentPanelProps) {
  const { t } = useTranslation();
  const workspaceContext = useOptionalWorkspace();
  const workspaceName = workspaceContext?.workspace.name ?? t("tasks.new");
  const sendShortcut = useShortcut("send");
  const draftFor = useCreateTaskDraftStore((state) => state.draftFor);
  const settingsFor = useCreateTaskDraftStore((state) => state.settingsFor);
  const persistDraft = useCreateTaskDraftStore((state) => state.setDraft);
  const initialDraft = draftFor(workspaceId) ?? draftFromDefaults(undefined, settingsFor(workspaceId));
  const [draft, setDraft] = useState<CreateTaskDraft>(() => ({
    ...initialDraft,
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
  const agentsQuery = useWorkspaceAgents(workspaceId);
  const projectsQuery = useProjects(workspaceId);
  const tasksQuery = useTasks(workspaceId);
  const uploadAttachment = useUploadWorkspaceAttachment(workspaceId);
  const uploadGate = useUploadGate(editorRef);
  const agents = useMemo(() => (agentsQuery.data ?? []).filter((agent) => agent.status === "active"), [agentsQuery.data]);
  const selectedAgent = agents.find((agent) => agent.id === draft.agentId);
  const projectItems = useMemo(() => (projectsQuery.data?.projects ?? []).map((project) => ({ value: project.id, label: project.title })), [projectsQuery.data]);
  const priorityItems = useMemo(() => TASK_PRIORITIES.map((priority) => ({ value: priority, label: t(`tasks.priority_${priority}`) })), [t]);
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
    if (selectedAgent || agents.length === 0) return;
    const carriedAgentId = typeof carry?.agent_id === "string" ? carry.agent_id : undefined;
    const seed = agents.find((agent) => agent.id === carriedAgentId) ?? agents[0];
    if (seed) updateDraft({ agentId: seed.id });
  }, [agents, carry?.agent_id, selectedAgent, updateDraft]);
  const uploadFile = async (file: File, _uploadId: string): Promise<UploadResult | null> => {
    uploadCountRef.current += 1;
    setUploadCount(uploadCountRef.current);
    try {
      const attachment = await uploadAttachment.mutateAsync(file);
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
  const { isDragOver, dropZoneProps } = useFileDropZone({ onDrop: (files) => files.forEach((file) => editorRef.current?.uploadFile(file)) });
  const isUploading = uploadCount > 0 || uploadGate.uploading;
  const submit = () => {
    if (!hasContent || !selectedAgent || uploadGate.isBlocked() || uploadCountRef.current > 0) return;
    toast.error(t("tasks.create.agent_unavailable"));
  };
  const switchToManual = () => {
    if (uploadGate.isBlocked() || uploadCountRef.current > 0) return;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
        <div className="min-w-0">
          <DialogTitle className="truncate text-body font-medium">
            {workspaceName}<span className="mx-1.5 text-muted-foreground" aria-hidden>›</span>{t("tasks.create.agent_breadcrumb")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("tasks.create.sr_agent")}</DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={isExpanded ? t("tasks.create.collapse") : t("tasks.create.expand")} onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
      </div>

      <div className="shrink-0 px-5 pt-1 pb-2">
        <AgentPicker agents={agents} selected={selectedAgent} onChange={(agent) => updateDraft({ agentId: agent.id })} />
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

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pb-2">
        <CreateTaskProjectField items={projectItems} value={draft.projectId} noneLabel={t("tasks.create.project_none")} searchPlaceholder={t("tasks.create.project_search_placeholder")} noResultsLabel={t("tasks.create.options_no_results")} clearLabel={t("common.delete")} onChange={(projectId) => updateDraft({ projectId })} />
        {showPriority ? <CreateTaskPriorityField items={priorityItems} value={(draft.priority ?? "none") as NonNullable<CreateTaskDraft["priority"]>} onChange={(priority) => updateDraft({ priority })} /> : null}
        {showDueDate ? (
          <TaskScheduleField
            value={{
              start_date: draft.startDate,
              due_date: draft.dueDate,
              start_at: draft.startAt,
              due_at: draft.dueAt,
            }}
            label={t("tasks.dueDate")}
            kind="due"
            compact
            open={dueDateOpen}
            onOpenChange={setDueDateOpen}
            onChange={(value) =>
              updateDraft({
                startDate: value.start_date ?? undefined,
                dueDate: value.due_date ?? undefined,
                startAt: value.start_at ?? undefined,
                dueAt: value.due_at ?? undefined,
              })
            }
          />
        ) : null}
        {!showPriority || !showDueDate ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<PillButton aria-label={t("tasks.create.more_fields")} />}><MoreHorizontal className="size-3.5" aria-hidden /></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              {!showPriority ? <DropdownMenuItem onClick={() => setShowPriority(true)}><PriorityIcon priority="none" className="size-3.5" />{t("tasks.create.agent_set_priority")}</DropdownMenuItem> : null}
              {!showDueDate ? <DropdownMenuItem onClick={() => { setShowDueDate(true); setTimeout(() => setDueDateOpen(true), 0); }}><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{t("tasks.create.agent_set_due_date")}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {parent ? <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">{t("tasks.create.agent_subtask_of", { identifier: parent.identifier })}</span> : null}
      </div>

      <div className="grid shrink-0 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2.5 border-t border-surface-border/50 px-4 py-3 sm:flex sm:flex-wrap">
        <div className="flex min-h-7 items-center gap-2 sm:mr-auto"><FileUploadButton size="sm" multiple onSelect={(file) => editorRef.current?.uploadFile(file)} /></div>
        <button type="button" disabled={isUploading} aria-disabled={isUploading || undefined} aria-busy={isUploading || undefined} title={t("tasks.create.switch_to_manual")} className="flex shrink-0 items-center gap-1.5 justify-self-end rounded-sm px-2 py-1 text-caption text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={switchToManual}>
          <ArrowLeftRight className="size-3.5" aria-hidden />{t("tasks.create.switch_to_manual")}
        </button>
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-caption text-muted-foreground">
          <Switch checked={createAnother} onCheckedChange={setCreateAnother} aria-label={t("tasks.create.create_another_short")} />
          <span aria-hidden>{t("tasks.create.create_another_short")}</span>
        </label>
        <CreateTaskSubmitButton
          type="button"
          inactive={!hasContent || !selectedAgent}
          busy={isUploading}
          label={isUploading ? t("tasks.create.agent_uploading") : t("tasks.create.agent_submit")}
          shortcut={sendShortcut}
          onClick={submit}
        />
      </div>
    </div>
  );
}
