"use client";

import { forwardRef, useEffect, useId, useRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import type { TaskStatus } from "@uniwork/core/types";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { PersonAvatar } from "../people/person-avatar";
import { StatusIcon } from "../tasks/icons/status-icon";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { entityKindIcon } from "./ask-uni-entity";
import {
  useDocumentMatches,
  useMeetingMatches,
  useMemberMatches,
  useProjectMatches,
  useRoomMatches,
  useTaskMatches,
  type LookupItem,
} from "./ask-uni-lookup";
import { matchRange } from "./ask-uni-text";

export type AskUniObjectKind = "task" | "document" | "meeting" | "project" | "member" | "room";

export interface AskUniObjectItem {
  kind: AskUniObjectKind;
  id: string;
  title: string;
  status?: string;
  assignee?: { name: string; avatarUrl?: string };
}

export interface AskUniObjectPickerHandle {
  /** True when the key was the picker's; the host then prevents the default. */
  onKeyDown(e: KeyboardEvent): boolean;
  /** No row is shown (in the current tab). */
  isEmpty(): boolean;
  /** A search is still on its way, so an empty list may yet fill. */
  isLoading(): boolean;
}

interface Props {
  wsId: string;
  query: string;
  kinds: AskUniObjectKind[];
  onPick(item: AskUniObjectItem): void;
  onDismiss(): void;
  /** The listbox id, so a host input can name it in aria-controls. */
  listboxId?: string;
  /** The active option's id (undefined when there are no rows), for the host's aria-activedescendant. */
  onActiveChange?(id: string | undefined): void;
  /** A search for this query settled with no row in the current tab. */
  onSettledEmpty?(): void;
}

type Tab = "all" | AskUniObjectKind;

function Title({ title, query }: { title: string; query: string }) {
  const r = matchRange(title, query);
  if (!r) return <span className="truncate">{title}</span>;
  return (
    <span className="truncate">
      {title.slice(0, r[0])}
      <u className="underline underline-offset-2">{title.slice(r[0], r[1])}</u>
      {title.slice(r[1])}
    </span>
  );
}

function Row({ item, query, id, active, onPick, onHover }: {
  item: AskUniObjectItem;
  query: string;
  id: string;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const { t } = useTranslation();
  const Icon = entityKindIcon(item.kind === "room" ? "chat" : item.kind);
  return (
    // Keys belong to the host (aria-activedescendant); the option itself only takes the pointer.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      // The caret stays where it is while the pointer picks.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn("flex cursor-default items-center gap-2 rounded-md px-2 py-1.5", active && "bg-accent text-accent-foreground")}
    >
      {item.kind === "member" ? (
        <PersonAvatar id={item.id} name={item.title} size="xs" />
      ) : (
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <Title title={item.title} query={query} />
      {item.kind === "task" && item.status ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
          <StatusIcon status={item.status} className={cn("size-3 shrink-0", STATUS_CONFIG[item.status as TaskStatus]?.iconColor)} />
          {t(`tasks.status_${item.status}`, { defaultValue: item.status })}
          {item.assignee ? (
            <>
              <PersonAvatar id={item.assignee.name} name={item.assignee.name} size="xs" avatarUrl={item.assignee.avatarUrl} />
              <span className="max-w-24 truncate">{item.assignee.name}</span>
            </>
          ) : null}
        </span>
      ) : null}
      {active ? (
        <span aria-hidden className={cn("shrink-0 text-caption text-muted-foreground", !(item.kind === "task" && item.status) && "ml-auto")}>
          {"⏎ "}
          {t("ai.picker.enter_hint")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One list of workspace objects for "+" and `@`: tabs by kind, rows with icon, underlined match and
 * (tasks) status and assignee. It never takes focus; the host feeds it keys through the handle.
 */
export const AskUniObjectPicker = forwardRef<AskUniObjectPickerHandle, Props>(function AskUniObjectPicker(
  { wsId, query, kinds: allKinds, onPick, onDismiss, listboxId, onActiveChange, onSettledEmpty },
  ref,
) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.picker" });
  const uid = useId();
  const documentsOn = useFlag("documents", false);
  // Documents hide behind their flag; no flag, no tab and no rows.
  const kinds = allKinds.filter((k) => k !== "document" || documentsOn);
  const on = (k: AskUniObjectKind) => kinds.includes(k);
  const members = useMemberMatches(wsId, query);
  const tasks = useTaskMatches(wsId, query, on("task"));
  const documents = useDocumentMatches(wsId, query, on("document"));
  const meetings = useMeetingMatches(wsId, query, on("meeting"));
  const projects = useProjectMatches(wsId, query, on("project"));
  const rooms = useRoomMatches(wsId, query, on("room"));
  const loading = tasks.loading || documents.loading || meetings.loading || projects.loading;
  const byKind: Record<AskUniObjectKind, LookupItem[]> = {
    member: on("member") ? members : [],
    task: tasks.items,
    document: documents.items,
    meeting: meetings.items,
    project: projects.items,
    room: rooms,
  };
  const [tab, setTab] = useState<Tab>("all");
  const [active, setActive] = useState(0);
  const tabs: Tab[] = ["all", ...kinds];
  const shown = (tab === "all" ? kinds : kinds.filter((k) => k === tab)).flatMap((k) => byKind[k].map((i): AskUniObjectItem => ({ ...i, kind: k })));
  const current = Math.min(active, Math.max(shown.length - 1, 0));
  const optionId = (i: number) => `${uid}-${i}`;
  const activeId = shown.length > 0 ? optionId(current) : undefined;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onActiveChange?.(activeId);
    // jsdom has no scrollIntoView.
    if (activeId) list.current?.querySelector(`[id="${activeId}"]`)?.scrollIntoView?.({ block: "nearest" });
    // onActiveChange is the host's setter; the id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  // A new query or tab is a new list; the highlight returns to the top.
  useEffect(() => setActive(0), [query, tab]);
  const settledEmpty = !loading && shown.length === 0;
  useEffect(() => {
    if (settledEmpty) onSettledEmpty?.();
    // Once per query that settles empty; the callback is the host's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledEmpty, query]);
  // The live region mounts empty and only then gets its text, so the first count is announced too.
  const [announced, setAnnounced] = useState("");
  useEffect(() => setAnnounced(loading ? "" : t("count", { count: shown.length })), [loading, shown.length, t]);

  useImperativeHandle(ref, () => ({
    isEmpty: () => shown.length === 0,
    isLoading: () => loading,
    onKeyDown(e) {
      if (e.isComposing || e.keyCode === 229) return false;
      const step = (i: number, by: number, n: number) => (i + by + n) % n;
      switch (e.key) {
        case "Escape":
          onDismiss();
          return true;
        case "ArrowDown":
        case "ArrowUp":
          if (shown.length === 0) return false;
          setActive(step(current, e.key === "ArrowDown" ? 1 : -1, shown.length));
          return true;
        case "ArrowRight":
        case "ArrowLeft": {
          // A held modifier selects or jumps by word or line: that is the text's, never a tab switch.
          if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
          // In a text field the arrows move the caret unless it is empty or already at that edge.
          const el = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement ? e.target : null;
          if (el && el.value !== "") {
            const edge = e.key === "ArrowLeft" ? 0 : el.value.length;
            if (el.selectionStart !== el.selectionEnd || el.selectionStart !== edge) return false;
          }
          setTab(tabs[step(tabs.indexOf(tab), e.key === "ArrowRight" ? 1 : -1, tabs.length)]!);
          return true;
        }
        case "Enter":
        case "Tab": {
          const pick = shown[current];
          if (e.shiftKey || !pick) return false;
          onPick(pick);
          return true;
        }
        default:
          return false;
      }
    },
  }));

  return (
    <div className="flex flex-col gap-1">
      <div role="tablist" aria-label={t("tabs_label")} className="flex flex-wrap gap-1">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            tabIndex={-1}
            aria-selected={k === tab}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(k)}
            className={cn(
              "rounded-md px-2 py-0.5 text-caption text-muted-foreground hover:bg-surface-hover pointer-coarse:min-h-11",
              k === tab && "bg-accent text-accent-foreground",
            )}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      {/* An empty listbox has no options to name, so it stays hidden; the empty text lives outside it. */}
      <div
        role="listbox"
        tabIndex={-1}
        aria-label={t("list")}
        id={listboxId}
        ref={list}
        aria-activedescendant={activeId}
        hidden={shown.length === 0}
        className="max-h-64 overflow-y-auto text-body"
      >
        {shown.map((item, i) => (
          <Row
            key={`${item.kind}:${item.id}`}
            item={item}
            query={query}
            id={optionId(i)}
            active={i === current}
            onPick={() => onPick(item)}
            onHover={() => setActive(i)}
          />
        ))}
      </div>
      {shown.length === 0 ? (
        loading ? (
          <Spinner className="mx-2 my-1.5" />
        ) : (
          <p className="px-2 py-1.5 text-caption text-muted-foreground">{t("empty")}</p>
        )
      ) : null}
      <p role="status" className="sr-only">
        {announced}
      </p>
    </div>
  );
});
