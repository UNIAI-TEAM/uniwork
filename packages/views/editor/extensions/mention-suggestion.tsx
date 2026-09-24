"use client";

/**
 * @-mention suggestion for UniWork: workspace members + agents (+ @all).
 * Task/project search from uniwork is deferred — inject via getContextItems.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { QueryClient } from "@tanstack/react-query";
import { getCurrentWsId } from "@uniwork/core/platform";
import { workspaceKeys } from "@uniwork/core/workspaces";
import { agentKeys } from "@uniwork/core/agents";
import { useAuthStore } from "@uniwork/core/auth";
import { isImeComposing } from "@uniwork/core/utils";
import type { Agent, Member } from "@uniwork/core/types";
import { Users } from "lucide-react";
import { useTranslation, getI18n } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import {
  getRecencyMap,
  recordMentionUsage,
  sortUserItemsByRecency,
} from "./mention-recency";
import { matchesPinyin } from "./pinyin-match";
import { createSuggestionPopupRender } from "./suggestion-popup";
import { isPickerAcceptKey, pickerNavigationDirection } from "../picker-keys";
import { isTriggerArmedAt } from "./suggestion-trigger-arming";
import { ActorAvatar } from "../actor-avatar";

export interface MentionItem {
  id: string;
  label: string;
  type: "member" | "agent" | "squad" | "task" | "project" | "all";
  group?: "current" | "recent" | "search";
  description?: string;
  disabledReason?: "agent_runtime_required";
}

interface MentionListProps {
  items: MentionItem[];
  query: string;
  command: (item: MentionItem) => void;
}

interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

type MentionGroup = { key: string; label: string; items: MentionItem[] };

function mentionItemKey(item: MentionItem): string {
  return `${item.type}:${item.id}`;
}

function groupItems(items: MentionItem[], t: (k: string) => string): MentionGroup[] {
  const users: MentionItem[] = [];
  const context: MentionItem[] = [];
  for (const item of items) {
    if (item.type === "member" || item.type === "agent" || item.type === "all" || item.type === "squad") {
      users.push(item);
    } else {
      context.push(item);
    }
  }
  const groups: MentionGroup[] = [];
  if (users.length) groups.push({ key: "users", label: t("editor.mention.group_users"), items: users });
  if (context.length) groups.push({ key: "tasks", label: t("editor.mention.group_tasks"), items: context });
  return groups;
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  function MentionList({ items, query, command }, ref) {
    const { t } = useTranslation();
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const orderedItems = useMemo(() => items, [items]);
    const groups = useMemo(() => groupItems(orderedItems, t), [orderedItems, t]);

    const selectedIndex = useMemo(() => {
      if (!selectedKey) return 0;
      const idx = orderedItems.findIndex((i) => mentionItemKey(i) === selectedKey);
      return idx >= 0 ? idx : 0;
    }, [orderedItems, selectedKey]);

    useEffect(() => {
      setSelectedKey(orderedItems[0] ? mentionItemKey(orderedItems[0]) : null);
    }, [query, orderedItems]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (isImeComposing(event)) return false;
        const dir = pickerNavigationDirection(event);
        if (dir) {
          event.preventDefault();
          const next =
            dir === "next"
              ? Math.min(selectedIndex + 1, orderedItems.length - 1)
              : Math.max(selectedIndex - 1, 0);
          const item = orderedItems[next];
          if (item) setSelectedKey(mentionItemKey(item));
          itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return true;
        }
        if (isPickerAcceptKey(event)) {
          const item = orderedItems[selectedIndex];
          if (item && !item.disabledReason) {
            event.preventDefault();
            const wsId = getCurrentWsId() ?? "";
            recordMentionUsage(wsId, item);
            command(item);
            return true;
          }
        }
        return false;
      },
    }));

    if (orderedItems.length === 0) {
      return (
        <div className="rounded-md border bg-popover p-2 text-caption text-muted-foreground shadow-md">
          {t("editor.mention.no_results")}
        </div>
      );
    }

    let flatIndex = 0;
    return (
      <div className="max-h-[min(20rem,var(--suggestion-available-height,20rem))] overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
        {groups.map((group) => (
          <div key={group.key} className="mb-1">
            <div className="px-2 py-1 text-micro font-medium text-muted-foreground">{group.label}</div>
            {group.items.map((item) => {
              const index = flatIndex++;
              const selected = index === selectedIndex;
              return (
                <MentionRow
                  key={mentionItemKey(item)}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  item={item}
                  selected={selected}
                  onSelect={() => {
                    if (item.disabledReason) return;
                    recordMentionUsage(getCurrentWsId() ?? "", item);
                    command(item);
                  }}
                  onHover={() => setSelectedKey(mentionItemKey(item))}
                />
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);

const MentionRow = forwardRef<
  HTMLButtonElement,
  {
    item: MentionItem;
    selected: boolean;
    onSelect: () => void;
    onHover: () => void;
  }
>(function MentionRow({ item, selected, onSelect, onHover }, ref) {
  let leading: ReactNode;
  if (item.type === "all") {
    leading = <Users className="size-4 text-muted-foreground" />;
  } else {
    leading = (
      <ActorAvatar
        actorType={item.type === "agent" ? "agent" : "member"}
        actorId={item.id}
        name={item.label}
        size="xs"
      />
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      disabled={Boolean(item.disabledReason)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body",
        selected && "bg-muted",
        item.disabledReason && "opacity-50",
      )}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
    >
      {leading}
      <span className="truncate">{item.label}</span>
      {item.description ? (
        <span className="truncate text-caption text-muted-foreground">{item.description}</span>
      ) : null}
    </button>
  );
});

function matchesMentionQuery(item: MentionItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.label.toLowerCase().includes(q) ||
    item.description?.toLowerCase().includes(q) === true ||
    matchesPinyin(item.label, q) ||
    (item.description ? matchesPinyin(item.description, q) : false)
  );
}

interface MentionSuggestionOptions {
  mode?: "default" | "context";
  getContextItems?: () => MentionItem[];
}

export function createMentionSuggestion(
  qc: QueryClient,
  options: MentionSuggestionOptions = {},
): Omit<SuggestionOptions<MentionItem>, "editor"> {
  const pluginKey = new PluginKey("mentionSuggestion");

  function buildSyncItems(query: string): MentionItem[] {
    const wsId = getCurrentWsId();
    if (!wsId) return [];

    const members: Member[] = qc.getQueryData(workspaceKeys.members(wsId)) ?? [];
    const agents: Agent[] = qc.getQueryData(agentKeys.workspace(wsId)) ?? [];
    const userId = useAuthStore.getState().user?.id ?? null;
    void userId;

    const q = query.toLowerCase();
    const allLabel = getI18n().t("editor.mention.all_members");
    const allItem: MentionItem[] =
      !q ||
      allLabel.toLowerCase().includes(q) ||
      "all".includes(q) ||
      "tất cả".includes(q)
        ? [{ id: "all", label: allLabel, type: "all" }]
        : [];

    const memberItems: MentionItem[] = members
      .filter(
        (m) =>
          m.display_name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          matchesPinyin(m.display_name, q),
      )
      .map((m) => ({
        id: m.user_id,
        label: m.display_name,
        type: "member" as const,
      }));

    const agentItems: MentionItem[] = agents
      .filter(
        (a) =>
          a.status !== "archived" &&
          (a.name.toLowerCase().includes(q) ||
            a.handle.toLowerCase().includes(q) ||
            matchesPinyin(a.name, q)),
      )
      .map((a) => ({
        id: a.id,
        label: a.name,
        type: "agent" as const,
      }));

    const users = sortUserItemsByRecency(
      [...allItem, ...memberItems, ...agentItems],
      getRecencyMap(wsId),
    );

    const contextItems = (options.getContextItems?.() ?? []).filter((item) =>
      matchesMentionQuery(item, query),
    );

    return [...users, ...contextItems];
  }

  return {
    char: "@",
    pluginKey,
    allow: ({ editor, range }) => isTriggerArmedAt(editor, range.from),
    items: ({ query }) => {
      const contextItems = options.getContextItems?.() ?? [];
      if (options.mode === "context") {
        return contextItems.filter((item) => matchesMentionQuery(item, query));
      }
      return buildSyncItems(query);
    },
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: "mention",
            attrs: {
              id: props.id,
              label: props.label,
              mentionType: props.type === "task" ? "task" : props.type,
            },
          },
          { type: "text", text: " " },
        ])
        .run();
    },
    render: createSuggestionPopupRender<MentionItem, MentionItem, MentionListRef, MentionListProps>({
      pluginKey,
      component: MentionList,
      getProps: (props) => ({
        items: props.items,
        query: props.query,
        command: props.command,
      }),
      onKeyDown: (ref, props) => ref?.onKeyDown(props) ?? false,
    }),
  };
}
