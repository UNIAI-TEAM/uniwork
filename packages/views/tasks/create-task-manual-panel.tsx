"use client";

import { useRef } from "react";
import { Maximize2, Minimize2, Paperclip, X } from "lucide-react";
import { useShortcut } from "@uniwork/core/shortcuts";
import type { CreateTaskBody } from "@uniwork/core/tasks";
import type { CreateTaskDraft } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { PillButton } from "../common/pill-button";
import { ContentEditor } from "../editor";
import { ShortcutKeycaps } from "../editor/shortcut-keycaps";
import { CreateTaskManualOverflow } from "./create-task-manual-overflow";
import { AssigneePicker } from "./pickers/assignee-picker";
import { LabelPicker } from "./pickers/label-picker";
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

const pillTriggerClass =
  "h-8 max-w-56 justify-start rounded-full border border-border/80 bg-muted/40 px-2.5 text-caption font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground";

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
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <Input
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
          className="border-0 bg-transparent px-0 text-title shadow-none focus-visible:ring-0"
        />
        <div className="min-h-24">
          <ContentEditor
            key={draft.idempotencyKey}
            defaultValue={draft.description ?? ""}
            ariaLabel={t("tasks.description")}
            placeholder={t("tasks.create.description_placeholder")}
            onDocumentChange={(description) => updateDraft({ description })}
            onSubmit={submit}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            id="task-status"
            aria-label={t("tasks.status")}
            items={statusItems}
            value={draft.status ?? "todo"}
            onValueChange={(value) => updateDraft({ status: value ?? "todo" })}
            triggerVariant="subtle"
          />
          <Select
            id="task-priority"
            aria-label={t("tasks.priority")}
            items={priorityItems}
            value={draft.priority ?? "none"}
            onValueChange={(value) =>
              updateDraft({ priority: (value as CreateTaskDraft["priority"]) ?? "none" })
            }
            triggerVariant="subtle"
          />
          <AssigneePicker
            value={assignee}
            options={assignees.options}
            onChange={(value) => updateDraft({ assigneeId: value?.id, assigneeKind: value?.kind })}
            ariaLabel={t("tasks.assignee")}
            valueLabel={assigneeLabel}
            unassignedLabel={t("tasks.unassigned")}
            searchPlaceholder={t("tasks.assignee_search_placeholder")}
            noResultsLabel={t("tasks.assignee_no_results")}
            triggerClassName={pillTriggerClass}
          >
            <span className="truncate">{assigneeLabel}</span>
          </AssigneePicker>
          <LabelPicker
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
            triggerClassName={pillTriggerClass}
          >
            <span className="truncate">
              {t("tasks.create.labels_selected", { count: draft.labelIds?.length ?? 0 })}
            </span>
          </LabelPicker>
          <Select
            id="task-project"
            aria-label={t("tasks.create.project")}
            items={projectItems}
            value={draft.projectId || "__none__"}
            onValueChange={(value) =>
              updateDraft({ projectId: !value || value === "__none__" ? undefined : value })
            }
            triggerVariant="subtle"
          />
          <CreateTaskManualOverflow
            moreFieldsLabel={t("tasks.create.more_fields")}
            clearLabel={t("common.delete")}
            parentLabel={t("tasks.create.parent")}
            stageLabel={t("tasks.create.stage")}
            startDateLabel={t("tasks.create.start_date")}
            dueDateLabel={t("tasks.dueDate")}
            revealed={revealed}
            onReveal={reveal}
            onClear={unreveal}
            parentItems={parentItems}
            parentValue={draft.parentTaskId}
            onParentChange={(value) => updateDraft({ parentTaskId: value })}
            stageValue={draft.stage}
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
          <p className="text-caption text-muted-foreground" aria-live="polite">
            {t("tasks.detail.attachments_uploading", {
              filename: uploadAttachment.variables?.name ?? "",
            })}
          </p>
        ) : null}
        {failedFile ? (
          <div className="flex items-center justify-between gap-2 text-body" role="alert">
            <span>{t("editor.upload.failed_label", { filename: failedFile.name })}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => uploadFile(failedFile)}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {(draft.attachments ?? []).map((attachment) => (
          <div key={attachment.id} className="flex items-center justify-between gap-2 text-body">
            <span className="truncate">{attachment.filename}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeAttachment(attachment.id)}>
              {t("editor.upload.remove")}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={busy || undefined}
            onClick={() => onSwitchMode({ project_id: draft.projectId })}
          >
            {t("tasks.create.switch_to_agent")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-muted-foreground">
            <Switch
              checked={createAnother}
              onCheckedChange={setCreateAnother}
              aria-label={t("tasks.create.create_another_short")}
            />
            <span aria-hidden>{t("tasks.create.create_another_short")}</span>
          </label>
          <Button type="submit" aria-disabled={!canSubmit || undefined} className="gap-2">
            {busy ? t("tasks.create.creating") : t("common.create")}
            {!busy && sendShortcut ? <ShortcutKeycaps shortcut={sendShortcut} decorative /> : null}
          </Button>
        </div>
      </div>
    </form>
  );
}
