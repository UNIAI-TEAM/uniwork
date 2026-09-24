"use client";

import { useState } from "react";
import { UserMinus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import type { ActorFilterValue } from "@uniwork/core/tasks/stores/view-store-types";
import { useMembers } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { useWorkspaceId } from "../../layout/workspace-context";
import { actorChecked } from "./filter-counts";
import { FILTER_ITEM_CLASS, HoverCheck } from "./hover-check";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Shared assignee/creator filter body: search + members + agents + squad stub.
 * Squads stay visible when the capability is missing (disabled + reason);
 * the squad list API is never called while unavailable.
 */
export function FilterAssigneeOptions({
  counts,
  selected,
  onToggle,
  showNoAssignee = false,
  includeNoAssignee = false,
  onToggleNoAssignee,
  noAssigneeCount = 0,
  showSquads = true,
  fixedKeys,
  noAssigneeFixed = false,
  fixedTitle,
}: {
  counts: Map<string, number>;
  selected: ActorFilterValue[];
  onToggle: (value: ActorFilterValue) => void;
  showNoAssignee?: boolean;
  includeNoAssignee?: boolean;
  onToggleNoAssignee?: () => void;
  noAssigneeCount?: number;
  showSquads?: boolean;
  fixedKeys?: Set<string>;
  noAssigneeFixed?: boolean;
  fixedTitle?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const wsId = useWorkspaceId();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const squadsCap = capabilityState(config, "tasks.squads");
  const squadsAvailable = squadsCap.status === "available";

  const { data: members = [] } = useMembers(wsId);
  const { data: agents = [] } = useWorkspaceAgents(wsId);

  const query = search.trim().toLowerCase();
  const filteredMembers = members.filter((m) => {
    const name = (m.display_name || m.email || "").toLowerCase();
    return !query || name.includes(query);
  });
  const filteredAgents = agents.filter((a) => {
    const name = (a.name || "").toLowerCase();
    return !query || name.includes(query);
  });

  const unassignedLabel = t("tasks.unassigned").toLowerCase();
  const showUnassignedRow =
    showNoAssignee &&
    (!query ||
      unassignedLabel.includes(query) ||
      "unassigned".includes(query) ||
      "no assignee".includes(query));

  return (
    <>
      <div className="border-b border-foreground/5 px-2 py-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("tasks.filters.search_placeholder")}
          aria-label={t("tasks.filters.search_placeholder")}
          className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
          autoFocus
        />
      </div>

      <div className="max-h-64 overflow-y-auto p-1">
        {showUnassignedRow ? (
          <DropdownMenuCheckboxItem
            checked={includeNoAssignee}
            disabled={noAssigneeFixed}
            title={noAssigneeFixed ? fixedTitle : undefined}
            onCheckedChange={() => onToggleNoAssignee?.()}
            className={FILTER_ITEM_CLASS}
          >
            <HoverCheck checked={includeNoAssignee} />
            <UserMinus className="size-3.5 text-muted-foreground" aria-hidden />
            {t("tasks.unassigned")}
            {noAssigneeCount > 0 ? (
              <span className="ml-auto text-caption text-muted-foreground">
                {noAssigneeCount}
              </span>
            ) : null}
          </DropdownMenuCheckboxItem>
        ) : null}

        {filteredMembers.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t("tasks.save_view.members")}
            </DropdownMenuLabel>
            {filteredMembers.map((m) => {
              const value = { type: "member", id: m.user_id } as const;
              const checked = actorChecked(selected, value);
              const fixed = fixedKeys?.has(`member:${m.user_id}`) === true;
              const count = counts.get(`member:${m.user_id}`) ?? 0;
              const name = m.display_name || m.email || m.user_id;
              return (
                <DropdownMenuCheckboxItem
                  key={m.user_id}
                  checked={checked}
                  disabled={fixed}
                  title={fixed ? fixedTitle : undefined}
                  onCheckedChange={() => onToggle(value)}
                  className={FILTER_ITEM_CLASS}
                >
                  <HoverCheck checked={checked} />
                  <ActorAvatar
                    name={name}
                    initials={initials(name)}
                    avatarUrl={
                      typeof m.avatar_url === "string" ? m.avatar_url : undefined
                    }
                    size="xs"
                  />
                  <span className="truncate">{name}</span>
                  {count > 0 ? (
                    <span className="ml-auto text-caption text-muted-foreground">
                      {count}
                    </span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        ) : null}

        {filteredAgents.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("tasks.save_view.agents")}</DropdownMenuLabel>
            {filteredAgents.map((a) => {
              const value = { type: "agent", id: a.id } as const;
              const checked = actorChecked(selected, value);
              const fixed = fixedKeys?.has(`agent:${a.id}`) === true;
              const count = counts.get(`agent:${a.id}`) ?? 0;
              return (
                <DropdownMenuCheckboxItem
                  key={a.id}
                  checked={checked}
                  disabled={fixed}
                  title={fixed ? fixedTitle : undefined}
                  onCheckedChange={() => onToggle(value)}
                  className={FILTER_ITEM_CLASS}
                >
                  <HoverCheck checked={checked} />
                  <ActorAvatar
                    name={a.name}
                    initials={initials(a.name)}
                    avatarUrl={a.avatar_url}
                    isAgent
                    size="xs"
                  />
                  <span className="truncate">{a.name}</span>
                  {count > 0 ? (
                    <span className="ml-auto text-caption text-muted-foreground">
                      {count}
                    </span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        ) : null}

        {showSquads ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("tasks.filters.squads_group")}</DropdownMenuLabel>
            {!squadsAvailable ? (
              <DropdownMenuItem
                disabled
                data-testid="task-filter-squads-unavailable"
                data-reason-code={squadsCap.reason_code}
                title={t(squadsCap.explanation_key || "capabilities.unknown")}
              >
                <Users className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="truncate">
                  {t(squadsCap.explanation_key || "capabilities.unknown")}
                </span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled data-testid="task-filter-squads-empty">
                {t("tasks.save_view.no_options")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        ) : null}

        {filteredMembers.length === 0 &&
        filteredAgents.length === 0 &&
        search ? (
          <div className="px-2 py-3 text-center text-body text-muted-foreground">
            {t("tasks.filters.no_results")}
          </div>
        ) : null}
      </div>
    </>
  );
}
