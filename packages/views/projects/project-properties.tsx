"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronRight, UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePutProject } from "@uniwork/core/tasks";
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
} from "@uniwork/core/types/project";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import { DateField } from "../common/date-field";
import {
  ProjectPriorityBadge,
  ProjectStatusBadge,
} from "./components/project-badge";
import { resolveProjectLeadName } from "./project-row-metrics";

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-2 flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-accent/50">
      <span className="w-20 shrink-0 text-caption text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-caption">
        {children}
      </div>
    </div>
  );
}

/**
 * Status / priority / lead / date pickers for project detail (UniWork UI only).
 */
export function ProjectProperties({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: Project;
}) {
  const { t } = useTranslation();
  const putProject = usePutProject(workspaceId);
  const { data: members } = useMembers(workspaceId);
  const [open, setOpen] = useState(true);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadFilter, setLeadFilter] = useState("");

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) {
      map.set(m.user_id, m.display_name || m.email);
    }
    return map;
  }, [members]);

  const leadName = resolveProjectLeadName(project, memberNames);

  const save = useCallback(
    (patch: {
      status?: ProjectStatus;
      priority?: ProjectPriority;
      lead_type?: string | null;
      lead_id?: string | null;
      start_date?: string | null;
      due_date?: string | null;
    }) => {
      putProject.mutate({
        projectId: project.id,
        body: { ...patch, revision: project.revision },
        ifMatch: String(project.revision),
      });
    },
    [project.id, project.revision, putProject],
  );

  const filteredMembers = (members ?? []).filter((m) => {
    const q = leadFilter.trim().toLowerCase();
    if (!q) return true;
    const name = (m.display_name || m.email).toLowerCase();
    return name.includes(q) || m.email.toLowerCase().includes(q);
  });

  return (
    <div>
      <button
        type="button"
        className={`mb-2 flex w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors hover:bg-accent/70 ${
          open ? "" : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {t("projects.detail.section_properties")}
        <ChevronRight
          aria-hidden
          className={`size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      {open ? (
        <div className="space-y-0.5 pl-2">
          <PropRow label={t("projects.table.status")}>
            <ProjectStatusBadge
              project={project}
              onUpdate={(p) => save(p)}
              align="start"
            />
          </PropRow>
          <PropRow label={t("projects.table.priority")}>
            <ProjectPriorityBadge
              project={project}
              onUpdate={(p) => save(p)}
              align="start"
            />
          </PropRow>
          <PropRow label={t("projects.table.lead")}>
            <Popover
              open={leadOpen}
              onOpenChange={(v) => {
                setLeadOpen(v);
                if (!v) setLeadFilter("");
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1.5 py-0.5 text-caption font-normal"
                  />
                }
              >
                {leadName ? (
                  <span>{leadName}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("projects.lead.no_lead")}
                  </span>
                )}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-52 p-0">
                <div className="border-b px-2 py-1.5">
                  <input
                    type="text"
                    value={leadFilter}
                    onChange={(e) => setLeadFilter(e.target.value)}
                    placeholder={t("projects.lead.assign_placeholder")}
                    className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
                    aria-label={t("projects.lead.assign_placeholder")}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                  <button
                    type="button"
                    onClick={() => {
                      save({ lead_type: null, lead_id: null });
                      setLeadOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-accent"
                  >
                    <UserMinus
                      className="size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="text-muted-foreground">
                      {t("projects.lead.no_lead")}
                    </span>
                  </button>
                  {filteredMembers.map((m) => (
                    <button
                      type="button"
                      key={m.user_id}
                      onClick={() => {
                        save({ lead_type: "member", lead_id: m.user_id });
                        setLeadOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-accent"
                    >
                      <span>{m.display_name || m.email}</span>
                    </button>
                  ))}
                  {filteredMembers.length === 0 && leadFilter ? (
                    <div className="px-2 py-3 text-center text-body text-muted-foreground">
                      {t("projects.lead.no_results")}
                    </div>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          </PropRow>
          <PropRow label={t("projects.detail.prop_start_date")}>
            <DateField
              value={project.start_date ?? ""}
              onChange={(value) =>
                save({ start_date: value === "" ? null : value })
              }
            />
          </PropRow>
          <PropRow label={t("projects.detail.prop_due_date")}>
            <DateField
              value={project.due_date ?? ""}
              onChange={(value) =>
                save({ due_date: value === "" ? null : value })
              }
            />
          </PropRow>
        </div>
      ) : null}
    </div>
  );
}
