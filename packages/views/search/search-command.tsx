"use client";

import { RotateCcwClock, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentList, useRecentDocuments } from "@uniwork/core/documents/hooks-collections";
import { useFlag } from "@uniwork/core/feature-flags";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
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
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { MODULE_ICONS } from "../layout/module-icons";
import { usePreferenceSavedToast } from "../layout/preference-toast";
import { DocumentTypeIcon, documentIconFormat } from "../documents/document-type-icon";
import { formatSearchPath } from "../documents/documents-search-results";

/** How many recent tasks the palette lists; the store keeps more. */
const RECENT_TASKS_SHOWN = 5;
/** How many recent documents / search hits the documents group shows. */
const RECENT_DOCUMENTS_SHOWN = 5;
const DOCUMENT_HITS_SHOWN = 8;
/** The documents group only queries after the typing stops (FE design §3.1). */
const SEARCH_DEBOUNCE_MS = 250;

export function SearchCommand({ onCreateTask }: { onCreateTask: () => void }) {
  const { open, setOpen } = useSearchStore();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const { setTheme } = useTheme();
  const localeAdapter = useLocaleAdapter();
  const { t, i18n } = useTranslation();
  const notifySaved = usePreferenceSavedToast();
  const recentTasks = useRecentTasks(workspace.id);
  const documentsEnabled = useFlag("documents", false);

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
  // The same reset when the workspace changes: a term typed for one workspace
  // must not query (or show a hit from) another one.
  const [queriedWorkspaceId, setQueriedWorkspaceId] = useState(workspace.id);
  if (workspace.id !== queriedWorkspaceId) {
    setQueriedWorkspaceId(workspace.id);
    setQuery("");
  }

  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);
  const searchActive = documentsEnabled && open && debouncedQuery.length > 0;
  const recentDocsActive = documentsEnabled && open && trimmedQuery.length === 0;

  // Documents need the workspace id in the key, so a switch cancels the old
  // request and the answer of workspace A can never render for workspace B.
  const documentSearch = useDocumentList(
    workspace.id,
    { q: debouncedQuery || undefined, limit: DOCUMENT_HITS_SHOWN },
    { enabled: searchActive },
  );
  const recentDocuments = useRecentDocuments(workspace.id, { enabled: recentDocsActive });

  const documentHits = searchActive
    ? (documentSearch.data?.pages.flatMap((page) => page.documents) ?? []).slice(0, DOCUMENT_HITS_SHOWN)
    : [];
  const recentlyOpened = recentDocsActive
    ? (recentDocuments.data?.pages.flatMap((page) => page.documents) ?? []).slice(
        0,
        RECENT_DOCUMENTS_SHOWN,
      )
    : [];
  const documentsGroup = [...documentHits, ...recentlyOpened];
  const showDocuments = documentsEnabled && documentsGroup.length > 0;

  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const showRecent = query.trim() === "" && recentTasks.length > 0;

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const changeLanguage = (next: SupportedLocale) => {
    localeAdapter.persist(next);
    document.documentElement.lang = next;
    // The toast text resolves after the language switched, in the new language.
    void setLocale(next).then(() => {
      notifySaved("language", next);
    });
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
                  <RotateCcwClock />
                  <span className="shrink-0 text-muted-foreground">{task.identifier}</span>
                  <span className="truncate">{task.title || t("tasks.detail.title_placeholder")}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {showDocuments ? (
            <CommandGroup heading={t("search.groups.documents")}>
              {documentsGroup.map((doc) => {
                const docTitle = doc.title || t("documents.detail.untitled");
                const format = documentIconFormat(doc.kind, docTitle);
                const { display: pathDisplay, full: pathFull } = formatSearchPath(doc.path);
                return (
                  <CommandItem
                    key={doc.id}
                    // The live term leads the value so cmdk keeps a hit visible
                    // while the user is still typing past the debounce.
                    value={`${trimmedQuery} ${doc.title} ${doc.id}`}
                    onSelect={() =>
                      run(() =>
                        push(doc.kind === "folder" ? ws.documentsFolder(doc.id) : ws.document(doc.id)),
                      )
                    }
                  >
                    <DocumentTypeIcon
                      format={format}
                      decorative
                      className={cn("size-4 shrink-0", doc.kind === "folder" && "text-muted-foreground")}
                    />
                    <span className="min-w-0 max-w-[70%] shrink-0 truncate">{docTitle}</span>
                    {pathFull ? (
                      <>
                        <span
                          aria-hidden
                          title={pathFull}
                          className="min-w-0 shrink truncate text-caption text-muted-foreground"
                        >
                          {pathDisplay}
                        </span>
                        <span className="sr-only">
                          {t("documents.home.search.path", { path: pathFull })}
                        </span>
                      </>
                    ) : null}
                    {doc.snippet ? (
                      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                        {doc.snippet}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          <CommandGroup heading={t("search.groups.pages")}>
            <CommandItem
              value={`${t("search.pages.tasks")} tasks cong viec`}
              onSelect={() => run(() => push(ws.tasks()))}
            >
              <MODULE_ICONS.tasks />
              {t("search.pages.tasks")}
            </CommandItem>
            <CommandItem
              value={`${t("search.pages.meetings")} meetings cuoc hop`}
              onSelect={() => run(() => push(ws.meetings()))}
            >
              <MODULE_ICONS.meetings />
              {t("search.pages.meetings")}
            </CommandItem>
            <CommandItem
              value={`${t("search.pages.settings")} settings cai dat`}
              onSelect={() => run(() => push(ws.settings()))}
            >
              <MODULE_ICONS.settings />
              {t("search.pages.settings")}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t("search.groups.commands")}>
            <CommandItem
              value={`${t("search.commands.createTask")} new task tao viec`}
              onSelect={() => run(onCreateTask)}
            >
              <MODULE_ICONS.tasks />
              {t("search.commands.createTask")}
            </CommandItem>
            <CommandItem
              value={`${t("search.commands.themeLight")} light`}
              onSelect={() =>
                run(() => {
                  setTheme("light");
                  notifySaved("theme");
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
                  notifySaved("theme");
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
                  notifySaved("theme");
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
