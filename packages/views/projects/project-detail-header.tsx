"use client";

import { useTranslation } from "react-i18next";
import type { Project } from "@uniwork/core/types/project";
import { ContentEditor, TitleEditor } from "../editor";
import { ProjectSidebarSection } from "./components/project-sidebar-section";
import { ProjectIconField } from "./create-project-fields";
import { useProjectFieldSave } from "./use-project-field-save";

const DESCRIPTION_SAVE_DEBOUNCE_MS = 1500;

/** Icon + title at the top of the project detail sidebar; the title saves on blur. */
export function ProjectDetailHeader({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: Project;
}) {
  const { t } = useTranslation();
  const save = useProjectFieldSave(workspaceId, project);

  return (
    <div>
      <ProjectIconField
        value={project.icon ?? undefined}
        onChange={(icon) => save({ icon })}
        className="text-display-sm"
      />
      <TitleEditor
        key={`${project.id}:${project.title}`}
        defaultValue={project.title}
        placeholder={t("projects.detail.title_placeholder")}
        className="mt-2 w-full text-title-sm leading-snug font-semibold tracking-tight"
        onBlur={(value) => {
          const trimmed = value.trim();
          if (trimmed && trimmed !== project.title) save({ title: trimmed });
        }}
      />
    </div>
  );
}

/**
 * Markdown description, saved on a debounce and flushed on unmount so leaving
 * the page right after typing still saves.
 */
export function ProjectDescriptionSection({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: Project;
}) {
  const { t } = useTranslation();
  const save = useProjectFieldSave(workspaceId, project);

  return (
    <ProjectSidebarSection title={t("projects.detail.section_description")}>
      <div className="pl-2">
        <ContentEditor
          key={project.id}
          value={project.description}
          ariaLabel={t("projects.detail.description_placeholder")}
          placeholder={t("projects.detail.description_placeholder")}
          onUpdate={(markdown) => {
            if (markdown !== project.description) save({ description: markdown });
          }}
          debounceMs={DESCRIPTION_SAVE_DEBOUNCE_MS}
          flushPendingOnUnmount
          className="min-h-20"
        />
        <p className="mt-1 text-caption text-muted-foreground">
          {t("projects.detail.description_hint")}
        </p>
      </div>
    </ProjectSidebarSection>
  );
}
