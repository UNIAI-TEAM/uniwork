"use client";
import { Menu } from "@base-ui/react/menu";
import { ChevronsUpDown, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { cn } from "@uniwork/ui/lib/utils";

/** Đầu sidebar: tổ chức › workspace hiện tại; menu nhóm theo org + "Workspace mới". */
export function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const { t } = useTranslation();
  const { data: workspaces = [] } = useWorkspaces();
  const groups = new Map<string, { name: string; items: Workspace[] }>();
  for (const w of workspaces) {
    const g = groups.get(w.organization_id) ?? { name: w.organization_name, items: [] };
    g.items.push(w);
    groups.set(w.organization_id, g);
  }
  const go = (url: string) => window.location.assign(url);

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("org.switch")}
        className="flex w-full items-center gap-2 border-b border-line px-4 py-3 text-left hover:bg-subtle"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-tertiary">{current.organization_name}</span>
          <span className="block truncate text-sm font-semibold text-primary">{current.name}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-tertiary" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-50">
          <Menu.Popup className="min-w-60 rounded-[var(--uw-radius)] border border-line bg-surface p-1 shadow-lg">
            {[...groups.entries()].map(([orgId, g]) => (
              <Menu.Group key={orgId}>
                <Menu.GroupLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-tertiary">{g.name}</Menu.GroupLabel>
                {g.items.map((w) => (
                  <Menu.Item
                    key={w.id}
                    onClick={() => go(paths.workspace(w.organization_slug, w.slug).tasks())}
                    className={cn(
                      "cursor-default rounded px-2 py-1.5 text-sm text-primary data-[highlighted]:bg-subtle",
                      w.id === current.id && "font-medium",
                    )}
                  >
                    {w.name}
                  </Menu.Item>
                ))}
              </Menu.Group>
            ))}
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Item
              onClick={() => go(paths.newWorkspace())}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm text-text-secondary data-[highlighted]:bg-subtle data-[highlighted]:text-primary"
            >
              <Plus className="size-4" />
              {t("workspace.new")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
