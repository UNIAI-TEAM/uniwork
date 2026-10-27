"use client";

import { useRef, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { chunkedUploadThreshold } from "@uniwork/core/documents/chunked-upload";
import { useCreateDocumentFile, useDocumentLimits } from "@uniwork/core/documents/hooks";
import { DOCUMENT_UPLOAD_ACCEPT, formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";
import { DocumentsLibraryList } from "./documents-library-list";
import type { LibraryRowHandlers } from "./documents-library-row";
import { rowFormat, type RowGroup } from "./library-rows";
import type { useDocumentsLibrary } from "./use-documents-library";

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
  const { t, i18n } = useTranslation();
  const state = library.state;
  const limits = useDocumentLimits({ enabled: canUpload });
  const create = useCreateDocumentFile(wsId);
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

  const upload = async (file: File) => {
    const threshold = chunkedUploadThreshold(limits);
    if (threshold !== null && file.size > threshold) {
      toast.error(t("documents.templates.too_large", { size: formatDocumentSizeMB(threshold, i18n.language) }));
      return;
    }
    const invalid = documentUploadValidationMessage(file, limits.upload_max_bytes, t, i18n.language);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    try {
      const doc = await create.mutateAsync({ file, meta: { visibility: "workspace", template: true } });
      toast.success(t("documents.templates.uploaded", { title: doc.title }));
    } catch (error) {
      toast.error(
        documentErrorMessage(error, t, "documents.templates.upload_failed", {
          locale: i18n.language,
          file,
          maxBytes: limits.upload_max_bytes,
        }),
      );
    }
  };
  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing the value lets the same file be picked again after a failure.
    event.target.value = "";
    if (file && !create.isPending) void upload(file);
  };
  const accept = limits.upload_extensions?.length
    ? limits.upload_extensions.map((extension) => `.${extension}`).join(",")
    : DOCUMENT_UPLOAD_ACCEPT;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
      {canUpload ? (
        <div className="flex justify-end">
          <input ref={inputRef} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={create.isPending || undefined}
            onClick={() => {
              if (!create.isPending) inputRef.current?.click();
            }}
          >
            {create.isPending ? <Spinner aria-hidden role="presentation" /> : <Upload aria-hidden className="size-3.5" />}
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
