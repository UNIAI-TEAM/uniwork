"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import type { TaskProperty } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import {
  DropdownMenuCheckboxItem,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { useWorkspaceId } from "../../layout/workspace-context";
import { propertyOptions } from "../properties/property-value";
import { NO_PROPERTY_VALUE } from "../utils/filter";
import { FILTER_ITEM_CLASS, HoverCheck } from "./hover-check";

function isActorPropertyType(type: string): boolean {
  return type === "actor" || type === "multi_actor";
}

function formatActorRef(kind: "member", id: string): string {
  return `${kind}:${id}`;
}

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function isFilterableProperty(property: TaskProperty): boolean {
  return (
    property.type === "select" ||
    property.type === "multi_select" ||
    property.type === "checkbox" ||
    isActorPropertyType(property.type)
  );
}

export function FilterPropertyOptions({
  property,
  counts,
  selected,
  onToggle,
  fixedIds,
  fixedTitle,
}: {
  property: TaskProperty;
  counts: Map<string, number> | undefined;
  selected: string[];
  onToggle: (optionId: string) => void;
  fixedIds?: Set<string>;
  fixedTitle?: string;
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceId();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const actorProperty = isActorPropertyType(property.type);
  const { data: members = [] } = useMembers(wsId);

  const actorOptions = useMemo(() => {
    if (!actorProperty) return [];
    return members
      .slice()
      .sort((a, b) => {
        if (a.user_id === currentUserId) return -1;
        if (b.user_id === currentUserId) return 1;
        return 0;
      })
      .map((m) => ({
        id: formatActorRef("member", m.user_id),
        name: m.display_name || m.email || m.user_id,
        actorId: m.user_id,
        avatarUrl:
          typeof m.avatar_url === "string" ? m.avatar_url : undefined,
      }));
  }, [actorProperty, members, currentUserId]);

  const options = useMemo(() => {
    const noValue = {
      id: NO_PROPERTY_VALUE,
      name: t("tasks.table.no_value"),
      color: undefined as string | undefined,
      actorId: undefined as string | undefined,
      avatarUrl: undefined as string | undefined,
    };

    if (actorProperty) {
      return [
        ...actorOptions.map((o) => ({
          id: o.id,
          name: o.name,
          color: undefined as string | undefined,
          actorId: o.actorId as string | undefined,
          avatarUrl: o.avatarUrl,
        })),
        noValue,
      ];
    }

    if (property.type === "checkbox") {
      return [
        {
          id: "true",
          name: t("tasks.table.checked"),
          color: undefined,
          actorId: undefined,
          avatarUrl: undefined,
        },
        {
          id: "false",
          name: t("tasks.table.unchecked"),
          color: undefined,
          actorId: undefined,
          avatarUrl: undefined,
        },
        noValue,
      ];
    }

    return [
      ...propertyOptions(property).map((o) => ({
        id: o.id,
        name: o.name,
        color: o.color,
        actorId: undefined as string | undefined,
        avatarUrl: undefined as string | undefined,
      })),
      noValue,
    ];
  }, [actorProperty, actorOptions, property, t]);

  return (
    <>
      {options.map((option) => {
        const checked = selected.includes(option.id);
        const fixed = fixedIds?.has(option.id) === true;
        const count = counts?.get(option.id) ?? 0;
        return (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={checked}
            disabled={fixed}
            title={fixed ? fixedTitle : undefined}
            onCheckedChange={() => onToggle(option.id)}
            className={FILTER_ITEM_CLASS}
          >
            <HoverCheck checked={checked} />
            {option.actorId ? (
              <ActorAvatar
                name={option.name}
                initials={initials(option.name)}
                avatarUrl={option.avatarUrl}
                size="xs"
              />
            ) : null}
            {option.color ? (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: option.color }}
                aria-hidden
              />
            ) : null}
            <span className="truncate">{option.name}</span>
            {count > 0 ? (
              <span className="ml-auto text-caption text-muted-foreground">
                {count}
              </span>
            ) : null}
          </DropdownMenuCheckboxItem>
        );
      })}
    </>
  );
}
