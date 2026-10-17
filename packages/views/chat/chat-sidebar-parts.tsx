"use client";

import {
  CircleAlert,
  Compass,
  Hash,
  MessageCircleMore,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMyInvitations } from "@uniwork/core/workspaces";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import { MODULE_ICONS } from "../layout/module-icons";
import { InvitationList } from "../workspace/invitation-list";
import type { ChatSidebarActivityFilter, ChatSidebarKindFilter } from "./chat-sidebar-unified";

/* The list's buttons are pills, at the canvas' 40px. */
const PILL = "h-10 rounded-full px-4";
const EMPTY_FRAME = "flex flex-col items-center px-4 pt-20 pb-6 text-center";
const EMPTY_TITLE = "mt-4 max-w-65 font-display text-title-sm font-bold text-foreground";

/** A quiet icon action in the sidebar header, named by its tooltip. */
export function SidebarIconAction({
  icon: Icon,
  label,
  onClick,
  className,
  expanded,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
  expanded?: boolean;
  "data-chat-sidebar-collapse"?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            // A disclosure that is open most of the time: ghost's
            // aria-expanded fill is meant for a menu trigger, and here it would
            // paint the button as pressed for good.
            className={cn(
              "rounded-lg text-muted-foreground hover:text-foreground aria-expanded:not-hover:bg-transparent aria-expanded:not-hover:text-muted-foreground",
              className,
            )}
            aria-label={label}
            aria-expanded={expanded}
            onClick={onClick}
            {...rest}
          />
        }
      >
        <Icon aria-hidden className="size-4.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The centred tile every empty state of the list opens with. */
function EmptyTile({ icon }: { icon: LucideIcon }) {
  return <IconTile icon={icon} tone="brand" size="lg" className="size-16 rounded-2xl [&_svg]:size-7" />;
}

/**
 * A new workspace lists only its shared room. Under it, one quiet line says
 * what the list is for and offers the two ways to start — not an empty column.
 */
export function SidebarStarter({ onStartDm, onCreateGroup }: { onStartDm: () => void; onCreateGroup?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-3 mt-2 flex flex-col items-center border-t border-border pt-5 text-center">
      <EmptyTile icon={MessageCircleMore} />
      <p className="mt-3.5 max-w-60 text-body text-pretty text-muted-foreground">{t("chat.sidebar_starter_hint")}</p>
      <div className="mt-4 flex w-full max-w-58 flex-col gap-2">
        <Button type="button" className={PILL} onClick={onStartDm}>
          <UserPlus aria-hidden />
          {t("chat.add_dm_aria")}
        </Button>
        {onCreateGroup ? (
          <Button type="button" variant="secondary" className={PILL} onClick={onCreateGroup}>
            <Users aria-hidden />
            {t("chat.create_group_aria")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* Alternating shapes: the list is people (circles) and rooms (squircles). */
const SKELETON_ROWS = [
  { name: "w-2/3", line: "w-11/12", mark: "rounded-xl" },
  { name: "w-1/2", line: "w-3/4", mark: "rounded-full" },
  { name: "w-3/4", line: "w-5/6", mark: "rounded-full" },
  { name: "w-2/5", line: "w-2/3", mark: "rounded-xl" },
  { name: "w-3/5", line: "w-4/5", mark: "rounded-full" },
];

/** The loading shape is the row's shape: a mark, a name with its time, a preview. */
export function SidebarSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" className="py-1">
      <span className="sr-only">{t("common.loading")}</span>
      {SKELETON_ROWS.map((row) => (
        <div key={row.name} className="flex h-17 items-center gap-3 px-3" aria-hidden>
          <Skeleton className={cn("size-12 shrink-0", row.mark)} />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className={cn("h-3.5 rounded-full", row.name)} />
              <Skeleton className="h-2.5 w-8 shrink-0 rounded-full" />
            </div>
            <Skeleton className={cn("h-3 rounded-full", row.line)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The rooms request failed: say so in the list itself, with the way to try again. */
export function SidebarLoadError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Notice
      tone="destructive"
      icon={CircleAlert}
      layout="inline"
      live="assertive"
      className="mx-1 my-2 items-start rounded-xl p-3.5"
      action={
        onRetry ? (
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRetry}>
            <RefreshCw aria-hidden />
            {t("chat.retry")}
          </Button>
        ) : null
      }
    >
      {t("chat.sidebar_load_failed")}
    </Notice>
  );
}

type SidebarEmptyActions = {
  onStartDm: () => void;
  onCreateGroup?: () => void;
  onCreateChannel?: () => void;
  onBrowseChannels?: () => void;
  onShowAll: () => void;
};

/**
 * Three different truths share this slot: a search with no hit, a kind filter
 * with nothing of that kind yet, and no conversation at all beyond the
 * workspace room. Each says which one it is and offers the step that fits:
 * a DM filter offers a new message, a group filter a new group, a channel
 * filter the directory or a new channel — and any filter a way back to all.
 */
export function SidebarEmpty({
  searching,
  kindFilter,
  activityFilter = "all",
  actions,
}: {
  searching: boolean;
  kindFilter: ChatSidebarKindFilter;
  activityFilter?: ChatSidebarActivityFilter;
  actions: SidebarEmptyActions;
}) {
  const { t } = useTranslation();
  const filtered = kindFilter !== "all" || activityFilter !== "all";
  const showAll = filtered ? (
    <Button type="button" variant={searching ? "secondary" : "ghost"} className={PILL} onClick={actions.onShowAll}>
      {t("chat.sidebar_show_all")}
    </Button>
  ) : null;

  if (searching) {
    return (
      <div className={EMPTY_FRAME}>
        <EmptyTile icon={Search} />
        <p className={EMPTY_TITLE}>{t("chat.search_no_results")}</p>
        {showAll ? <div className="mt-5">{showAll}</div> : null}
      </div>
    );
  }

  let icon: LucideIcon = MODULE_ICONS.chat;
  let hint = t("chat.sidebar_empty_hint");
  let primary: ReactNode = (
    <Button type="button" className={PILL} onClick={actions.onStartDm}>
      <UserPlus aria-hidden />
      {t("chat.add_dm_aria")}
    </Button>
  );
  let secondary: ReactNode = null;
  if (activityFilter === "unread") {
    hint = t("chat.sidebar_filter_empty_unread_hint");
    primary = null;
  } else if (activityFilter === "mentions") {
    hint = t("chat.sidebar_filter_empty_mentions_hint");
    primary = null;
  } else if (kindFilter === "dm") {
    hint = t("chat.sidebar_filter_empty_dm_hint");
  } else if (kindFilter === "group" && actions.onCreateGroup) {
    icon = Users;
    hint = t("chat.sidebar_filter_empty_group_hint");
    primary = (
      <Button type="button" className={PILL} onClick={actions.onCreateGroup}>
        <Users aria-hidden />
        {t("chat.create_group_aria")}
      </Button>
    );
  } else if (kindFilter === "channel") {
    icon = Hash;
    hint = t("chat.sidebar_filter_empty_channel_hint");
    primary = actions.onBrowseChannels ? (
      <Button type="button" className={PILL} onClick={actions.onBrowseChannels}>
        <Compass aria-hidden />
        {t("chat.channel.directory_aria")}
      </Button>
    ) : null;
    secondary = actions.onCreateChannel ? (
      <Button type="button" variant="secondary" className={PILL} onClick={actions.onCreateChannel}>
        <Hash aria-hidden />
        {t("chat.channel.create_aria")}
      </Button>
    ) : null;
  }

  return (
    <div className={EMPTY_FRAME}>
      <EmptyTile icon={icon} />
      <p className={EMPTY_TITLE}>
        {filtered ? t("chat.sidebar_filter_empty_title") : t("chat.sidebar_empty_title")}
      </p>
      <p className="mt-1.5 max-w-65 text-body text-pretty text-muted-foreground">{hint}</p>
      {primary || secondary ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primary}
          {secondary}
        </div>
      ) : null}
      {showAll ? <div className={primary || secondary ? "mt-2" : "mt-5"}>{showAll}</div> : null}
    </div>
  );
}

/**
 * Invitations wait here: once someone is inside a workspace nothing else in
 * the app lists them. The list holds invitations into any organization, and
 * joining another one means switching (ADR 0032), so a row only opens the
 * invitation's own page, where every join happens (spec 2026-10-13 §6.2).
 * The rows are the shared invitation rows at sidebar density: inviter, then
 * "Organization › Workspace", then role and expiry with the "expires soon"
 * flag, so an invitation reads the same here as on /invitations.
 */
export function SidebarInvitations() {
  const { t } = useTranslation();
  const headingId = useId();
  const { data: invites = [] } = useMyInvitations();
  if (invites.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-2 px-4 pt-2 pb-1">
      {/* text-overline sets its own case and tracking. */}
      <h3 id={headingId} className="px-1 text-overline text-muted-foreground">
        {t("chat.pending_invites")}
      </h3>
      <InvitationList invitations={invites} label={t("chat.pending_invites")} compact />
    </section>
  );
}
