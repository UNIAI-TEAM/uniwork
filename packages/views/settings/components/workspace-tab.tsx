"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWorkspacePermissions } from "@uniwork/core/permissions";
import { usePatchWorkspace } from "@uniwork/core/workspaces";
import { Input } from "@uniwork/ui/components/ui/input";
import { useWorkspace } from "../../layout/workspace-context";
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveState,
  SettingsSection,
  SettingsTab,
} from "./settings-layout";
import { useAutoSave } from "./use-auto-save";

function namesEqual(left: string, right: string) {
  return left === right;
}

export function WorkspaceTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();
  const { canUpdateSettings } = useWorkspacePermissions(workspace.id);
  const patchWorkspace = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const [name, setName] = useState(workspace.name);
  const canEdit = canUpdateSettings.allowed;

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

  const autoSave = useAutoSave({
    value: name,
    savedValue: workspace.name,
    onSave: saveName,
    onSuccess: () => toast.success(t("workspace.toastUpdated"), { id: "settings-auto-save" }),
    onError: () => toast.error(t("save.error")),
    enabled: canEdit && name.trim().length > 0,
    isEqual: namesEqual,
  });

  const readOnlyValue = useMemo(() => workspace.name, [workspace.name]);

  return (
    <SettingsTab title={t("page.tabs.workspace")}>
      <SettingsSection
        title={t("workspace.section")}
        action={
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
          <SettingsRow label={t("workspace.name")} size="text">
            {canEdit ? (
              <Input
                value={name}
                aria-label={t("workspace.name")}
                onChange={(e) => setName(e.target.value)}
                onBlur={autoSave.flush}
              />
            ) : (
              <Input value={readOnlyValue} readOnly aria-readonly className="text-muted-foreground" />
            )}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}
