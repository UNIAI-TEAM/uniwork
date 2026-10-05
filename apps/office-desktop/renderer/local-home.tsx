import { forwardRef, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { DocumentTypeIcon } from "@uniwork/views/documents/document-type-icon";
import { CollectionPageHeader } from "@uniwork/views/layout/collection-page";
import { desktopDocumentFormatForName, type DesktopDocumentFormat } from "../shared/document-formats";
import type { RecentFile } from "../shared/ipc";
import { CreateDocumentMenu } from "./create-document-menu";

const HomeIcon: ComponentProps<typeof CollectionPageHeader>["icon"] = forwardRef((props, ref) => (
  <svg ref={ref} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></svg>
));
HomeIcon.displayName = "LocalHomeIcon";

export interface LocalHomeViewProps {
  files: readonly RecentFile[] | null;
  error?: boolean;
  busy?: boolean;
  onOpen: () => void;
  onCreate: (format: DesktopDocumentFormat) => void;
  onOpenRecent: (id: string) => void;
  onRemoveRecent: (id: string) => void;
  onRetry: () => void;
}

/** The signed-out home: recent files opened on this device, with open/create
 * as the only two primary actions. No cloud data is reachable from here. */
export function LocalHomeView({ files, error = false, busy = false, onOpen, onCreate, onOpenRecent, onRemoveRecent, onRetry }: LocalHomeViewProps) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "officeDesktop.local" });
  const rows: readonly RecentFile[] = files ?? [];
  const loading = files === null && !error;
  const actions = <div className="flex flex-wrap justify-center gap-2"><Button type="button" onClick={onOpen} disabled={busy}>{t("open")}</Button><CreateDocumentMenu label={t("create")} disabled={busy} onCreate={onCreate} /></div>;
  const time = (value: number) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-local-home="true">
      <CollectionPageHeader icon={HomeIcon} title={t("title")} count={loading || error ? undefined : rows.length} countLabel={t("count", { count: rows.length })} actions={rows.length > 0 || loading || error ? actions : undefined} className="flex-wrap" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6">
        {error ? (
          <div className="flex flex-col gap-3" role="alert">
            <p className="text-body text-muted-foreground">{t("error")}</p>
            <Button type="button" variant="outline" onClick={onRetry}>{t("retry")}</Button>
          </div>
        ) : loading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center" role="status">
            <DocumentTypeIcon format="file" className="size-12 text-muted-foreground" />
            <h2 className="text-title font-semibold">{t("empty")}</h2>
            <p className="max-w-sm text-body text-muted-foreground">{t("emptyDescription")}</p>
            {actions}
          </div>
        ) : (
          <ul aria-label={t("title")} className="flex flex-col gap-2">
            {rows.map((file) => (
              <li key={file.id} data-recent-file={file.id} data-missing={file.missing} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
                <button type="button" className={`flex min-w-0 flex-1 items-center gap-3 rounded-control p-2 text-left enabled:hover:bg-muted ${file.missing ? "opacity-60" : ""}`} aria-label={t("openNamed", { name: file.name })} disabled={file.missing || busy} onClick={() => onOpenRecent(file.id)}>
                  <DocumentTypeIcon format={desktopDocumentFormatForName(file.name) ?? "file"} className="size-8 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-foreground">{file.name}</span>
                    <span className="mt-1 block truncate text-caption text-muted-foreground">{file.directory ? `${file.directory} · ` : ""}{t("updated", { time: time(file.updatedAt) })}</span>
                  </span>
                </button>
                {file.missing ? <span className="shrink-0 text-caption text-muted-foreground">{t("missing")}</span> : null}
                <Button type="button" size="sm" variant="outline" aria-label={t("removeNamed", { name: file.name })} onClick={() => onRemoveRecent(file.id)}>{t("remove")}</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
