"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePutProject } from "@uniwork/core/tasks";
import type { Project } from "@uniwork/core/types/project";
import { Input } from "@uniwork/ui/components/ui/input";
import { Textarea } from "@uniwork/ui/components/ui/textarea";

/**
 * Title + description editors for project detail. Plain Input/Textarea with
 * blur save via usePutProject — no rich text editor in this slice.
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
  const [description, setDescription] = useState(project.description);

  useEffect(() => {
    setTitle(project.title);
    setDescription(project.description);
  }, [project.id, project.revision, project.title, project.description]);

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
      <Textarea
        aria-label={t("projects.detail.description_placeholder")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (description !== project.description) {
            saveField({ description });
          }
        }}
        placeholder={t("projects.detail.description_placeholder")}
        rows={4}
      />
      <p className="text-caption text-muted-foreground">
        {t("projects.detail.description_hint")}
      </p>
    </div>
  );
}
