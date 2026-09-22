"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";

export function MemberMultiPicker({
  workspaceId,
  value,
  onChange,
  excludeUserIds = [],
  searchable = false,
  autoFocusSearch = true,
  className,
}: {
  workspaceId: string;
  value: string[];
  onChange: (next: string[]) => void;
  excludeUserIds?: string[];
  searchable?: boolean;
  /** Off inside a form whose first field already takes focus. */
  autoFocusSearch?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data: members, isPending, isError, refetch } = useMembers(workspaceId);
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
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("meetings.searchMembers")}
            aria-label={t("meetings.searchMembersLabel")}
            autoFocus={autoFocusSearch}
          />
        </div>
      ) : null}
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <p className="text-overline text-muted-foreground">{t("meetings.memberListLabel")}</p>
        {/* Always mounted so the first pick is announced; a search can hide picked rows, the count keeps them in view. */}
        <p aria-live="polite" className="text-caption font-medium text-foreground tabular-nums">
          {value.length > 0 ? t("meetings.attendeesSelected", { count: value.length }) : null}
        </p>
      </div>
      <ul className="min-h-0 max-h-56 min-w-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface">
        {isPending ? (
          <li>
            <MeetingRowsSkeleton rowClassName="min-h-11 px-3 py-2" />
          </li>
        ) : isError ? (
          <li className="p-2">
            <MeetingSectionError message={t("meetings.membersLoadFailed")} onRetry={() => void refetch()} />
          </li>
        ) : filtered.length === 0 ? (
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
