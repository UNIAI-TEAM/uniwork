"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, FolderGit, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import {
  useDeleteProjectResource,
  useProjectResources,
  usePutProjectResource,
} from "@uniwork/core/tasks";
import type { ProjectResource } from "@uniwork/core/types/project";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { resourceDisplayLabel } from "./resource-display-label";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/**
 * Project resources sidebar: list + rename/delete for existing rows.
 * GitHub / local_directory *add* controls stay capability-gated stubs — no
 * GitHub SDK or local daemon imports.
 */
export function ProjectResourcesSection({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const vcs = capabilityState(config, "tasks.vcs");
  const localWorkdir = capabilityState(config, "tasks.local_workdir");

  const { data } = useProjectResources(workspaceId, projectId);
  const resources = data?.resources ?? [];
  const putResource = usePutProjectResource(workspaceId, projectId);
  const deleteResource = useDeleteProjectResource(workspaceId, projectId);

  const unavailableReason = t("projects.capability_unavailable");
  const githubAvailable = vcs.status === "available";
  const localAvailable = localWorkdir.status === "available";

  const handleRemove = async (resource: ProjectResource) => {
    try {
      await deleteResource.mutateAsync(resource.id);
      toast.success(t("projects.resources.toast_removed"));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("projects.resources.toast_remove_failed"),
      );
    }
  };

  const handleRename = async (resource: ProjectResource, nextLabel: string) => {
    const trimmed = nextLabel.trim();
    if (trimmed === (resource.label ?? "").trim()) return;
    try {
      // Label only — never resend resource_ref (server replaces the ref wholesale).
      await putResource.mutateAsync({
        resourceId: resource.id,
        body: { label: trimmed },
      });
      toast.success(t("projects.resources.toast_renamed"));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("projects.resources.toast_rename_failed"),
      );
    }
  };

  return (
    <div>
      <button
        type="button"
        className={`mb-2 flex w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors hover:bg-accent/70 ${open ? "" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => setOpen(!open)}
      >
        {t("projects.resources.section_header")}
        <ChevronRight
          className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-1.5 pl-2">
          {resources.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("projects.resources.empty")}
            </p>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {resources.map((resource) => (
                <ResourceRow
                  key={resource.id}
                  resource={resource}
                  onRemove={() => void handleRemove(resource)}
                  onRename={(label) => void handleRename(resource, label)}
                />
              ))}
            </div>
          )}
          <CapabilityAddButton
            available={githubAvailable}
            reason={unavailableReason}
            label={t("projects.resources.add_github")}
            icon={<FolderGit className="size-3" aria-hidden />}
          />
          <CapabilityAddButton
            available={localAvailable}
            reason={unavailableReason}
            label={t("projects.resources.add_local_directory")}
            icon={<FolderOpen className="size-3" aria-hidden />}
          />
        </div>
      ) : null}
    </div>
  );
}

function CapabilityAddButton({
  available,
  reason,
  label,
  icon,
}: {
  available: boolean;
  reason: string;
  label: string;
  icon: ReactNode;
}) {
  if (available) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={label}
        className="h-7 justify-start px-2 text-caption text-muted-foreground hover:text-foreground"
      >
        {icon}
        {label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled
            aria-label={label}
            title={reason}
            className="h-7 justify-start px-2 text-caption text-muted-foreground opacity-60 hover:text-foreground"
          />
        }
      >
        {icon}
        {label}
      </TooltipTrigger>
      <TooltipContent side="bottom">{reason}</TooltipContent>
    </Tooltip>
  );
}

function ResourceRow({
  resource,
  onRemove,
  onRename,
}: {
  resource: ProjectResource;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const display = resourceDisplayLabel(resource);
  const [draft, setDraft] = useState(display);

  const startEdit = () => {
    setDraft(display);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    onRename(draft);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(display);
  };

  const Icon =
    resource.resource_type === "github_repo"
      ? FolderGit
      : resource.resource_type === "local_directory"
        ? FolderOpen
        : FolderOpen;

  return (
    <div className="group flex items-center gap-2 text-caption">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="min-w-0 flex-1 rounded-sm border bg-transparent px-1 py-0.5 text-caption outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t("projects.resources.rename_label")}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{display}</span>
      )}
      {!editing ? (
        <button
          type="button"
          onClick={startEdit}
          className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
          title={t("projects.resources.rename")}
        >
          <Pencil className="size-3 text-muted-foreground" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
        title={t("projects.resources.remove")}
      >
        <Trash2 className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}
