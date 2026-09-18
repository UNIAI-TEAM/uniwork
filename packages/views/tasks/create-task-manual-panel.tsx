"use client";

import { useRef } from "react";
import { ArrowLeftRight, Maximize2, Minimize2, Paperclip, X } from "lucide-react";
import { useShortcut } from "@uniwork/core/shortcuts";
import type { CreateTaskBody } from "@uniwork/core/tasks";
import type { CreateTaskDraft } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { PillButton } from "../common/pill-button";
import { ContentEditor } from "../editor";
import { ShortcutKeycaps } from "../editor/shortcut-keycaps";
import { CreateTaskManualOverflow } from "./create-task-manual-overflow";
import {
  CreateTaskAssigneeField,
  CreateTaskLabelField,
  CreateTaskPriorityField,
  CreateTaskStatusField,
} from "./pickers/create-task-property-fields";
import { CreateTaskProjectField } from "./pickers/create-task-project-fields";
import { useCreateTaskManualState } from "./use-create-task-manual";

export type CreateTaskManualPanelProps = {
  workspaceId: string;
  defaults?: Partial<CreateTaskBody>;
  carry?: Record<string, unknown> | null;
  onClose: () => void;
  onSwitchMode: (carry?: Record<string, unknown> | null) => void;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
};

