"use client";
import { ChevronDown, DoorOpen, FolderKanban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProjects } from "@uniwork/core/tasks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { useProjectsAvailable } from "../../projects/components/project-select";
import { MENU_ITEM_LEFT_CHECK, PROPERTY_CHIP } from "./sheet-styles";

const NO_PROJECT = "__none__";

/**
 * The chip row under the agenda (create brief §2.6): Dự án and Vào phòng,
 * each a muted key and its value; a menu edits it. The project chip shows
 * only where the workspace offers projects, Vào phòng only for a meeting held online.
 */
export function PropertyChips({
  workspaceId,
  projectId,
  onProject,
  allowJoin,
  onAllowJoin,
  showJoin = true,
  readOnly,
  className,
}: {
  workspaceId: string;
  projectId: string;
  onProject: (id: string) => void;
  allowJoin: boolean;
  onAllowJoin: (allow: boolean) => void;
  /** An in-person meeting has no room to join. */
  showJoin?: boolean;
  readOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const projectsAvailable = useProjectsAvailable();
  const { data } = useProjects(projectsAvailable ? workspaceId : "");
  const projects = data?.projects ?? [];
  // A project missing from the list (deleted) reads as none, never as its raw id.
  const project = projects.find((p) => p.id === projectId);
  const projectLabel = project?.title ?? t("meetings.projectNone");
  const joinLabel = t(allowJoin ? "meetings.sheet.joinRequest" : "meetings.sheet.joinInvited");
  return (
    <div className={cn("mt-4 flex flex-wrap gap-2 max-sm:gap-y-3 max-sm:group-data-[phone-sheet]/sheet:gap-y-2 group-data-[fresh]/sheet:mt-3 group-data-[mode=live]/sheet:mt-3", className)}>
      {projectsAvailable ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={readOnly}
            className={PROPERTY_CHIP}
            aria-label={t("meetings.sheet.chipAria", { key: t("meetings.project"), value: projectLabel })}
          >
            <FolderKanban aria-hidden />
            <span className="text-muted-foreground">{t("meetings.project")}</span>
            <span className={cn("truncate", !project && "text-muted-foreground")}>{projectLabel}</span>
            <ChevronDown aria-hidden className="size-3! text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 min-w-56">
            <DropdownMenuRadioGroup value={project ? project.id : NO_PROJECT} onValueChange={(v: string) => onProject(v === NO_PROJECT ? "" : v)}>
              <DropdownMenuRadioItem value={NO_PROJECT} className={MENU_ITEM_LEFT_CHECK}>
                {t("meetings.projectNone")}
              </DropdownMenuRadioItem>
              {projects.map((p) => (
                <DropdownMenuRadioItem key={p.id} value={p.id} className={MENU_ITEM_LEFT_CHECK}>
                  {p.title}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {showJoin ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={readOnly}
            className={PROPERTY_CHIP}
            aria-label={t("meetings.sheet.chipAria", { key: t("meetings.sheet.joinKey"), value: joinLabel })}
          >
            <DoorOpen aria-hidden />
            <span className="text-muted-foreground">{t("meetings.sheet.joinKey")}</span>
            <span className="truncate">{joinLabel}</span>
            <ChevronDown aria-hidden className="size-3! text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-90 max-w-[calc(100vw-2rem)]">
            <DropdownMenuRadioGroup value={allowJoin ? "yes" : "no"} onValueChange={(v: string) => onAllowJoin(v === "yes")}>
              {(["no", "yes"] as const).map((v) => (
                <DropdownMenuRadioItem key={v} value={v} className={cn(MENU_ITEM_LEFT_CHECK, "h-auto items-start py-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:top-2.5")}>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-body">{t(v === "yes" ? "meetings.sheet.joinRequest" : "meetings.sheet.joinInvited")}</span>
                    <span className="text-caption text-muted-foreground">
                      {t(v === "yes" ? "meetings.sheet.joinRequestHint" : "meetings.sheet.joinInvitedHint")}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <p className="mt-1 border-t border-border px-2 pt-2 pb-1 text-caption text-muted-foreground">{t("meetings.sheet.joinGuestsNote")}</p>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
