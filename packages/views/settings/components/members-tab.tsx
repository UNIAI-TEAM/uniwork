"use client";

import { useTranslation } from "react-i18next";
import { useWorkspace } from "../../layout/workspace-context";
import { MembersView } from "../../workspace/members-view";
import { SettingsTab } from "./settings-layout";

export function MembersTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();

  return (
    <SettingsTab title={t("page.tabs.members")}>
      <MembersView workspaceId={workspace.id} embedded />
    </SettingsTab>
  );
}
