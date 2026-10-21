"use client";

import { useState } from "react";
import { ChevronDown, Download, Folder, FolderRoot, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentTree } from "@uniwork/core/documents/hooks-collections";
import type { AccessReportFilters } from "@uniwork/core/types/document-access-report";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@uniwork/ui/components/ui/breadcrumb";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AppLink } from "../../navigation";
import { formatWhen } from "../document-format";
import { FolderPickerDialog } from "../folder-picker-dialog";
import { useAccessReportExport } from "./use-access-report-export";

export interface AccessReportHeaderProps {
  wsId: string;
  workspaceName: string;
  workspaceSlug: string;
  /** The Documents library: the breadcrumb's first crumb. */
  libraryHref: string;
  /** The folder the report is for; `undefined` = the whole workspace. */
  folderId: string | undefined;
  /** `scope.folder_title` of the first page; `null` until it has arrived. */
  folderTitle: string | null;
  /** The filters the export runs with; the folder comes from `folderId`. */
  filters: AccessReportFilters;
  /** `generated_at` of the page in view. */
  generatedAt: string | null | undefined;
  /** The reader picked a scope: a folder id, or `undefined` for the whole workspace. */
  onFolderChange: (folderId: string | undefined) => void;
  onRefresh: () => void;
  /** A refetch is under way: the button stays, `aria-disabled`. */
  refreshing?: boolean;
  /** Id of a note about an empty file, shown by the screen beside the export button. */
  exportDescribedBy?: string;
}

/**
 * The top of `/documents/access-report`: breadcrumb and title, the scope
 * picker, when the report was made, Refresh, and one Export menu. It reads no
 * report itself; the screen hands it the page's facts and the callbacks.
 */
export function AccessReportHeader({
  wsId,
  workspaceName,
  workspaceSlug,
  libraryHref,
  folderId,
  folderTitle,
  filters,
  generatedAt,
  onFolderChange,
  onRefresh,
  refreshing = false,
  exportDescribedBy,
}: AccessReportHeaderProps) {
  const { t, i18n } = useTranslation();
  const exporter = useAccessReportExport(wsId, workspaceSlug, { folderId, ...filters });
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The folder tree is read when the picker opens, not on every visit to the report.
  const tree = useDocumentTree(wsId, undefined, { enabled: picking, foldersOnly: true });

  // Until the folder's title arrives the scope reads neutrally, never as an empty path.
  const scopeLabel = folderId
    ? folderTitle
      ? t("documents.accessReport.scope_folder", { path: folderTitle })
      : t("documents.accessReport.scope_label")
    : t("documents.accessReport.scope_workspace", { name: workspaceName });
  const updated = formatWhen(generatedAt, i18n.language);
  const exporting = exporter.busy !== null;

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Breadcrumb>
          <BreadcrumbList className="text-caption">
            <BreadcrumbItem>
              <BreadcrumbLink render={<AppLink href={libraryHref} />}>{t("documents.page.title")}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t("documents.accessReport.title")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="text-title font-semibold">{t("documents.accessReport.title")}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="max-w-full gap-1.5"
            aria-haspopup="dialog"
            title={t("documents.accessReport.scope_label")}
            onClick={() => setPicking(true)}
          >
            {folderId ? <Folder aria-hidden /> : <FolderRoot aria-hidden />}
            <span className="min-w-0 truncate">{scopeLabel}</span>
            <ChevronDown aria-hidden />
          </Button>
          {updated ? (
            <>
              <span aria-hidden>·</span>
              <span>{t("documents.accessReport.updated_at", { time: updated })}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          aria-disabled={refreshing || undefined}
          aria-busy={refreshing || undefined}
          onClick={() => {
            if (!refreshing) onRefresh();
          }}
        >
          {refreshing ? <Spinner aria-hidden role="presentation" /> : <RefreshCw aria-hidden />}
          {t("documents.accessReport.refresh")}
        </Button>
        <DropdownMenu
          open={menuOpen}
          // A file in the making keeps the menu shut: one export at a time.
          onOpenChange={(next) => setMenuOpen(next && !exporting)}
        >
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                aria-disabled={exporting || undefined}
                aria-busy={exporting || undefined}
                aria-describedby={exportDescribedBy}
              />
            }
          >
            {exporting ? <Spinner aria-hidden role="presentation" /> : <Download aria-hidden />}
            {exporting ? t("documents.accessReport.exporting") : t("documents.accessReport.export")}
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exporter.run("csv")}>{t("documents.accessReport.export_csv")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exporter.run("xlsx")}>{t("documents.accessReport.export_xlsx")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <FolderPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t("documents.accessReport.scope_label")}
        description={t("documents.accessReport.scope_pick_folder")}
        submitLabel={t("common.done")}
        pickerLabel={t("documents.accessReport.scope_label")}
        rootLabel={t("documents.accessReport.scope_workspace", { name: workspaceName })}
        tree={tree.data?.documents ?? []}
        initialFolderId={folderId ?? null}
        pending={false}
        error={tree.isError ? t("documents.tree.error_title") : null}
        onSubmit={(target) => {
          setPicking(false);
          onFolderChange(target ?? undefined);
        }}
      />
    </header>
  );
}
