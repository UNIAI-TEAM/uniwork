"use client";

import { AlertCircle, Compass, Hash, MessageSquare, UserPlus, Users, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PendingInvitation, Workspace } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import { moduleTone } from "../layout/module-tones";
import { toastChatError } from "./chat-error-message";
import type { ChatSidebarKindFilter } from "./chat-sidebar-unified";

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
              "text-muted-foreground hover:text-foreground aria-expanded:not-hover:bg-transparent aria-expanded:not-hover:text-muted-foreground",
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

/**
 * A new workspace lists only its shared room. Under it, one quiet line says
 * what the list is for and offers the two ways to start — not an empty column.
 */
export function SidebarStarter({ onStartDm, onCreateGroup }: { onStartDm: () => void; onCreateGroup?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-2 border-t border-border px-2 pt-3">
      <p className="text-caption text-pretty text-muted-foreground">{t("chat.sidebar_starter_hint")}</p>
      <div className="flex flex-col items-start gap-0.5">
        <Button type="button" variant="ghost" size="sm" className="-ml-2 text-foreground" onClick={onStartDm}>
          <UserPlus aria-hidden />
          {t("chat.add_dm_aria")}
        </Button>
        {onCreateGroup ? (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-foreground" onClick={onCreateGroup}>
            <Users aria-hidden />
            {t("chat.create_group_aria")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The loading shape is the row's shape: a mark, a name, a preview. */
export function SidebarSkeleton() {
  const { t } = useTranslation();
  const widths = ["w-2/3", "w-1/2", "w-3/4", "w-2/5", "w-3/5"];
  return (
    <div role="status" className="space-y-px py-1">
      <span className="sr-only">{t("common.loading")}</span>
      {widths.map((w) => (
        <div key={w} className="flex items-center gap-3 px-2 py-2" aria-hidden>
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3.5 ${w}`} />
            <Skeleton className="h-3 w-4/5" />
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
      icon={AlertCircle}
      layout="inline"
      live="assertive"
      className="my-1"
      action={
        onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
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
  actions,
}: {
  searching: boolean;
  kindFilter: ChatSidebarKindFilter;
  actions: SidebarEmptyActions;
}) {
  const { t } = useTranslation();
  const filtered = kindFilter !== "all";
  const showAll = filtered ? (
    <Button type="button" variant="ghost" size="sm" onClick={actions.onShowAll}>
      {t("chat.sidebar_show_all")}
    </Button>
  ) : null;

  if (searching) {
    return (
      <div className="flex flex-col items-start gap-1 px-2 py-3">
        <p className="text-caption text-muted-foreground">{t("chat.search_no_results")}</p>
        {showAll}
      </div>
    );
  }

  let hint = t("chat.sidebar_empty_hint");
  let primary: ReactNode = (
    <Button type="button" variant="outline" size="sm" onClick={actions.onStartDm}>
      <UserPlus aria-hidden />
      {t("chat.add_dm_aria")}
    </Button>
  );
  let secondary: ReactNode = null;
  if (kindFilter === "dm") {
    hint = t("chat.sidebar_filter_empty_dm_hint");
  } else if (kindFilter === "group" && actions.onCreateGroup) {
    hint = t("chat.sidebar_filter_empty_group_hint");
    primary = (
      <Button type="button" variant="outline" size="sm" onClick={actions.onCreateGroup}>
        <Users aria-hidden />
        {t("chat.create_group_aria")}
      </Button>
    );
  } else if (kindFilter === "channel") {
    hint = t("chat.sidebar_filter_empty_channel_hint");
    primary = actions.onBrowseChannels ? (
      <Button type="button" variant="outline" size="sm" onClick={actions.onBrowseChannels}>
        <Compass aria-hidden />
        {t("chat.channel.directory_aria")}
      </Button>
    ) : null;
    secondary = actions.onCreateChannel ? (
      <Button type="button" variant="ghost" size="sm" onClick={actions.onCreateChannel}>
        <Hash aria-hidden />
        {t("chat.channel.create_aria")}
      </Button>
    ) : null;
  }

  return (
    <div className="flex flex-col items-start gap-2 px-2 py-4">
      <IconTile icon={MessageSquare} tone={moduleTone("chat")} size="sm" />
      <p className="text-body font-medium text-foreground">
        {filtered ? t("chat.sidebar_filter_empty_title") : t("chat.sidebar_empty_title")}
      </p>
      <p className="text-caption text-pretty text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap items-center gap-1">
        {primary}
        {secondary}
        {showAll}
      </div>
    </div>
  );
}

/**
 * Invitations to other workspaces wait here: once someone is inside a
 * workspace nothing else in the app lists them (the /invitations page only
 * runs right after sign-in). Joining opens the workspace just joined.
 */
export function SidebarInvitations({ onJoined }: { onJoined?: (workspace: Workspace | null) => void }) {
  const { t } = useTranslation();
  const { data: invites = [] } = useMyInvitations();
  const accept = useAcceptInvite();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  if (invites.length === 0) return null;

  const join = (inv: PendingInvitation) => {
    setJoiningId(inv.id);
    accept.mutate(inv.token, {
      onSuccess: (result) => onJoined?.(result?.workspace ?? null),
      onError: (err) => toastChatError(err, t, t("chat.invite_join_failed")),
      onSettled: () => setJoiningId(null),
    });
  };

  return (
    <section className="space-y-2 px-3 pb-2">
      <h3 className="px-1 text-overline text-muted-foreground uppercase">{t("chat.pending_invites")}</h3>
      <ul className="space-y-1">
        {invites.map((inv) => {
          const joining = joiningId === inv.id;
          return (
            <li key={inv.id} className="flex flex-col gap-2 rounded-lg bg-brand-subtle px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-foreground">
                  {inv.organization.name} › {inv.workspace.name}
                </p>
                <p className="text-caption text-muted-foreground">
                  {t("invitations.invitedBy", { name: inv.invited_by.display_name })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={joiningId !== null}
                aria-busy={joining || undefined}
                onClick={() => join(inv)}
              >
                {joining ? t("chat.invite_joining") : t("invitations.join")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
