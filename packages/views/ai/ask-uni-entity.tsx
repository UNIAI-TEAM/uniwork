"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Box, ChevronRight, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatRoom } from "@uniwork/core/chat";
import { useDocument } from "@uniwork/core/documents";
import { useMeeting } from "@uniwork/core/meetings";
import { useProject, useTask } from "@uniwork/core/tasks";
import type { AiCitation, TaskStatus } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@uniwork/ui/components/ui/hover-card";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { AppLink } from "../navigation";
import { PersonAvatar } from "../people/person-avatar";
import { StatusIcon } from "../tasks/icons/status-icon";
import { STATUS_CONFIG } from "../tasks/modes/status-config";
import { isInAppHref } from "./ask-uni-links";

// Server kind -> module whose glyph draws it; "members" is the P0 people list, "workload" has no module of its own.
const KIND_MODULE = {
  task: "tasks",
  document: "documents",
  meeting: "meetings",
  project: "projects",
  member: "people",
  members: "people",
  chat: "chat",
} as const;
type Kind = keyof typeof KIND_MODULE;
const isKind = (k: string): k is Kind => Object.hasOwn(KIND_MODULE, k);

export function entityKindIcon(kind: string): LucideIcon {
  return isKind(kind) ? MODULE_ICONS[KIND_MODULE[kind]] : Box;
}

/** An object's chip inside a sentence: shared by the answer's entity chips and the composer's cards. */
export const CHIP = "mx-0.5 inline-flex max-w-64 items-center gap-1 rounded-md bg-muted px-1.5 align-baseline text-body text-foreground";

/** True under a markdown link: a chip there is text, so the outer link owns the click and no anchor nests. */
export const InLinkContext = createContext(false);

/** The singular word for a kind ("Task", "Người"); an unknown kind reads as "other". */
export function useKindLabel(kind: string) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.entity.kind" });
  return t(isKind(kind) ? kind : "other");
}

