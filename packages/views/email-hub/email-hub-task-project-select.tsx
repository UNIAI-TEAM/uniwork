"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProjects } from "@uniwork/core/tasks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";

const NO_PROJECT = "__no_project__";

export function EmailHubTaskProjectSelect({
  workspaceId,
  value,
  onChange,
  className,
}: {
  workspaceId: string;
  value?: string;
  onChange: (projectId: string | undefined) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data } = useProjects(workspaceId);
  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const items = useMemo(
    () => [
      { value: NO_PROJECT, label: t("email_hub.ai.project_none") },
      ...projects.map((p) => ({ value: p.id, label: p.title })),
    ],
    [projects, t],
  );
  const selectValue = value?.trim() ? value : NO_PROJECT;
  const active = items.find((item) => item.value === selectValue);

  return (
    <Select
      items={items}
      value={selectValue}
      onValueChange={(next) => {
        if (!next || next === NO_PROJECT) onChange(undefined);
        else onChange(next);
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label={t("email_hub.ai.project_label")}>
        <SelectValue placeholder={t("email_hub.ai.project_none")}>{active?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
