"use client";

import { Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { modeContext, type FolderUploadMode } from "./folder-upload-copy";

/** Rows shown before "+ N tệp khác" folds the rest. */
const COLLAPSED_ROWS = 3;

interface Row {
  /** The path under the picked root: the root is already in the dialog's own lines. */
  path: string;
  name: string;
  folder: string;
}

function rowsOf(paths: readonly string[], mode: FolderUploadMode): Row[] {
  return paths.map((full) => {
    const parts = full.split("/");
    const under = mode === "folder" ? parts.slice(1) : parts;
    return { path: under.join("/"), name: under[under.length - 1] ?? full, folder: under.slice(0, -1).join("/") };
  });
}

/**
 * The files the browser cannot read (UNI-2152): one row each, the name in full
 * (its end, `_0001.pdf`, is what tells two files apart) over the folder path.
 * A row unclamps on focus; the full path is its `title`.
 */
export function FolderUploadUnreadableList({
  paths,
  mode,
  showAll,
  onToggle,
  listId,
}: {
  paths: readonly string[];
  mode: FolderUploadMode;
  showAll: boolean;
  onToggle: () => void;
  listId: string;
}) {
  const { t } = useTranslation();
  const rows = rowsOf(paths, mode);
  const folded = rows.length > COLLAPSED_ROWS;
  const shown = folded && !showAll ? rows.slice(0, COLLAPSED_ROWS) : rows;
  return (
    <section aria-label={t("documents.folder_upload.unreadable.list_label")} className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-caption font-medium text-foreground">
        {t("documents.folder_upload.unreadable.affected", { count: rows.length })}
      </h3>
      <ul id={listId} className="flex max-h-52 min-w-0 flex-col overflow-y-auto rounded-md border border-border">
        {shown.map((row) => (
          <li
            key={row.path}
            // Focusable so a keyboard user can unclamp the name and read the whole path.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the row's focus is its way to the full name and path
            tabIndex={0}
            title={row.path}
            className="group flex min-w-0 items-start gap-2 border-b border-border px-2.5 py-2 last:border-b-0"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <div className="flex min-w-0 flex-col">
              <span className="line-clamp-2 break-words text-body font-medium text-foreground group-focus-visible:line-clamp-none">
                {row.name}
              </span>
              {row.folder ? (
                <span className="truncate text-caption text-muted-foreground group-focus-visible:whitespace-normal group-focus-visible:break-words">
                  {row.folder}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {folded ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-start"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={onToggle}
        >
          {showAll
            ? t("documents.folder_upload.unreadable.less")
            : t("documents.folder_upload.unreadable.more", { count: rows.length - COLLAPSED_ROWS })}
        </Button>
      ) : null}
    </section>
  );
}

/** What to do about it: open the app, or, with no app on this device, upload from a shorter path. */
export function FolderUploadUnreadableSuggestion({ mode, appAvailable }: { mode: FolderUploadMode; appAvailable: boolean }) {
  const { t } = useTranslation();
  const ctx = modeContext(mode);
  return (
    <Alert variant="muted" role="note">
      <Info aria-hidden />
      <AlertDescription>
        {appAvailable ? (
          <>
            {t("documents.folder_upload.unreadable.suggest_lead", ctx)} {t("documents.folder_upload.unreadable.suggest_steps", ctx)}
          </>
        ) : (
          t("documents.folder_upload.unreadable.suggest_no_app", ctx)
        )}
      </AlertDescription>
    </Alert>
  );
}
