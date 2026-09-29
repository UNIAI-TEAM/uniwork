"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePutProject } from "@uniwork/core/tasks";
import type { Project } from "@uniwork/core/types/project";
import { Input } from "@uniwork/ui/components/ui/input";
import { ContentEditor } from "../editor";

const DESCRIPTION_SAVE_DEBOUNCE_MS = 1500;

/**
 * Title + description editors for project detail. The title saves on blur;
 * the description is a markdown ContentEditor saved on a debounce, flushed on
 * unmount so leaving the page right after typing still saves.
 */
export function ProjectDetailHeader({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: Project;
}) {
  const { t } = useTranslation();
  const putProject = usePutProject(workspaceId);
  const [title, setTitle] = useState(project.title);

  useEffect(() => {
    setTitle(project.title);
  }, [project.id, project.revision, project.title]);

  const saveField = useCallback(
    (patch: { title?: string; description?: string }) => {
      putProject.mutate({
        projectId: project.id,
        body: { ...patch, revision: project.revision },
        ifMatch: String(project.revision),
      });
    },
    [project.id, project.revision, putProject],
  );

  return (
    <div className="space-y-3">
      <Input
        aria-label={t("projects.detail.title_placeholder")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const trimmed = title.trim();
          if (trimmed && trimmed !== project.title) {
            saveField({ title: trimmed });
          } else if (trimmed !== title) {
            setTitle(project.title);
          }
        }}
        placeholder={t("projects.detail.title_placeholder")}
        className="text-title font-semibold"
      />
      <ContentEditor
        key={project.id}
        value={project.description}
        ariaLabel={t("projects.detail.description_placeholder")}
        placeholder={t("projects.detail.description_placeholder")}
        onUpdate={(markdown) => {
          if (markdown !== project.description) saveField({ description: markdown });
        }}
        debounceMs={DESCRIPTION_SAVE_DEBOUNCE_MS}
        flushPendingOnUnmount
        className="min-h-20"
      />
      <p className="text-caption text-muted-foreground">
        {t("projects.detail.description_hint")}
      </p>
    </div>
  );
}
