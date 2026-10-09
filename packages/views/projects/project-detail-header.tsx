"use client";

import { useTranslation } from "react-i18next";
import type { Project } from "@uniwork/core/types/project";
import { ContentEditor, ReadonlyContent, TitleEditor } from "../editor";
import { SidebarSection } from "../common/sidebar-section";
import { ProjectIcon } from "./components/project-icon";
import { ProjectIconField } from "./create-project-fields";
import { useProjectFieldSave } from "./use-project-field-save";

const DESCRIPTION_SAVE_DEBOUNCE_MS = 1500;

/**
 * Icon + title at the top of the project detail sidebar; the title saves on
 * blur. `readOnly` shows them as text for a project the viewer may not edit.
 */
export function ProjectDetailHeader({
  workspaceId,
  project,
  readOnly = false,
}: {
  workspaceId: string;
  project: Project;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const save = useProjectFieldSave(workspaceId, project);

  if (readOnly) {
    return (
      <div>
        <ProjectIcon project={project} size="lg" className="text-display-sm" />
        <h2 className="mt-2 w-full text-title-sm leading-snug font-semibold tracking-tight break-words">
          {project.title}
        </h2>
        <p className="mt-1 text-caption text-muted-foreground">
          {t("projects.detail.read_only")}
        </p>
      </div>
    );
  }

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
  readOnly = false,
}: {
  workspaceId: string;
  project: Project;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const save = useProjectFieldSave(workspaceId, project);

  if (readOnly) {
    return (
      <SidebarSection title={t("projects.detail.section_description")}>
        <div className="pl-2">
          {project.description.trim() ? (
            <ReadonlyContent content={project.description} className="text-body" />
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("projects.detail.description_empty")}
            </p>
          )}
        </div>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title={t("projects.detail.section_description")}>
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
    </SidebarSection>
  );
}
