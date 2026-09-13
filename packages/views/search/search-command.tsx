"use client";

import { CalendarDays, History, Monitor, Moon, Settings, SquareCheckBig, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, setLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { useLocaleAdapter } from "@uniwork/core/i18n/react";
import { paths } from "@uniwork/core/paths";
import { useSearchStore } from "@uniwork/core/search";
import { useRecentTasks } from "@uniwork/core/tasks/stores/recent-tasks-store";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@uniwork/ui/components/ui/command";
import { useWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";

/** How many recent tasks the palette lists; the store keeps more. */
const RECENT_TASKS_SHOWN = 5;

export function SearchCommand({ onCreateTask }: { onCreateTask: () => void }) {
  const { open, setOpen } = useSearchStore();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const { setTheme } = useTheme();
  const localeAdapter = useLocaleAdapter();
  const { t, i18n } = useTranslation();
  const recentTasks = useRecentTasks(workspace.id);

  // Controlled so the recent group can hide while a query is typed: cmdk would
  // otherwise filter recent items by title like every other item.
  const [query, setQuery] = useState("");
  // Clear the query on every close, including the global ⌘K toggle, which
  // closes through the store rather than through this dialog. Adjusted during
  // render, React's pattern for resetting state when a value changes.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setQuery("");
  }

  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const showRecent = query.trim() === "" && recentTasks.length > 0;

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const changeLanguage = (next: SupportedLocale) => {
    localeAdapter.persist(next);
    void setLocale(next);
    document.documentElement.lang = next;
    toast.success(t("settings.preferences.toastSaved"), { id: "settings-auto-save" });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("search.title")}
      description={t("search.description")}
    >
      <Command>
        <CommandInput placeholder={t("search.placeholder")} value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{t("search.empty")}</CommandEmpty>
          {showRecent ? (
            <CommandGroup heading={t("search.groups.recent")}>
              {recentTasks.slice(0, RECENT_TASKS_SHOWN).map((task) => (
                <CommandItem
                  key={task.id}
                  value={`recent ${task.id} ${task.identifier} ${task.title}`}
                  onSelect={() => run(() => push(ws.task(task.id)))}
                >
                  <History />
                  <span className="shrink-0 text-muted-foreground">{task.identifier}</span>
                  <span className="truncate">{task.title || t("tasks.detail.title_placeholder")}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading={t("search.groups.pages")}>
            <CommandItem
              value={`${t("search.pages.tasks")} tasks cong viec`}
              onSelect={() => run(() => push(ws.tasks()))}
            >
              <SquareCheckBig />
              {t("search.pages.tasks")}
            </CommandItem>
            <CommandItem
              value={`${t("search.pages.meetings")} meetings cuoc hop`}
              onSelect={() => run(() => push(ws.meetings()))}
            >
              <CalendarDays />
              {t("search.pages.meetings")}
            </CommandItem>
            <CommandItem
              value={`${t("search.pages.settings")} settings cai dat`}
              onSelect={() => run(() => push(ws.settings()))}
            >
              <Settings />
              {t("search.pages.settings")}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t("search.groups.commands")}>
            <CommandItem
              value={`${t("search.commands.createTask")} new task tao viec`}
              onSelect={() => run(onCreateTask)}
            >
              <SquareCheckBig />
              {t("search.commands.createTask")}
            </CommandItem>
            <CommandItem
              value={`${t("search.commands.themeLight")} light`}
              onSelect={() =>
                run(() => {
                  setTheme("light");
                  toast.success(t("settings.preferences.toastSaved"), { id: "settings-auto-save" });
                })
              }
            >
              <Sun />
              {t("search.commands.themeLight")}
            </CommandItem>
            <CommandItem
              value={`${t("search.commands.themeDark")} dark`}
              onSelect={() =>
                run(() => {
                  setTheme("dark");
                  toast.success(t("settings.preferences.toastSaved"), { id: "settings-auto-save" });
                })
              }
            >
              <Moon />
              {t("search.commands.themeDark")}
            </CommandItem>
            <CommandItem
              value={`${t("search.commands.themeSystem")} system`}
              onSelect={() =>
                run(() => {
                  setTheme("system");
                  toast.success(t("settings.preferences.toastSaved"), { id: "settings-auto-save" });
                })
              }
            >
              <Monitor />
              {t("search.commands.themeSystem")}
            </CommandItem>
            {SUPPORTED_LOCALES.map((locale) => (
              <CommandItem
                key={locale}
                value={`${locale === "vi" ? t("search.commands.languageVi") : t("search.commands.languageEn")} ${locale}`}
                onSelect={() => {
                  if (
                    (SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
                      ? (i18n.language as SupportedLocale)
                      : DEFAULT_LOCALE) === locale
                  ) {
                    setOpen(false);
                    return;
                  }
                  run(() => changeLanguage(locale));
                }}
              >
                {locale === "vi" ? t("search.commands.languageVi") : t("search.commands.languageEn")}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
