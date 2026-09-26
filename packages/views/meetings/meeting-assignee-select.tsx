"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";

const UNASSIGNED = "__unassigned__";

export function MeetingAssigneeSelect({
  workspaceId,
  value,
  suggestedOwner,
  onChange,
  className,
  unassignedLabel,
}: {
  workspaceId: string;
  value?: string;
  suggestedOwner?: string;
  onChange: (userId: string | undefined) => void;
  className?: string;
  /** Overrides "Unassigned (AI suggestion)" where the suggestion is already shown beside the field. */
  unassignedLabel?: string;
}) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const items = useMemo(
    () => [
      { value: UNASSIGNED, label: unassignedLabel ?? t("meetings.assignTaskUnassigned") },
      ...(members ?? []).map((m) => ({ value: m.user_id, label: m.display_name })),
    ],
    [members, t, unassignedLabel],
  );
  const selectValue = value ?? UNASSIGNED;
  const active = items.find((item) => item.value === selectValue);

  return (
    <Select
      items={items}
      value={selectValue}
      onValueChange={(next) => {
        if (!next || next === UNASSIGNED) onChange(undefined);
        else onChange(next);
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label={t("meetings.assignTaskTo")}>
        <SelectValue placeholder={suggestedOwner || t("meetings.assignTaskTo")}>
          {active?.label ?? suggestedOwner}
        </SelectValue>
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
