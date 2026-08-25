"use client";
import { useTranslation } from "react-i18next";
import { useWorkspaces } from "@uniwork/core/workspaces";
import type { Workspace } from "@uniwork/core/types";
import { CreateWorkspaceForm } from "./create-workspace-form";

export function WorkspacePickerView({ onPick }: { onPick: (w: Workspace) => void }) {
  const { t } = useTranslation();
  const { data: workspaces, isLoading } = useWorkspaces();

  if (isLoading) return <p className="p-8 text-secondary">{t("common.loading")}</p>;

  return (
    <div className="mx-auto max-w-md p-8">
      {workspaces && workspaces.length > 0 ? (
        <div className="space-y-2">
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => onPick(w)}
              className="block w-full rounded-lg border border-line bg-surface px-4 py-3 text-left text-sm font-medium text-primary hover:bg-subtle"
            >
              {w.name}
              <span className="ml-2 text-[12px] font-normal text-tertiary">/{w.slug}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="mb-4 text-lg font-semibold text-primary">{t("workspace.create")}</h1>
          <CreateWorkspaceForm onCreated={onPick} />
        </div>
      )}
    </div>
  );
}
