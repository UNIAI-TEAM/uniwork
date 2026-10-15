"use client";

import { useState } from "react";
import { ChevronDown, FunnelX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import type { AccessReportFilters } from "@uniwork/core/types/document-access-report";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { WorkspaceMemberPickerList, WorkspaceMemberSearchField } from "../../chat/workspace-member-picker";
import { filterWorkspaceMembers } from "../../chat/workspace-member-picker-utils";
import { accessLevelLabel, accessVisibilityLabel, REPORT_LEVELS } from "./access-report-labels";

const ALL = "all";
const VISIBILITIES = ["workspace", "restricted"] as const;

export interface AccessReportFiltersBarProps {
  wsId: string;
  filters: AccessReportFilters;
  /** Name of the person in the filter, when the screen knows it. */
  personName: string | null;
  onChange: (next: AccessReportFilters) => void;
  onReset: () => void;
}

/**
 * The three report filters — person, level, visibility — and a reset. The
 * person picker is the workspace member picker the chat dialogs use; a person
 * outside the workspace is picked by clicking their name in the table.
 */
export function AccessReportFiltersBar({ wsId, filters, personName, onChange, onReset }: AccessReportFiltersBarProps) {
  const { t } = useTranslation();
  const levels = filters.levels ?? [];
  const active = Boolean(filters.personId) || levels.length > 0 || Boolean(filters.visibility);

  const toggleLevel = (level: string, on: boolean) => {
    const next = on ? [...levels, level] : levels.filter((l) => l !== level);
    onChange({ ...filters, levels: REPORT_LEVELS.filter((l) => next.includes(l)) });
  };

  const visibilityItems = [
    { value: ALL, label: t("documents.accessReport.filter_all") },
    ...VISIBILITIES.map((value) => ({ value, label: accessVisibilityLabel(t, value) })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <PersonFilter
        wsId={wsId}
        personId={filters.personId}
        personName={personName}
        onPick={(personId) => onChange({ ...filters, personId })}
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="toolbar" size="sm" className="gap-1" />}
        >
          {levels.length > 0
            ? `${t("documents.accessReport.filter_level")}: ${levels.map((l) => accessLevelLabel(t, l)).join(", ")}`
            : t("documents.accessReport.filter_level")}
          <ChevronDown aria-hidden className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          {REPORT_LEVELS.map((level) => (
            <DropdownMenuCheckboxItem
              key={level}
              checked={levels.includes(level)}
              onCheckedChange={(on) => toggleLevel(level, on)}
              className="px-2 py-2 pointer-coarse:min-h-11"
            >
              {accessLevelLabel(t, level)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Select
        items={visibilityItems}
        value={filters.visibility || ALL}
        onValueChange={(next) => onChange({ ...filters, visibility: next === ALL ? undefined : String(next) })}
      >
        <SelectTrigger aria-label={t("documents.accessReport.filter_visibility")} className="w-auto min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {visibilityItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {active ? (
        <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-1">
          <FunnelX aria-hidden className="size-3.5" />
          {t("documents.accessReport.filter_reset")}
        </Button>
      ) : null}
    </div>
  );
}

function PersonFilter({
  wsId,
  personId,
  personName,
  onPick,
}: {
  wsId: string;
  personId: string | undefined;
  personName: string | null;
  onPick: (personId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: members = [], isLoading } = useMembers(open ? wsId : "");
  const shown = filterWorkspaceMembers(members, { currentUserId: "", query });
  const label = t("documents.accessReport.filter_person");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="toolbar" size="sm" className="gap-1" />}>
        {personId && personName ? `${label}: ${personName}` : label}
        <ChevronDown aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <WorkspaceMemberSearchField
          id="access-report-person-search"
          label={label}
          query={query}
          onQueryChange={setQuery}
          onSubmit={() => {}}
          placeholder={t("chat.workspace_members_search")}
        />
        <div className="max-h-64 overflow-y-auto">
          <WorkspaceMemberPickerList
            members={shown}
            loading={isLoading}
            query={query}
            actionIcon={<span aria-hidden className="size-4" />}
            onPick={(contact) => {
              onPick(contact.user_id);
              setOpen(false);
              setQuery("");
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
