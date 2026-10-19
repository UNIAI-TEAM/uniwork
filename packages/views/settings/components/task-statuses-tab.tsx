"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import {
  useCreateTaskStatus,
  useDeleteTaskStatus,
  usePatchTaskStatus,
  useReorderTaskStatuses,
  useTaskStatuses,
} from "@uniwork/core/tasks";
import { TASK_STATUSES, type TaskCatalogStatus, type TaskStatusCategory } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { useWorkspace } from "../../layout/workspace-context";
import { StatusIcon } from "../../tasks/icons/status-icon";
import { toastApiError } from "../../toast-api-error";
import { isHexColor, SWATCH_HEX } from "./catalog-color-field";
import { CatalogItemDialog, type CatalogDraft, type CatalogSaveResult } from "./catalog-item-dialog";
import {
  SettingsBadge,
  SettingsCard,
  SettingsLoadError,
  SettingsSkeletonRows,
  SettingsTab,
} from "./settings-layout";
import { statusRowText, TaskStatusRow } from "./task-status-row";

/**
 * A key for a new status. The server keeps only a–z, 0–9 and `_` (and would
 * drop every accented letter), so Vietnamese is folded first: "Chờ duyệt"
 * keys as `cho_duyet_x7k2`. The suffix keeps a name reused after archiving
 * from colliding with the archived status, which still holds its key.
 */
export function statusKeyFrom(name: string, suffix = Math.random().toString(36).slice(2, 6)): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
    .replace(/_+$/, "");
  return `${base || "status"}_${suffix}`;
}

/**
 * UniAI's four groups over the seven categories the server keys on (the
 * server's statusGroupOf, task_status_catalog.go). `add` is the category a
 * status created in, or moved to, the group gets.
 */
const STATUS_GROUPS: readonly { id: string; categories: readonly TaskStatusCategory[]; add: TaskStatusCategory }[] = [
  { id: "not_started", categories: ["backlog", "todo"], add: "todo" },
  { id: "started", categories: ["in_progress", "in_review", "blocked"], add: "in_progress" },
  { id: "completed", categories: ["done"], add: "done" },
  { id: "closed", categories: ["cancelled"], add: "cancelled" },
];

const groupOf = (category: string | undefined) =>
  STATUS_GROUPS.find((g) => g.categories.includes(category as TaskStatusCategory)) ?? STATUS_GROUPS[0]!;

type DialogTarget = { category: TaskStatusCategory; status?: TaskCatalogStatus };

/**
 * The workspace's task statuses, laid out as UniAI's settings page: one card,
 * a strip per group with its "+", rows ordered by drag (or the row menu)
 * inside their group, built-ins included. Built-ins drive the product, so
 * they are never edited or archived; owners and admins add their own with a
 * group, a colour and an icon. The order is the one the board, lists and
 * menus use. Archived statuses stay on the tasks already in them.
 */