export function CreateTaskManualPanel({
  workspaceId,
  defaults,
  carry,
  onClose,
  onSwitchMode,
  isExpanded,
  setIsExpanded,
}: CreateTaskManualPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendShortcut = useShortcut("send");
  const state = useCreateTaskManualState({ workspaceId, defaults, carry, onClose });
  const {
    t,
    draft,
    updateDraft,
    createAnother,
    setCreateAnother,
    failedFile,
    revealed,
    reveal,
    unreveal,
    statusItems,
    priorityItems,
    projectItems,
    parentItems,
    maxSiblingStage,
    labelList,
    propertyList,
    assignees,
    assignee,
    assigneeLabel,
    workspaceName,
    submit,
    uploadFile,
    removeAttachment,
    setProperty,
    uploadAttachment,
    busy,
  } = state;
  const canSubmit = Boolean(draft.title.trim()) && !busy;

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
        <div className="min-w-0">
          <DialogTitle className="truncate text-body font-medium">
            {workspaceName}
            <span className="mx-1.5 text-muted-foreground" aria-hidden>
              ›
            </span>
            {t("tasks.create.manual_breadcrumb")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("tasks.create.sr_manual")}</DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={isExpanded ? t("tasks.create.collapse") : t("tasks.create.expand")}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={onClose}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-5 pb-2">
        <Input
          aria-label={t("tasks.create.title_placeholder")}
          value={draft.title}
          onChange={(event) => updateDraft({ title: event.target.value })}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={t("tasks.create.title_placeholder")}
          required
          maxLength={200}
          autoFocus
          className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-title font-semibold shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-title dark:bg-transparent"
        />
      </div>

      <div data-testid="create-task-composer-body" className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 overflow-y-auto px-5">
          <ContentEditor
            key={draft.idempotencyKey}
            defaultValue={draft.description ?? ""}
            ariaLabel={t("tasks.description")}
            placeholder={t("tasks.create.description_placeholder")}
            onDocumentChange={(description) => updateDraft({ description })}
            onSubmit={submit}
          />
        </div>

        <div
          data-testid="create-task-property-toolbar"
          className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-2"
        >
          <CreateTaskStatusField
            items={statusItems}
            value={draft.status ?? "todo"}
            searchPlaceholder={t("tasks.create.status_search_placeholder")}
            noResultsLabel={t("tasks.create.options_no_results")}
            onChange={(value) => updateDraft({ status: value })}
          />
          <CreateTaskPriorityField
            items={priorityItems}
            value={(draft.priority ?? "none") as NonNullable<CreateTaskDraft["priority"]>}
            onChange={(value) => updateDraft({ priority: value })}
          />
          <CreateTaskAssigneeField
            value={assignee}
            options={assignees.options}
            onChange={(value) => updateDraft({ assigneeId: value?.id, assigneeKind: value?.kind })}
            ariaLabel={t("tasks.assignee")}
            valueLabel={assigneeLabel}
            unassignedLabel={t("tasks.unassigned")}
            searchPlaceholder={t("tasks.assignee_search_placeholder")}
            noResultsLabel={t("tasks.assignee_no_results")}
          />
          <CreateTaskLabelField
            labels={labelList?.labels ?? []}
            selectedIds={new Set(draft.labelIds ?? [])}
            onToggle={(labelId, checked) => {
              const selected = new Set(draft.labelIds ?? []);
              if (checked) selected.add(labelId);
              else selected.delete(labelId);
              updateDraft({ labelIds: [...selected] });
            }}
            ariaLabel={t("tasks.detail.prop_labels")}
            valueLabel={t("tasks.create.labels_selected", { count: draft.labelIds?.length ?? 0 })}
            emptyLabel={t("tasks.table.labels_empty")}
            searchPlaceholder={t("tasks.create.label_search_placeholder")}
            noResultsLabel={t("tasks.create.options_no_results")}
          />
          <CreateTaskProjectField
            items={projectItems}
            value={draft.projectId}
            noneLabel={t("tasks.create.project_none")}
            searchPlaceholder={t("tasks.create.project_search_placeholder")}
            noResultsLabel={t("tasks.create.options_no_results")}
            clearLabel={t("common.delete")}
            onChange={(value) => updateDraft({ projectId: value })}
          />
          <CreateTaskManualOverflow
            moreFieldsLabel={t("tasks.create.more_fields")}
            clearLabel={t("common.delete")}
            parentLabel={t("tasks.create.parent")}
            stageLabel={t("tasks.create.stage")}
            stageNoneLabel={t("tasks.detail.stage_none")}
            startDateLabel={t("tasks.create.start_date")}
            dueDateLabel={t("tasks.dueDate")}
            parentSearchPlaceholder={t("tasks.create.parent_search_placeholder")}
            optionsNoResultsLabel={t("tasks.create.options_no_results")}
            parentNoneLabel={t("tasks.create.parent_none")}
            revealed={revealed}
            onReveal={reveal}
            onClear={unreveal}
            parentItems={parentItems}
            parentValue={draft.parentTaskId}
            onParentChange={(value) => updateDraft({ parentTaskId: value })}
            stageValue={draft.stage}
            maxSiblingStage={maxSiblingStage}
            onStageChange={(value) => updateDraft({ stage: value })}
            startDate={draft.startDate}
            onStartDateChange={(value) => updateDraft({ startDate: value })}
            dueDate={draft.dueDate}
            onDueDateChange={(value) => updateDraft({ dueDate: value })}
            properties={propertyList?.properties ?? []}
            propertyValues={draft.properties ?? {}}
            onPropertyChange={setProperty}
          />
        </div>

        {uploadAttachment.isPending ? (
          <p className="px-5 py-1 text-caption text-muted-foreground" aria-live="polite">
            {t("tasks.detail.attachments_uploading", {
              filename: uploadAttachment.variables?.name ?? "",
            })}
          </p>
        ) : null}
        {failedFile ? (
          <div className="flex items-center justify-between gap-2 px-5 py-1 text-body" role="alert">
            <span>{t("editor.upload.failed_label", { filename: failedFile.name })}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => uploadFile(failedFile)}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {(draft.attachments ?? []).map((attachment) => (
          <div key={attachment.id} className="flex items-center justify-between gap-2 px-5 py-1 text-body">
            <span className="truncate">{attachment.filename}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeAttachment(attachment.id)}>
              {t("editor.upload.remove")}
            </Button>
          </div>
        ))}
      </div>

      <div
        data-testid="create-task-footer"
        className="grid shrink-0 grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2.5 border-t border-surface-border/50 px-4 py-3 sm:flex sm:flex-wrap"
      >
        <div className="flex min-h-7 items-center gap-2 sm:mr-auto">
          <input
            ref={fileInputRef}
            id="task-attachments"
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadFile(file);
              event.target.value = "";
            }}
          />
          <PillButton
            type="button"
            aria-label={t("tasks.detail.attachments_section")}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-3.5" aria-hidden />
          </PillButton>
        </div>
        <button
          type="button"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          title={t("tasks.create.switch_to_agent")}
          className="group flex shrink-0 items-center gap-1.5 justify-self-end rounded-sm border border-primary/20 bg-primary/5 px-2 py-1 text-caption text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!busy) onSwitchMode({ project_id: draft.projectId });
          }}
        >
          <ArrowLeftRight
            className="size-3.5 shrink-0 text-primary transition-transform duration-300 group-hover:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
          {t("tasks.create.switch_to_agent")}
        </button>
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-caption text-muted-foreground">
          <Switch
            checked={createAnother}
            onCheckedChange={setCreateAnother}
            aria-label={t("tasks.create.create_another_short")}
          />
          <span aria-hidden>{t("tasks.create.create_another_short")}</span>
        </label>
        <Button type="submit" aria-disabled={!canSubmit || undefined} className="justify-self-end gap-2">
          {busy ? t("tasks.create.creating") : t("common.create")}
          {!busy && sendShortcut ? <ShortcutKeycaps shortcut={sendShortcut} decorative /> : null}
        </Button>
      </div>
    </form>
  );
}
