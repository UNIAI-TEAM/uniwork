"use client";

import { Building2, House, Link2, Lock, Share2, Users, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentShareScope } from "@uniwork/core/types/document";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";

export type ShareScopeBadgeKind =
  | "private"
  | "people"
  | "workspace"
  | "workspaces"
  | "organization"
  | "multiple"
  | "link";

/**
 * True when the scope is solely the document's home workspace with no other
 * shares and no public link (the default workspace-shared state that the
 * narrow secondary line omits to avoid repeating "Workspace" on every row).
 */
export function isPlainHomeWorkspaceScope(scope: DocumentShareScope | null): boolean {
  return Boolean(
    scope &&
      scope.home_workspace &&
      scope.users === 0 &&
      scope.workspaces === 0 &&
      !scope.organization &&
      !scope.public_link,
  );
}

export interface DocumentShareScopeBadgeProps {
  /** A row without `share_scope` renders nothing: the scope is never guessed from `visibility`. */
  shareScope?: DocumentShareScope | null;
  /** The document's home workspace, for the tooltip. Beats `workspaceId`. */
  workspaceName?: string | null;
  /** The document's own workspace id: only the viewer's current workspace is named from context. */
  workspaceId?: string | null;
  compact?: boolean;
  /**
   * Whether the badge takes keyboard focus to open its tooltip. Off where the
   * badge already sits inside a button or link (a focusable inside it would
   * nest interactive controls); the label text then reads with its parent.
   */
  focusable?: boolean;
  /**
   * A caller-owned id for the composition text (SW-V4): when the badge is not
   * focusable, the row's name button points `aria-describedby` at the same
   * hidden span, so the scope composition reaches the focused control.
   */
  descriptionId?: string;
  className?: string;
}

type T = (key: string, options?: Record<string, unknown>) => string;

/**
 * Pure view model for a share scope: kind, label and the full composition
 * text ("1 workspace khác · 2 người · Liên kết công khai"). The badge renders
 * it as label + aria-describedby; the library row reuses it for the ⋯-menu
 * label and the name button's accessible description (SW-V4).
 * `resolvedWorkspaceName` is already resolved (prop or current-workspace name).
 */
export function shareScopeView(
  scope: DocumentShareScope | null | undefined,
  t: T,
  resolvedWorkspaceName: string,
): { kind: ShareScopeBadgeKind; label: string; tooltipText: string } | null {
  if (!scope) return null;

  const hasUsers = scope.users > 0;
  const hasHome = scope.home_workspace;
  const hasOtherWorkspaces = scope.workspaces > 0;
  const hasOrg = scope.organization;
  const activeCount = [hasUsers, hasHome, hasOtherWorkspaces, hasOrg].filter(Boolean).length;

  let kind: ShareScopeBadgeKind;
  let label: string;

  if (activeCount === 0 && scope.public_link) {
    // Private means no person, no group and no live link: a live link alone is
    // not private, and its own state is what the badge shows.
    kind = "link";
    label = t("documents.scope.public_link");
  } else if (activeCount === 0) {
    kind = "private";
    label = t("documents.scope.private");
  } else if (activeCount >= 2) {
    kind = "multiple";
    label = t("documents.scope.multiple");
  } else if (hasUsers) {
    kind = "people";
    label = t("documents.scope.people", { count: scope.users });
  } else if (hasHome) {
    kind = "workspace";
    label = t("documents.scope.workspace");
  } else if (hasOtherWorkspaces) {
    kind = "workspaces";
    label = t("documents.scope.workspaces", { count: scope.workspaces });
  } else {
    kind = "organization";
    label = t("documents.scope.organization");
  }

  const tooltipParts: string[] = [];
  if (hasOrg) {
    tooltipParts.push(t("documents.scope.organization"));
  }
  if (hasHome) {
    tooltipParts.push(
      resolvedWorkspaceName
        ? t("documents.scope.tooltip_home_workspace", { name: resolvedWorkspaceName })
        : t("documents.scope.workspace"),
    );
  }
  if (hasOtherWorkspaces) {
    tooltipParts.push(t("documents.scope.tooltip_other_workspaces", { count: scope.workspaces }));
  }
  if (hasUsers) {
    tooltipParts.push(t("documents.scope.people", { count: scope.users }));
  }
  if (scope.public_link) {
    tooltipParts.push(t("documents.scope.public_link"));
  }
  if (tooltipParts.length === 0) {
    tooltipParts.push(t("documents.scope.private"));
  }
  return { kind, label, tooltipText: tooltipParts.join(" · ") };
}

export function DocumentShareScopeBadge({
  shareScope,
  workspaceName,
  workspaceId,
  compact = false,
  focusable = true,
  descriptionId: descriptionIdProp,
  className,
}: DocumentShareScopeBadgeProps) {
  const { t } = useTranslation();
  const currentWorkspace = useOptionalWorkspace()?.workspace;
  // A document from another workspace (search, shared with me) must not borrow
  // the viewer's current workspace name: without a known name the tooltip says "Workspace".
  const contextName = !workspaceId || workspaceId === currentWorkspace?.id ? currentWorkspace?.name : undefined;
  const resolvedWorkspaceName = (workspaceName ?? contextName ?? "").trim();
  const generatedId = useId();
  const descriptionId = descriptionIdProp ?? generatedId;
  const [open, setOpen] = useState(false);

  const view = shareScopeView(shareScope, t, resolvedWorkspaceName);
  if (!view) return null;
  const { kind, label, tooltipText } = view;
  const iconSize = compact ? "size-3" : "size-3.5";
  const Icon: LucideIcon =
    kind === "link"
      ? Link2
      : kind === "private"
        ? Lock
        : kind === "multiple"
          ? Share2
          : kind === "people"
            ? Users
            : kind === "organization"
              ? Building2
              : House;

  return (
    <>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          delay={0}
          render={
            <span
              data-testid="document-share-scope-badge"
              data-scope-kind={kind}
              {...(focusable ? { tabIndex: 0 } : {})}
              aria-describedby={tooltipText === label ? undefined : descriptionId}
              className={cn(
                "inline-flex min-w-0 shrink-0 items-center gap-1 text-caption",
                compact ? "text-muted-foreground" : "text-foreground",
                className,
              )}
            />
          }
        >
          <Icon
            aria-hidden
            data-scope-icon={kind}
            className={cn(
              iconSize,
              "shrink-0",
              kind === "private" ? "text-warning" : "text-muted-foreground",
            )}
          />
          <span className="truncate">{label}</span>
          {shareScope?.public_link && kind !== "link" ? (
            <Link2
              aria-hidden
              data-scope-icon="public-link"
              className={cn(iconSize, "shrink-0 text-muted-foreground")}
            />
          ) : null}
        </TooltipTrigger>
        <TooltipContent role="tooltip">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      {tooltipText !== label ? (
        <span id={descriptionId} hidden>
          {tooltipText}
        </span>
      ) : null}
    </>
  );
}