export function TaskStatusesTab() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const wsId = workspace.id;
  const { data, isLoading, isError, refetch } = useTaskStatuses(wsId);
  const canManage = useWorkspacePermissions(wsId).canManageTaskCatalog.allowed;
  const create = useCreateTaskStatus(wsId);
  const patch = usePatchTaskStatus(wsId);
  const reorder = useReorderTaskStatuses(wsId);
  const archive = useDeleteTaskStatus(wsId);
  // Targets outlive their dialogs' open state, so titles hold while closing.
  const [target, setTarget] = useState<DialogTarget>({ category: "todo" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState<TaskCatalogStatus | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // A group's order as just dropped, shown until the refetch lands so a row
  // does not jump back for a frame.
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const groups = useMemo(() => {
    const live = (data?.statuses ?? []).filter((s) => !s.archived_at).sort((a, b) => a.position - b.position);
    return STATUS_GROUPS.map((group) => {
      const rows = live.filter((s) => group.categories.includes(s.category as TaskStatusCategory));
      const order = pending[group.id];
      const byId = new Map(rows.map((s) => [s.id, s]));
      const statuses =
        order && order.length === rows.length && order.every((id) => byId.has(id))
          ? order.map((id) => byId.get(id)!)
          : rows;
      return { ...group, statuses };
    });
  }, [data, pending]);

  const groupName = (id: string) => t(`settings.taskStatuses.group_${id}`);

  const reorderGroup = (group: string, ids: string[]) => {
    if (reorder.isPending) return;
    setPending((p) => ({ ...p, [group]: ids }));
    reorder.mutate(
      { group, ids },
      {
        onError: (err) => toastApiError(err, t("common.error")),
        onSettled: () =>
          setPending((p) => {
            const rest = { ...p };
            delete rest[group];
            return rest;
          }),
      },
    );
  };

  const onDragEnd = (group: string, ids: string[]) => (event: DragEndEvent) => {
    const from = ids.indexOf(String(event.active.id));
    const to = event.over ? ids.indexOf(String(event.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    reorderGroup(group, arrayMove(ids, from, to));
  };

  const openDialog = (next: DialogTarget) => {
    setTarget(next);
    setDialogOpen(true);
  };

  const save = async ({ name, description, color, category, icon }: CatalogDraft): Promise<CatalogSaveResult> => {
    const body = { name, description, color, category: category ?? target.category, icon: icon ?? "" };
    try {
      if (target.status) {
        // A built-in's category is its key; the server refuses to move it.
        const { category: _category, ...fields } = body;
        await patch.mutateAsync({ id: target.status.id, body: target.status.is_system ? fields : body });
        toast.success(t("settings.taskStatuses.updated"));
      } else {
        await create.mutateAsync({ ...body, key: statusKeyFrom(name) });
        toast.success(t("settings.taskStatuses.created"));
      }
      return "saved";
    } catch (err) {
      if (errorCode(err) === "conflict") return "conflict";
      toastApiError(err, t("common.error"));
      return "failed";
    }
  };

  const confirmArchive = () => {
    if (!archiving || archive.isPending) return;
    archive.mutate(archiving.id, {
      onSuccess: () => {
        toast.success(t("settings.taskStatuses.archived"));
        setArchiveOpen(false);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsTab
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {t("settings.page.tabs.taskStatuses")}
          <SettingsBadge>{t("settings.taskStatuses.workspace_chip", { name: workspace.name })}</SettingsBadge>
        </span>
      }
      description={canManage ? t("settings.taskStatuses.description") : t("settings.taskStatuses.description_read_only")}
    >
      {isLoading ? (
        <SettingsSkeletonRows rows={4} />
      ) : isError ? (
        <SettingsCard>
          <SettingsLoadError onRetry={() => void refetch()}>{t("settings.taskStatuses.load_error")}</SettingsLoadError>
        </SettingsCard>
      ) : (
        <div
          data-testid="task-status-groups"
          className="overflow-hidden rounded-lg border border-surface-border bg-surface"
        >
          {groups.map((group) => {
            const ids = group.statuses.map((s) => s.id);
            return (
              <section key={group.id} className="border-b border-surface-border last:border-b-0">
                <div className="flex min-h-10 items-center justify-between gap-2 bg-muted/20 px-4 py-1.5">
                  <h3 className="text-caption font-medium text-muted-foreground">{groupName(group.id)}</h3>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("settings.taskStatuses.add_in", { name: groupName(group.id) })}
                      onClick={() => openDialog({ category: group.add })}
                    >
                      <Plus aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(group.id, ids)}>
                  <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    <ul aria-label={groupName(group.id)} className="divide-y divide-surface-border">
                      {group.statuses.map((status, index) => (
                        <TaskStatusRow
                          key={status.id}
                          status={status}
                          canManage={canManage}
                          draggable={ids.length > 1}
                          isFirst={index === 0}
                          isLast={index === ids.length - 1}
                          onMove={(by) => reorderGroup(group.id, arrayMove(ids, index, index + by))}
                          onEdit={() => openDialog({ category: status.category as TaskStatusCategory, status })}
                          onArchive={() => {
                            setArchiving(status);
                            setArchiveOpen(true);
                          }}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </section>
            );
          })}
        </div>
      )}

      <CatalogItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={target.status ? t("settings.taskStatuses.edit_title") : t("settings.taskStatuses.create_title")}
        initial={{
          ...(target.status ? statusRowText(target.status, t) : { name: "", description: "" }),
          color: target.status?.color || SWATCH_HEX.blue,
          category: target.category,
          icon: target.status?.icon ?? "",
        }}
        submitLabel={t("common.save")}
        onSubmit={save}
        colorPreview={(draft, hex) => <StatusIcon status={draft.icon || draft.category || "todo"} color={hex} />}
        afterName={(draft, set) => {
          const group = groupOf(draft.category);
          const locked = Boolean(target.status?.is_system);
          return (
            <Field>
              <FieldLabel>{t("settings.taskStatuses.category")}</FieldLabel>
              <Select
                aria-label={t("settings.taskStatuses.category")}
                value={group.id}
                disabled={locked}
                onValueChange={(v) => {
                  const next = STATUS_GROUPS.find((g) => g.id === v) ?? group;
                  // Staying in the status's own group keeps its category.
                  set({ category: next === groupOf(target.category) ? target.category : next.add });
                }}
                items={STATUS_GROUPS.map((g) => ({ value: g.id, label: groupName(g.id) }))}
              />
              <FieldDescription>
                {locked ? t("settings.taskStatuses.category_locked") : t(`settings.taskStatuses.group_hint_${group.id}`)}
              </FieldDescription>
            </Field>
          );
        }}
        afterColor={(draft, set) => <IconField draft={draft} onChange={(icon) => set({ icon })} />}
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setArchiveOpen(false);
        }}
        title={t("settings.taskStatuses.archive_title", { name: archiving?.name })}
        description={t("settings.taskStatuses.archive_body")}
        confirmLabel={t("settings.taskStatuses.archive")}
        onConfirm={confirmArchive}
        pending={archive.isPending}
      />
    </SettingsTab>
  );
}

/** "Default" draws the status's own category glyph; any other is borrowed. */
function IconField({ draft, onChange }: { draft: CatalogDraft; onChange: (icon: string) => void }) {
  const { t } = useTranslation();
  const color = isHexColor(draft.color) ? draft.color : undefined;
  const icon = draft.icon ?? "";
  const tile = "aria-pressed:border-ring aria-pressed:bg-surface-selected";
  return (
    <Field>
      <FieldLabel>{t("settings.taskStatuses.icon")}</FieldLabel>
      <div role="group" aria-label={t("settings.taskStatuses.icon")} className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={icon === ""}
          className={tile}
          onClick={() => onChange("")}
        >
          {t("settings.taskStatuses.icon_default")}
        </Button>
        {TASK_STATUSES.map((glyph) => (
          <Button
            key={glyph}
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("settings.taskStatuses.icon_option", { name: t(`tasks.status_${glyph}`) })}
            aria-pressed={icon === glyph}
            className={tile}
            onClick={() => onChange(glyph)}
          >
            <StatusIcon status={glyph} color={color} />
          </Button>
        ))}
      </div>
    </Field>
  );
}
