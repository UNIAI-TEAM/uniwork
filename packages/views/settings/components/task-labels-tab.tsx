"use client";

import { Ellipsis, Pencil, Plus, Search, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import { useCreateTaskLabel, useDeleteTaskLabel, usePutTaskLabel, useTaskLabels } from "@uniwork/core/tasks";
import type { TaskLabel } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { useWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import { ColorDot, SWATCH_HEX } from "./catalog-color-field";
import { CatalogItemDialog, type CatalogDraft, type CatalogSaveResult } from "./catalog-item-dialog";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsTab,
} from "./settings-layout";

/**
 * The workspace's task labels: what each one is for and how many tasks carry
 * it. Owners and admins create, edit and delete them; deleting a label takes
 * it off every task, so it asks first and says how many.
 */
export function TaskLabelsTab() {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const wsId = workspace.id;
  const { data, isLoading, isError, refetch } = useTaskLabels(wsId);
  const canManage = useWorkspacePermissions(wsId).canManageTaskCatalog.allowed;
  const create = useCreateTaskLabel(wsId);
  const put = usePutTaskLabel(wsId);
  const remove = useDeleteTaskLabel(wsId);
  const [query, setQuery] = useState("");
  // Targets outlive their dialogs' open state, so titles hold while closing.
  const [editing, setEditing] = useState<TaskLabel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<TaskLabel | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const labels = useMemo(() => (data?.labels ?? []).filter((l) => !l.archived_at), [data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter((l) => l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q));
  }, [labels, query]);

  const openDialog = (label: TaskLabel | null) => {
    setEditing(label);
    setDialogOpen(true);
  };

  const save = async (draft: CatalogDraft): Promise<CatalogSaveResult> => {
    try {
      if (editing) {
        await put.mutateAsync({ id: editing.id, body: draft });
        toast.success(t("settings.taskLabels.updated"));
      } else {
        await create.mutateAsync(draft);
        toast.success(t("settings.taskLabels.created"));
      }
      return "saved";
    } catch (err) {
      if (errorCode(err) === "conflict") return "conflict";
      toastApiError(err, t("common.error"));
      return "failed";
    }
  };

  const confirmDelete = () => {
    if (!deleting || remove.isPending) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(t("settings.taskLabels.deleted"));
        setDeleteOpen(false);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsTab
      title={t("settings.page.tabs.taskLabels")}
      description={canManage ? t("settings.taskLabels.description") : t("settings.taskLabels.description_read_only")}
      actions={
        canManage ? (
          <Button type="button" size="sm" onClick={() => openDialog(null)}>
            <Plus aria-hidden />
            {t("settings.taskLabels.add")}
          </Button>
        ) : null
      }
    >
      <SettingsSection
        title={isLoading || isError || labels.length === 0 ? null : t("settings.taskLabels.count", { count: labels.length })}
        action={
          labels.length > 0 ? (
            <div className="relative w-full sm:w-64">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("settings.taskLabels.filter_placeholder")}
                aria-label={t("settings.taskLabels.filter")}
                className="pl-8"
              />
            </div>
          ) : null
        }
      >
        {isLoading ? (
          <SettingsSkeletonRows rows={3} />
        ) : isError ? (
          <SettingsCard>
            <SettingsLoadError onRetry={() => void refetch()}>{t("settings.taskLabels.load_error")}</SettingsLoadError>
          </SettingsCard>
        ) : shown.length === 0 ? (
          <SettingsCard>
            <SettingsEmpty icon={<Tag />}>
              {labels.length > 0
                ? t("settings.taskLabels.no_match", { query: query.trim() })
                : canManage
                  ? t("settings.taskLabels.empty_admin")
                  : t("settings.taskLabels.empty_member")}
            </SettingsEmpty>
          </SettingsCard>
        ) : (
          <SettingsList aria-label={t("settings.page.tabs.taskLabels")}>
            {shown.map((label) => (
              <SettingsListItem
                key={label.id}
                leading={
                  <span className="flex size-7 items-center justify-center">
                    <ColorDot hex={label.color} className="size-3" />
                  </span>
                }
                title={label.name}
                meta={[
                  label.description,
                  t("settings.taskLabels.usage", { count: label.usage_count }),
                  t("settings.taskLabels.updated_on", {
                    date: new Date(label.updated_at).toLocaleDateString(i18n.language),
                  }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                actions={
                  canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("settings.taskLabels.actions", { name: label.name })}
                          />
                        }
                      >
                        <Ellipsis aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDialog(label)}>
                          <Pencil aria-hidden />
                          {t("settings.taskLabels.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            setDeleting(label);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 aria-hidden />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null
                }
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      <CatalogItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? t("settings.taskLabels.edit_title") : t("settings.taskLabels.create_title")}
        initial={{
          name: editing?.name ?? "",
          description: editing?.description ?? "",
          color: editing?.color || SWATCH_HEX.blue,
        }}
        submitLabel={editing ? t("common.save") : t("settings.taskLabels.create")}
        onSubmit={save}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteOpen(false);
        }}
        title={t("settings.taskLabels.delete_title", { name: deleting?.name })}
        description={
          deleting && deleting.usage_count > 0
            ? t("settings.taskLabels.delete_body", { count: deleting.usage_count })
            : t("settings.taskLabels.delete_body_unused")
        }
        confirmLabel={t("common.delete")}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </SettingsTab>
  );
}
