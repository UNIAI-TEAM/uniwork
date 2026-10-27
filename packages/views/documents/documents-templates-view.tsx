"use client";

import { useRef, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryRowHandlers } from "./documents-library-row";
import { rowFormat, type RowGroup } from "./library-rows";
import type { useDocumentsLibrary } from "./use-documents-library";
import { useTemplateUpload } from "./use-template-upload";

type TemplateGroup = "word" | "excel" | "powerpoint" | "other";

/** The order the groups are drawn in; a format with no template draws no group. */
const GROUP_ORDER: readonly TemplateGroup[] = ["word", "excel", "powerpoint", "other"];

function groupOfFormat(format: string): TemplateGroup {
  switch (format) {
    case "docx":
      return "word";
    case "xlsx":
      return "excel";
    case "pptx":
      return "powerpoint";
    default:
      return "other";
  }
}

export interface DocumentsTemplatesViewProps {
  library: ReturnType<typeof useDocumentsLibrary>;
  handlers: LibraryRowHandlers;
  /** The viewer may add documents here: the upload button shows only then. */
  canUpload: boolean;
  wsId: string;
}

/**
 * Mẫu văn bản: the workspace's templates under the shared screen head, grouped
 * by format (Word, Excel, PowerPoint, Khác) in the shared list. The upload
 * creates the file straight into the section, visible to the whole workspace
 * and marked as a template, with no folder: it never goes through My Folder
 * and never through a chunked session, so a file above the chunked threshold
 * is refused here and goes through a folder instead.
 */
export function DocumentsTemplatesView({ library, handlers, canUpload, wsId }: DocumentsTemplatesViewProps) {
  const { t } = useTranslation();
  const state = library.state;
  const { upload, pending, accept } = useTemplateUpload(wsId, canUpload);
  const inputRef = useRef<HTMLInputElement>(null);

  const buckets = new Map<TemplateGroup, RowGroup["rows"]>();
  for (const row of state.rows) {
    const group = groupOfFormat(rowFormat(row));
    buckets.set(group, [...(buckets.get(group) ?? []), row]);
  }
  const groups: RowGroup[] = GROUP_ORDER.flatMap((key) => {
    const rows = buckets.get(key);
    return rows ? [{ key, rows }] : [];
  });

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing the value lets the same file be picked again after a failure.
    event.target.value = "";
    if (file && !pending) void upload(file);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
      {canUpload ? (
        <div className="flex justify-end">
          <input ref={inputRef} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) inputRef.current?.click();
            }}
          >
            {pending ? <Spinner aria-hidden role="presentation" /> : <Upload aria-hidden className="size-3.5" />}
            {t("documents.templates.upload")}
          </Button>
        </div>
      ) : null}
      <DocumentsLibraryList
        groups={groups}
        loading={state.loading}
        failure={state.failure}
        groupLabel={(key) => t(`documents.templates.group.${key}`)}
        screen="workspace"
        sort={library.sortControl}
        hasMore={state.hasMore}
        loadingMore={state.loadingMore}
        onLoadMore={state.loadMore}
        onRetry={state.refetch}
        onClearFilters={library.clearFilters}
        handlers={handlers}
        empty={{ title: t("documents.home.empty.templates_title"), description: t("documents.home.empty.templates_description") }}
      />
    </div>
  );
}