/** A task's live status icon and label; nothing until the task is read. */
export function TaskStatusLabel({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const status = useTask(taskId).data?.status;
  if (!status) return null;
  return (
    <>
      <StatusIcon status={status} className={cn("size-3 shrink-0", STATUS_CONFIG[status as TaskStatus]?.iconColor)} />
      <span className="shrink-0 text-caption text-muted-foreground">{t(`tasks.status_${status}`, { defaultValue: status })}</span>
    </>
  );
}

function PersonFace({ wsId, userId, name }: { wsId: string; userId: string; name: string }) {
  const m = useMembers(wsId).data?.find((x) => x.user_id === userId);
  return <PersonAvatar id={userId} name={name} size="xs" avatarUrl={typeof m?.avatar_url === "string" ? m.avatar_url : undefined} />;
}

/** The object a `[S#]` names: its name as a link, a glyph or face, and for a task its live status. A hover or focus opens the card. */
export function AskUniEntityChip({ source, wsId }: { source: AiCitation; wsId: string }) {
  const kindLabel = useKindLabel(source.kind);
  const inLink = useContext(InLinkContext);
  const name = source.title || kindLabel;
  const Icon = entityKindIcon(source.kind);
  const lead =
    source.kind === "member" && source.object_id ? (
      <PersonFace wsId={wsId} userId={source.object_id} name={name} />
    ) : (
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    );
  const body = (
    <>
      {lead}
      <span className="truncate">{name}</span>
      {source.kind === "task" && source.object_id ? <TaskStatusLabel taskId={source.object_id} /> : null}
    </>
  );
  // A href that leaves the app is shown, never followed.
  if (inLink) {
    return (
      <span className={CHIP}>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </span>
    );
  }
  if (!isInAppHref(source.href)) return <span className={CHIP}>{body}</span>;
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        render={<AppLink href={source.href} />}
        aria-label={`${kindLabel}: ${name}`}
        className={cn(CHIP, "hover:bg-surface-hover")}
      >
        {body}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <AskUniEntityCard source={source} wsId={wsId} />
      </HoverCardContent>
    </HoverCard>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5 text-caption">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

/** A live read: the card says so when it fails (403/404) and stays quiet while it loads. */
function Live<T>({ q, children }: { q: { data?: T | null; isError: boolean }; children: (data: T) => ReactNode }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.entity" });
  // A read that succeeded with nothing (null) is as good as a refusal.
  if (q.isError || q.data === null) return <p className="text-caption text-muted-foreground">{t("unavailable")}</p>;
  return q.data ? <>{children(q.data)}</> : null;
}

function useDate() {
  const { i18n } = useTranslation();
  return (iso: string, withTime = false) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    // A date-only value is a calendar day, not an instant: parse it as local so it does not shift.
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(i18n.language, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(d);
  };
}

function TaskCard({ id, wsId }: { id: string; wsId: string }) {
  const { t } = useTranslation();
  const date = useDate();
  const q = useTask(id);
  const project = useProject(wsId, q.data?.project_id ?? "").data;
  return (
    <Live q={q}>
      {(task) => (
        <dl className="flex flex-col gap-1">
          {task.identifier ? <Row label={t("ai.entity.kind.task")}>{task.identifier}</Row> : null}
          {project ? <Row label={t("ai.entity.project")}>{project.title}</Row> : null}
          <Row label={t("ai.entity.status")}>{t(`tasks.status_${task.status}`, { defaultValue: task.status })}</Row>
          <Row label={t("ai.entity.assignee")}>{task.assignee?.display_name || t("ai.entity.unassigned")}</Row>
          {task.due_date ? <Row label={t("ai.entity.due")}>{date(task.due_date)}</Row> : null}
          <Row label={t("ai.entity.priority")}>{t(`tasks.priority_${task.priority}`, { defaultValue: task.priority })}</Row>
        </dl>
      )}
    </Live>
  );
}

function PersonCard({ userId, wsId }: { userId: string; wsId: string }) {
  const { t } = useTranslation();
  const q = useMembers(wsId);
  const m = q.data?.find((x) => x.user_id === userId);
  // A list that loaded without this person is the same answer as a refusal.
  return (
    <Live q={{ data: m, isError: q.isError || (q.isSuccess && !m) }}>
      {(p) => (
        <div className="flex items-center gap-2">
          <PersonAvatar id={userId} name={p.display_name} size="sm" avatarUrl={typeof p.avatar_url === "string" ? p.avatar_url : undefined} />
          <span className="min-w-0 truncate text-body font-medium">{p.display_name}</span>
          <span className="shrink-0 text-caption text-muted-foreground">{t(`people.role_${p.role}`, { defaultValue: p.role })}</span>
        </div>
      )}
    </Live>
  );
}

function CardBody({ source, wsId }: { source: AiCitation; wsId: string }) {
  const { t } = useTranslation();
  const date = useDate();
  const id = source.object_id ?? "";
  const doc = useDocument(wsId, source.kind === "document" ? id : "");
  const meeting = useMeeting(source.kind === "meeting" ? id : "");
  const project = useProject(wsId, source.kind === "project" ? id : "");
  const room = useChatRoom(wsId, source.kind === "chat" ? id : "", source.kind === "chat");
  switch (source.kind) {
    case "task":
      return <TaskCard id={id} wsId={wsId} />;
    case "member":
      return <PersonCard userId={id} wsId={wsId} />;
    case "document":
      return (
        <Live q={doc}>
          {(d) => (d.content_text ? <p className="line-clamp-4 text-caption text-muted-foreground">{d.content_text.slice(0, 240)}</p> : null)}
        </Live>
      );
    case "meeting":
      return <Live q={meeting}>{(m) => <p className="text-caption text-muted-foreground">{date(m.starts_at, true)}</p>}</Live>;
    case "project":
      return (
        <Live q={project}>
          {(p) => <p className="text-caption text-muted-foreground">{t(`projects.status.${p.status}`, { defaultValue: p.status })}</p>}
        </Live>
      );
    case "chat":
      return <Live q={room}>{(r) => <p className="truncate text-caption text-muted-foreground">{r.name}</p>}</Live>;
    default:
      return null;
  }
}

/** What the hover card shows: the name, the live facts of its kind (read-only) and an Open link. */
export function AskUniEntityCard({ source, wsId }: { source: AiCitation; wsId: string }) {
  const { t } = useTranslation();
  const kindLabel = useKindLabel(source.kind);
  return (
    <div className="flex flex-col gap-1.5">
      {source.kind === "member" ? null : <p className="truncate text-body font-medium">{source.title || kindLabel}</p>}
      <CardBody source={source} wsId={wsId} />
      {isInAppHref(source.href) ? (
        <AppLink href={source.href} className="text-caption font-medium text-primary hover:underline">
          {t("ai.cite.open")}
        </AppLink>
      ) : null}
    </div>
  );
}

/** "Sources (n)": collapsed by default, expands to one row per source. Rows link only in-app addresses. */
export function AskUniSources({ citations }: { citations: AiCitation[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (citations.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {t("sources_count", { count: citations.length })}
      </button>
      {open ? (
        <ul id={listId} className="mt-1 flex flex-col gap-1" aria-label={t("sources")}>
          {citations.map((c) => {
            const Icon = entityKindIcon(c.kind);
            const body = (
              <>
                <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.title || c.kind}</span>
              </>
            );
            return (
              <li key={c.source_id}>
                {isInAppHref(c.href) ? (
                  <AppLink href={c.href} className="inline-flex max-w-full items-center gap-1.5 text-caption hover:underline">
                    {body}
                  </AppLink>
                ) : (
                  <span className="inline-flex max-w-full items-center gap-1.5 text-caption">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
