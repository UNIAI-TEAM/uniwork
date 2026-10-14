"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import { usePatchWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { toast } from "sonner";
import { WorkspaceIcon } from "../../layout/workspace-icon";
import { useWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import {
  SettingsCard,
  SettingsFieldError,
  SettingsRow,
  SettingsSaveState,
  type SettingsSaveStatus,
  SettingsTab,
  SettingsValue,
} from "./settings-layout";
import { useAutoSave } from "./use-auto-save";
import { WorkspaceIconField } from "./workspace-icon-field";
import { WorkspaceTaskPrefixDialog } from "./workspace-task-prefix-dialog";

function namesEqual(left: string, right: string) {
  return left === right;
}

// The server trims the description, so trailing spaces are not a change.
function descriptionsEqual(left: string, right: string) {
  return left.trim() === right.trim();
}

/** Mirrors maxWorkspaceNameRunes in server/internal/service/workspace.go. */
const MAX_NAME_LENGTH = 100;
/** Mirrors maxWorkspaceDescriptionRunes in server/internal/service/workspace.go. */
const MAX_DESCRIPTION_LENGTH = 500;

/** One indicator for the tab's autosaved fields: the busiest state wins. */
function combinedStatus(...all: SettingsSaveStatus[]): SettingsSaveStatus {
  for (const s of ["saving", "error", "saved"] as const) {
    if (all.includes(s)) return s;
  }
  return "idle";
}

/**
 * What the workspace is called, how it presents itself, where it lives and
 * whom it belongs to (spec 2026-10-14 §6.4). There is no endpoint to delete
 * or archive a workspace, so this tab carries no danger zone.
 */
export function WorkspaceTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();
  const navigation = useOptionalNavigation();
  const { canUpdateSettings, isLoading: permissionsLoading } = useWorkspacePermissions(workspace.id);
  const patchWorkspace = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const savedDescription = workspace.description ?? "";
  const prefix = workspace.task_prefix ?? "";
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(savedDescription);
  const canEdit = canUpdateSettings.allowed;
  const nameEmpty = name.trim().length === 0;
  const hintId = useId();
  const errorId = useId();
  const aboutHintId = useId();
  const path = paths.workspace(workspace.organization_slug, workspace.slug).root();
  const url = navigation?.getShareableUrl(path) ?? path;

  useEffect(() => {
    setName(workspace.name);
  }, [workspace.id, workspace.name]);

  // Take a new server value only into a field the user has not edited: the
  // server trims what autosave sent, and the refetch must not eat a trailing
  // space or keystrokes typed while the save was in flight.
  const lastSaved = useRef({ id: workspace.id, value: savedDescription });
  useEffect(() => {
    const prev = lastSaved.current;
    lastSaved.current = { id: workspace.id, value: savedDescription };
    if (prev.id !== workspace.id) {
      setDescription(savedDescription);
      return;
    }
    setDescription((current) =>
      descriptionsEqual(current, savedDescription) || !descriptionsEqual(current, prev.value)
        ? current
        : savedDescription,
    );
  }, [workspace.id, savedDescription]);

  const saveName = useCallback(
    async (nextName: string) => {
      const updated = await patchWorkspace.mutateAsync({ wsId: workspace.id, name: nextName });
      if (!updated) throw new Error(t("save.error"));
    },
    [patchWorkspace, t, workspace.id],
  );

  const saveDescription = useCallback(
    async (next: string) => {
      const updated = await patchWorkspace.mutateAsync({ wsId: workspace.id, description: next });
      if (!updated) throw new Error(t("save.error"));
    },
    [patchWorkspace, t, workspace.id],
  );

  // Autosave reports itself inline; only a failure also raises a toast.
  const nameSave = useAutoSave({
    value: name,
    savedValue: workspace.name,
    onSave: saveName,
    onError: (err) => toastApiError(err, t("save.error")),
    // An empty name is refused by the server; it is flagged inline instead
    // and put back on blur, never sent.
    enabled: canEdit && !nameEmpty,
    isEqual: namesEqual,
  });

  const descriptionSave = useAutoSave({
    value: description,
    savedValue: savedDescription,
    onSave: saveDescription,
    onError: (err) => toastApiError(err, t("save.error")),
    enabled: canEdit,
    isEqual: descriptionsEqual,
  });

  const onNameBlur = () => {
    if (nameEmpty) {
      setName(workspace.name);
      return;
    }
    nameSave.flush();
  };

  const copyUrl = async () => {
    if (await copyText(url)) {
      toast.success(t("workspace.url_copied"));
    } else {
      toast.error(t("workspace.copy_failed"));
    }
  };

  return (
    <SettingsTab
      title={t("page.tabs.workspace")}
      description={t("workspace.description")}
      actions={
        canEdit ? (
          <SettingsSaveState
            status={combinedStatus(nameSave.status, descriptionSave.status)}
            savingLabel={t("save.saving")}
            savedLabel={t("save.saved")}
            errorLabel={t("save.error")}
          />
        ) : null
      }
    >
      <SettingsCard>
        <SettingsRow label={t("workspace.icon")} description={t("workspace.icon_hint")} size="none">
          {canEdit ? (
            <WorkspaceIconField workspace={workspace} />
          ) : (
            <WorkspaceIcon
              workspace={workspace}
              className="size-10 rounded-lg bg-primary text-title font-semibold text-primary-foreground sm:ml-auto"
            />
          )}
        </SettingsRow>
        <SettingsRow
          label={t("workspace.name")}
          description={canEdit || permissionsLoading ? t("workspace.name_hint") : t("workspace.name_read_only")}
          descriptionId={hintId}
          size="text"
        >
          {permissionsLoading ? (
            // Input-sized, so the row does not jump when the field arrives.
            <Skeleton aria-hidden className="h-8 w-full" />
          ) : canEdit ? (
            <div className="space-y-1.5">
              <Input
                value={name}
                maxLength={MAX_NAME_LENGTH}
                aria-label={t("workspace.name")}
                aria-invalid={nameEmpty || undefined}
                aria-describedby={nameEmpty ? `${errorId} ${hintId}` : hintId}
                onChange={(e) => setName(e.target.value)}
                onBlur={onNameBlur}
              />
              {nameEmpty ? <SettingsFieldError id={errorId}>{t("workspace.name_required")}</SettingsFieldError> : null}
            </div>
          ) : (
            <SettingsValue>{workspace.name}</SettingsValue>
          )}
        </SettingsRow>
        <SettingsRow
          label={t("workspace.about")}
          description={canEdit || permissionsLoading ? t("workspace.about_hint") : t("workspace.about_read_only")}
          descriptionId={aboutHintId}
          size="text"
          align="start"
        >
          {permissionsLoading ? (
            <Skeleton aria-hidden className="h-20 w-full" />
          ) : canEdit ? (
            <div className="space-y-1">
              <Textarea
                value={description}
                rows={3}
                maxLength={MAX_DESCRIPTION_LENGTH}
                placeholder={t("workspace.about_placeholder")}
                aria-label={t("workspace.about")}
                aria-describedby={aboutHintId}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => descriptionSave.flush()}
              />
              <p className="text-right text-caption tabular-nums text-muted-foreground">
                {t("workspace.about_count", { used: description.length, max: MAX_DESCRIPTION_LENGTH })}
              </p>
            </div>
          ) : (
            <SettingsValue className="overflow-visible whitespace-pre-wrap text-clip break-words">
              {workspace.description || t("workspace.about_empty")}
            </SettingsValue>
          )}
        </SettingsRow>
        <SettingsRow label={t("workspace.url")} description={t("workspace.url_hint")} size="none">
          <div className="flex min-w-0 items-center gap-2 sm:justify-end">
            <SettingsValue className="min-w-0 font-mono text-caption">{url}</SettingsValue>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("workspace.copy_url")}
              title={t("workspace.copy_url")}
              onClick={() => void copyUrl()}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        </SettingsRow>
        {prefix ? (
          <SettingsRow
            label={t("workspace.task_prefix")}
            description={t("workspace.task_prefix_hint", { example: `${prefix}-12` })}
            size="none"
          >
            <div className="flex items-center gap-2 sm:justify-end">
              <SettingsValue className="font-mono">{prefix}</SettingsValue>
              {canEdit ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPrefixOpen(true)}>
                  {t("workspace.task_prefix_change")}
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
        <SettingsRow label={t("workspace.organization")} description={t("workspace.organization_hint")} size="text">
          <SettingsValue>{workspace.organization_name}</SettingsValue>
        </SettingsRow>
      </SettingsCard>
      {canEdit ? <WorkspaceTaskPrefixDialog workspace={workspace} open={prefixOpen} onOpenChange={setPrefixOpen} /> : null}
    </SettingsTab>
  );
}
