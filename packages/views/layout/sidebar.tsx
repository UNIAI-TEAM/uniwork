"use client";
import { CalendarDays, LogOut, SquareCheckBig, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import type { User, Workspace } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

const nav = [
  { key: "nav.tasks", href: "tasks", icon: SquareCheckBig },
  { key: "nav.meetings", href: "meetings", icon: CalendarDays },
  { key: "nav.members", href: "members", icon: Users },
] as const;

export function Sidebar({
  workspace,
  user,
  active,
}: {
  workspace: Workspace;
  user: User;
  active: string;
}) {
  const { t } = useTranslation();
  const logout = useLogout();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <div className="truncate text-sm font-semibold text-primary">{workspace.name}</div>
        <div className="truncate text-[12px] text-tertiary">{user.display_name}</div>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {nav.map(({ key, href, icon: Icon }) => (
          <a
            key={href}
            href={`/${workspace.slug}/${href}`}
            className={cn(
              "flex items-center gap-2 rounded-[var(--uw-radius)] px-2.5 py-1.5 text-sm",
              active === href
                ? "bg-subtle font-medium text-primary"
                : "text-secondary hover:bg-subtle hover:text-primary",
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </a>
        ))}
      </nav>
      <button
        className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm text-secondary hover:text-primary"
        onClick={() => {
          logout.mutate(undefined, { onSuccess: () => window.location.assign("/login") });
        }}
      >
        <LogOut className="size-4" />
        {t("auth.logout")}
      </button>
    </aside>
  );
}
