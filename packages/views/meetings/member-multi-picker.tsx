"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "./meeting-person";

export function MemberMultiPicker({
  workspaceId,
  value,
  onChange,
  excludeUserIds = [],
  searchable = false,
  className,
}: {
  workspaceId: string;
  value: string[];
  onChange: (next: string[]) => void;
  excludeUserIds?: string[];
  searchable?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const [search, setSearch] = useState("");
  const options = (members ?? []).filter((m) => !excludeUserIds.includes(m.user_id));
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? options.filter(
        (m) =>
          m.display_name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle),
      )
    : options;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {searchable ? (
        <div className="shrink-0 p-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("meetings.searchMembers")}
            aria-label={t("meetings.searchMembers")}
            autoFocus
          />
        </div>
      ) : null}
      <p className="shrink-0 text-overline text-muted-foreground">
        {t("meetings.memberListLabel")}
      </p>
      <ul className="min-h-0 max-h-56 min-w-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface">
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-center text-label text-muted-foreground">
            {needle ? t("meetings.noPeopleMatch") : t("meetings.noOtherMembers")}
          </li>
        ) : (
          filtered.map((m) => {
            const checked = value.includes(m.user_id);
            return (
              <li key={m.user_id}>
                <label
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-standard",
                    // Selected wins over hover so a checked row keeps its state while pointed at.
                    checked ? "bg-surface-selected" : "hover:bg-surface-hover",
                  )}
                >
                  <MeetingPersonAvatar name={m.display_name || m.email} avatarUrl={m.avatar_url} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-foreground">
                      {m.display_name || m.email}
                    </span>
                    {m.display_name ? (
                      <span className="block truncate text-caption text-muted-foreground">
                        {m.email}
                      </span>
                    ) : null}
                  </span>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      onChange(next ? [...value, m.user_id] : value.filter((id) => id !== m.user_id));
                    }}
                  />
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
