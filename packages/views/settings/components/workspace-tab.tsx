"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import { usePatchWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { toast } from "sonner";
import { useWorkspace } from "../../layout/workspace-context";
import { useOptionalNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import { SettingsCard, SettingsRow, SettingsSaveState, SettingsTab, SettingsValue } from "./settings-layout";
import { useAutoSave } from "./use-auto-save";

function namesEqual(left: string, right: string) {
  return left === right;
}

/**
 * What the workspace is called, where it lives and whom it belongs to. The
 * API only lets the name change (PATCH /workspaces/{id} takes `name`), and
 * there is no endpoint to delete or archive a workspace, so this tab carries
 * no danger zone.
 */
export function WorkspaceTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();
  const navigation = useOptionalNavigation();
  const { canUpdateSettings, isLoading: permissionsLoading } = useWorkspacePermissions(workspace.id);
  const patchWorkspace = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const [name, setName] = useState(workspace.name);
  const canEdit = canUpdateSettings.allowed;
  const path = paths.workspace(workspace.organization_slug, workspace.slug).root();
  const url = navigation?.getShareableUrl(path) ?? path;

  useEffect(() => {
    setName(workspace.name);
  }, [workspace.id, workspace.name]);

  const saveName = useCallback(
    async (nextName: string) => {
      const updated = await patchWorkspace.mutateAsync({ wsId: workspace.id, name: nextName });
      if (!updated) throw new Error(t("save.error"));
    },
    [patchWorkspace, t, workspace.id],
  );

  // Autosave reports itself inline; only a failure also raises a toast.
  const autoSave = useAutoSave({
    value: name,
    savedValue: workspace.name,
    onSave: saveName,
    onError: (err) => toastApiError(err, t("save.error")),
    enabled: canEdit && name.trim().length > 0,
    isEqual: namesEqual,
  });

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
            status={autoSave.status}
            savingLabel={t("save.saving")}
            savedLabel={t("save.saved")}
            errorLabel={t("save.error")}
          />
        ) : null
      }
    >
      <SettingsCard>
        <SettingsRow
          label={t("workspace.name")}
          description={canEdit || permissionsLoading ? t("workspace.name_hint") : t("workspace.name_read_only")}
          size="text"
        >
          {canEdit ? (
            <Input
              value={name}
              aria-label={t("workspace.name")}
              onChange={(e) => setName(e.target.value)}
              onBlur={autoSave.flush}
            />
          ) : (
            <SettingsValue>{workspace.name}</SettingsValue>
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
        <SettingsRow label={t("workspace.organization")} description={t("workspace.organization_hint")} size="text">
          <SettingsValue>{workspace.organization_name}</SettingsValue>
        </SettingsRow>
      </SettingsCard>
    </SettingsTab>
  );
}
