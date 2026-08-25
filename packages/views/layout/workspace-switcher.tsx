"use client";

import { ChevronsUpDown, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";
import { useNavigation } from "../navigation";

/**
 * Sidebar header: organization › current workspace. The menu groups every
 * workspace the user can see by organization and ends with "new workspace".
 * Switching is an in-app push, not a reload — the layout resolves the new
 * pair and the realtime provider reconnects on its own.
 */
export function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const { data: workspaces = [] } = useWorkspaces();

  const groups = new Map<string, { name: string; items: Workspace[] }>();
  for (const w of workspaces) {
    const g = groups.get(w.organization_id) ?? { name: w.organization_name, items: [] };
    g.items.push(w);
    groups.set(w.organization_id, g);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton size="lg" aria-label={t("org.switch")} className="data-[popup-open]:bg-sidebar-accent" />
        }
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-caption text-muted-foreground">{current.organization_name}</span>
          <span className="block truncate text-body font-medium text-sidebar-foreground">{current.name}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-faint-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        {[...groups.entries()].map(([orgId, g]) => (
          <DropdownMenuGroup key={orgId}>
            <DropdownMenuLabel>{g.name}</DropdownMenuLabel>
            {g.items.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => push(paths.workspace(w.organization_slug, w.slug).tasks())}
                className={cn(w.id === current.id && "font-medium")}
              >
                {w.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => push(paths.newWorkspace())}>
          <Plus aria-hidden className="size-4" />
          {t("workspace.new")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
