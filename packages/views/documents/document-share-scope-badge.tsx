"use client";

import { Building2, House, Link2, Lock, Share2, Users, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
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
  | "multiple";

/**
 * Resolves a row's share scope from `share_scope`, falling back to `visibility`
 * when an older response or fixture omits `share_scope`. Returns null when
 * neither carries a known scope.
 */
export function resolveDocumentShareScope(
  shareScope?: DocumentShareScope | null,
  visibility?: string | null,
): DocumentShareScope | null {
  if (shareScope) return shareScope;
  if (visibility === "workspace") {
    return {
      users: 0,
      home_workspace: true,
      workspaces: 0,
      organization: false,
      public_link: false,
    };
  }
  if (visibility === "restricted") {
    return {
      users: 0,
      home_workspace: false,
      workspaces: 0,
      organization: false,
      public_link: false,
    };
  }
  return null;
}

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
  shareScope?: DocumentShareScope | null;
  visibility?: string | null;
  workspaceName?: string | null;
  compact?: boolean;
  className?: string;
}

export function DocumentShareScopeBadge({
  shareScope,
  visibility,
  workspaceName,
  compact = false,
  className,
}: DocumentShareScopeBadgeProps) {
  const { t } = useTranslation();
  const contextWorkspaceName = useOptionalWorkspace()?.workspace.name;
  const resolvedWorkspaceName = (workspaceName ?? contextWorkspaceName ?? "").trim();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);

  const scope = resolveDocumentShareScope(shareScope, visibility);
  if (!scope) return null;

  const hasUsers = scope.users > 0;
  const hasHome = scope.home_workspace;
  const hasOtherWorkspaces = scope.workspaces > 0;
  const hasOrg = scope.organization;
  const activeCount = [hasUsers, hasHome, hasOtherWorkspaces, hasOrg].filter(Boolean).length;

  let kind: ShareScopeBadgeKind;
  let label: string;
  let Icon: LucideIcon;

  if (activeCount === 0) {
    kind = "private";
    label = t("documents.scope.private");
    Icon = Lock;
  } else if (activeCount >= 2) {
    kind = "multiple";
    label = t("documents.scope.multiple");
    Icon = Share2;
  } else if (hasUsers) {
    kind = "people";
    label = t("documents.scope.people", { count: scope.users });
    Icon = Users;
  } else if (hasHome) {
    kind = "workspace";
    label = t("documents.scope.workspace");
    Icon = House;
  } else if (hasOtherWorkspaces) {
    kind = "workspaces";
    label = t("documents.scope.workspaces", { count: scope.workspaces });
    Icon = House;
  } else {
    kind = "organization";
    label = t("documents.scope.organization");
    Icon = Building2;
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
  if (tooltipParts.length === 0) {
    tooltipParts.push(t("documents.scope.private"));
  }
  if (scope.public_link) {
    tooltipParts.push(t("documents.scope.public_link"));
  }
  const tooltipText = tooltipParts.join(" · ");
  const iconSize = compact ? "size-3" : "size-3.5";

  return (
    <>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          delay={0}
          render={
            <span
              data-testid="document-share-scope-badge"
              data-scope-kind={kind}
              title={tooltipText}
              aria-describedby={descriptionId}
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
          <span
            id={!open && tooltipText === label ? descriptionId : undefined}
            className="truncate"
          >
            {label}
          </span>
          {scope.public_link ? (
            <Link2
              aria-hidden
              data-scope-icon="public-link"
              className={cn(iconSize, "shrink-0 text-muted-foreground")}
            />
          ) : null}
        </TooltipTrigger>
        <TooltipContent id={open ? descriptionId : undefined} role="tooltip">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      {!open && tooltipText !== label && typeof document !== "undefined"
        ? createPortal(
            <span id={descriptionId} className="sr-only">
              {tooltipText}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
