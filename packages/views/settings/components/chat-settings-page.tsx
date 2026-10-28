"use client";

import { Suspense, lazy, type ComponentType } from "react";
import { Bell, ChevronRight, Info, Keyboard, LogOut, ShieldCheck, SlidersHorizontal, User, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore, useLogout } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { getDesktopBridge } from "@uniwork/core/platform";
import { UniChatIcon } from "@uniwork/ui/brand/unichat-icon";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { tintSolidClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { useLogoutUnsentGuard } from "../../layout/logout-unsent-guard";
import { initialsOf } from "../../layout/workspace-rail";
import { useNavigation } from "../../navigation";
import { AccountTab } from "./account-tab";
import { SettingsTab, SettingsTabSkeleton } from "./settings-layout";

// Notifications and shortcuts in their chat scope: only what the chat app sends and listens to.
const ChatNotificationsPanel = lazy(() =>
  import("./notifications-tab").then((m) => ({ default: () => <m.NotificationsTab scope="chat" /> })),
);
const PreferencesTab = lazy(() => import("./preferences-tab").then((m) => ({ default: m.PreferencesTab })));
const SecurityTab = lazy(() => import("./security-tab").then((m) => ({ default: m.SecurityTab })));
const ChatShortcutsPanel = lazy(() =>
  import("./keyboard-shortcuts-tab").then((m) => ({ default: () => <m.KeyboardShortcutsTab scope="chat" /> })),
);

/** The shell's names for `appInfo.os`; product names, the same in every language. */
const OS_NAMES: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };

/** The version this computer runs, and what happens when a new one is out. */
function UniChatAboutPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.unichat" });
  const info = getDesktopBridge()?.appInfo;
  return (
    <SettingsTab title={t("about")} description={t("about_description")}>
      <div className="flex items-center gap-5 rounded-2xl border border-border bg-surface p-6">
        <UniChatIcon size={64} decorative />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-display text-title font-bold text-foreground">{t("app_name")}</span>
          <span className="text-body text-muted-foreground">
            {info ? t("version", { version: info.version }) : t("web_build")}
            {info && OS_NAMES[info.os] ? ` · ${OS_NAMES[info.os]}` : null}
          </span>
          {info ? <span className="text-body text-muted-foreground">{t("updates")}</span> : null}
        </div>
      </div>
    </SettingsTab>
  );
}

type Section = { value: string; label: string; icon: LucideIcon; tint: Tint; Panel: ComponentType };

/**
 * The person's own settings; the organization's and the workspace's stay on
 * the web. Each wears Telegram's coloured tile; `?tab=` keeps the values the
 * web settings use.
 */
const SECTIONS: readonly Section[] = [
  { value: "profile", label: "settings.page.tabs.profile", icon: User, tint: "blue", Panel: AccountTab },
  { value: "notifications", label: "settings.page.tabs.notifications", icon: Bell, tint: "red", Panel: ChatNotificationsPanel },
  { value: "preferences", label: "settings.page.tabs.preferences", icon: SlidersHorizontal, tint: "violet", Panel: PreferencesTab },
  { value: "security", label: "settings.page.tabs.security", icon: ShieldCheck, tint: "green", Panel: SecurityTab },
  { value: "shortcuts", label: "settings.page.tabs.shortcuts", icon: Keyboard, tint: "gray", Panel: ChatShortcutsPanel },
  { value: "about", label: "settings.unichat.about", icon: Info, tint: "teal", Panel: UniChatAboutPanel },
];

/**
 * UniChat's settings (canvas "07 · Cài đặt"), beside the workspace rail where
 * the conversation list would be: who is signed in at the top, one row per
 * section, sign-out apart at the foot, and the chosen section to the right.
 */
export function ChatSettingsPage() {
  const { t } = useTranslation();
  const { searchParams, pathname, replace } = useNavigation();
  const user = useAuthStore((s) => s.user);
  const { mutateAsync: logout } = useLogout();
  const { confirmLogout, dialog } = useLogoutUnsentGuard(user?.id);
  const chosen = SECTIONS.find((section) => section.value === searchParams.get("tab")) ?? SECTIONS[0]!;
  const choose = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    replace(`${pathname}?${params.toString()}`);
  };
  const Panel = chosen.Panel;
  const name = user?.display_name ?? "";
  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label={t("settings.unichat.nav_aria")}
        className="flex w-72 shrink-0 flex-col border-r border-border bg-surface lg:w-85"
      >
        <header data-window-drag className="px-4 pt-3.5 pb-2">
          <h1 className="font-display text-title-lg font-bold tracking-[-0.02em] text-foreground">{t("nav.settings")}</h1>
        </header>
        <button
          type="button"
          onClick={() => choose("profile")}
          className="mx-2 mb-2 flex items-center gap-3.5 rounded-2xl bg-chat-rail p-2.5 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover"
        >
          <ActorAvatar
            name={name}
            initials={initialsOf(name)}
            avatarUrl={user?.avatar_url}
            size="fluid"
            className="size-14 bg-primary font-display text-title-sm font-bold text-primary-foreground"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body-lg font-semibold text-foreground">{name}</span>
            <span className="truncate text-label text-muted-foreground">{user?.email}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-faint-foreground" />
        </button>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
          {SECTIONS.map((section) => {
            const on = section.value === chosen.value;
            const Icon = section.icon;
            return (
              <button
                key={section.value}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => choose(section.value)}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-2.5 text-left text-body transition-colors duration-(--duration-fast)",
                  on ? "bg-brand-subtle font-semibold text-brand-subtle-foreground" : "text-foreground hover:bg-surface-hover",
                )}
              >
                <span className={cn("flex size-7.5 shrink-0 items-center justify-center rounded-[9px]", tintSolidClass[section.tint])}>
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{t(section.label)}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-faint-foreground" />
              </button>
            );
          })}
        </nav>
        <div className="border-t border-border p-2">
          <button
            type="button"
            className="flex h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left text-body text-destructive hover:bg-surface-hover"
            onClick={() =>
              confirmLogout(async () => {
                try {
                  await logout();
                } finally {
                  replace(paths.login());
                }
              })
            }
          >
            <span className="flex size-7.5 shrink-0 items-center justify-center rounded-[9px] bg-tint-red">
              <LogOut aria-hidden className="size-4" />
            </span>
            {t("auth.logout")}
          </button>
          {dialog}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-chat-rail">
        <div className="mx-auto w-full max-w-180 px-6 py-7 sm:px-10">
          <Suspense fallback={<SettingsTabSkeleton />}>
            <Panel />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
