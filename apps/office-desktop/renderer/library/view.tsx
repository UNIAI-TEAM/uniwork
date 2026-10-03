import { forwardRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { DocumentTypeIcon } from "@uniwork/views/documents/document-type-icon";
import { CollectionPageHeader } from "@uniwork/views/layout/collection-page";
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

const LibraryIcon: ComponentProps<typeof CollectionPageHeader>["icon"] = forwardRef((props, ref) => <svg ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 4h4v16H4zM11 4h3v16h-3zM17 4l3-1 4 16-3 1z" /></svg>);
LibraryIcon.displayName = "LibraryIcon";

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
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [draftQuery, setDraftQuery] = useState(searchQuery);
  const searching = mode === "search" && searchQuery.trim() !== "";
  const actions = <div className="flex flex-wrap justify-center gap-2"><Button type="button" onClick={onCreate}>{t("create")}</Button><Button type="button" variant="outline" onClick={onOpenLocal}>{t("openLocal")}</Button></div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-desktop-library="true">
      <CollectionPageHeader icon={LibraryIcon} title={t("title")} count={loading || error ? undefined : documents.length} countLabel={t("officeDesktop.tabs.documentCount", { keyPrefix: "", count: documents.length })} actions={documents.length > 0 || loading || error ? actions : undefined} className="flex-wrap" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6">
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
      {error ? (
        <div className="flex flex-col gap-3" role="alert">
          <p className="text-body text-muted-foreground">{t("error")}</p>
          <Button type="button" variant="outline" onClick={onRetry}>{t("retry")}</Button>
        </div>
      ) : loading ? (
        <Skeleton className="h-24 w-full" />
      ) : documents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center" role="status">
          <DocumentTypeIcon format="file" className="size-12 text-muted-foreground" />
          <h2 className="text-title font-semibold">{t(searching ? "emptySearch" : "empty")}</h2>
          <p className="max-w-sm text-body text-muted-foreground">{t(searching ? "emptySearchDescription" : "emptyDescription")}</p>
          {actions}
        </div>
      ) : (
        <ul aria-label={t("title")} className="flex flex-col gap-2">
          {documents.map((document) => (
            <li
              key={document.id}
              data-document-id={document.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-control p-2 text-left hover:bg-muted" aria-label={t("open")} onClick={() => onOpen?.(document)}>
                <DocumentTypeIcon format={document.format} className="size-8 shrink-0 text-primary" />
                <span className="min-w-0 flex-1"><span className="block truncate text-body text-foreground">{document.title}</span><span className="mt-1 block text-caption text-muted-foreground">{document.ownerName || t("ownerUnknown")} · {t("updated", { time: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(document.updatedAt)) })}</span></span>
              </button>
              <div className="flex shrink-0 gap-2">
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
    </div>
  );
}
