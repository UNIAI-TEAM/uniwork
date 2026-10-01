import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import type { DesktopLibraryDocument } from "../../shared/ipc";
import { canDownloadDocument, type LibraryMode } from "./model";

export interface LibraryViewProps {
  mode: LibraryMode;
  documents: readonly DesktopLibraryDocument[];
  engineAvailable: boolean;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  searchQuery?: string;
  onModeChange?: (mode: LibraryMode) => void;
  onSearch?: (query: string) => void;
  onOpen?: (document: DesktopLibraryDocument) => void;
  onDownload?: (document: DesktopLibraryDocument) => void;
  onCreate?: () => void;
  onOpenLocal?: () => void;
}

const MODES: readonly LibraryMode[] = ["list", "recent", "search"];

/** The library screen: shared primitives drive list/recent/search and the
 * per-document actions a workspace member may take from the desktop host. */
export function LibraryView({
  mode,
  documents,
  engineAvailable,
  loading = false,
  error = false,
  onRetry,
  searchQuery = "",
  onModeChange,
  onSearch,
  onOpen,
  onDownload,
  onCreate,
  onOpenLocal,
}: LibraryViewProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [draftQuery, setDraftQuery] = useState(searchQuery);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6" data-desktop-library="true">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-title font-semibold text-foreground">{t("title")}</h1><div className="flex flex-wrap gap-2"><Button type="button" onClick={onCreate}>{t("create")}</Button><Button type="button" variant="outline" onClick={onOpenLocal}>{t("openLocal")}</Button></div></div>
      <nav aria-label={t("title")} className="flex gap-1">
        {MODES.map((candidate) => (
          <Button
            key={candidate}
            type="button"
            variant={mode === candidate ? "default" : "ghost"}
            aria-current={mode === candidate ? "page" : undefined}
            onClick={() => onModeChange?.(candidate)}
          >
            {t(candidate)}
          </Button>
        ))}
      </nav>
      {mode === "search" ? (
        <form
          className="flex max-w-sm gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch?.(draftQuery);
          }}
        >
          <Input
            type="search"
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
          />
          <Button type="submit">{t("search")}</Button>
        </form>
      ) : null}
      {!engineAvailable ? (
        <p role="status" className="text-body text-muted-foreground">
          {t("engineDown")}
        </p>
      ) : null}
      {error ? (
        <div className="flex flex-col gap-3" role="alert">
          <p className="text-body text-muted-foreground">{t("error")}</p>
          <Button type="button" variant="outline" onClick={onRetry}>{t("retry")}</Button>
        </div>
      ) : loading ? (
        <Skeleton className="h-24 w-full" />
      ) : documents.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul aria-label={t("title")} className="flex flex-col gap-2">
          {documents.map((document) => (
            <li
              key={document.id}
              data-document-id={document.id}
              className={cn("flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3")}
            >
              <span className="min-w-0 truncate text-body text-foreground">{document.title}</span>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" onClick={() => onOpen?.(document)}>
                  {t("open")}
                </Button>
                {canDownloadDocument(document, engineAvailable) ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onDownload?.(document)}>
                    {t("download")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
