"use client";

import { Download, FileText, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import type { DocumentFileActions } from "./document-file-actions";
import { readonlyKeys } from "./document-readonly-copy";

/** "1,2 MB" in the reader's locale; a size is read, not parsed. */
export function formatFileSize(bytes: number, locale: string): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024) return `${safe.toLocaleString(locale)} B`;
  const units = ["KB", "MB", "GB"];
  let value = safe / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 truncate font-mono text-caption text-foreground" : "mt-0.5 truncate text-body text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

/** The facts of a file version: version, size, MIME type, checksum. */
export function DocumentFileFacts({ file, className }: { file: NonNullable<Document["file"]>; className: string }) {
  const { t, i18n } = useTranslation();
  return (
    <dl className={className}>
      <Fact label={t("documents.file.version")} value={String(file.version)} />
      <Fact label={t("documents.file.size")} value={formatFileSize(file.size_bytes, i18n.language)} />
      <Fact label={t("documents.file.mime")} value={file.mime_type} />
      <Fact label={t("documents.file.checksum")} value={file.checksum_sha256} mono />
    </dl>
  );
}

/**
 * The file card of a `kind=file` document: name, type and size, the two file
 * commands (download, new version) and the facts. Shown when no viewer or
 * editor opens the file, and by a viewer that cannot decode it.
 */
export function DocumentFileCard({
  file,
  actions,
  readonly,
  canComment,
  permissionNoticeShown,
}: {
  file: NonNullable<Document["file"]>;
  actions: DocumentFileActions;
  readonly: boolean;
  canComment: boolean;
  /** The page already states the permission reason; the card does not repeat it. */
  permissionNoticeShown?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { download, downloading } = actions;
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileText aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-body font-medium text-foreground">{file.filename}</p>
            <p className="text-caption text-muted-foreground">
              {file.mime_type} · {formatFileSize(file.size_bytes, i18n.language)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={downloading !== null}
            aria-busy={downloading === "live" || undefined}
            onClick={() => void download()}
          >
            <Download aria-hidden className="size-3.5" />
            {t("documents.file.download")}
          </Button>
          {!readonly ? (
            <Button type="button" size="sm" onClick={actions.openUpload}>
              <Upload aria-hidden className="size-3.5" />
              {t("documents.file.new_version")}
            </Button>
          ) : null}
        </div>
      </div>
      <DocumentFileFacts file={file} className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4" />
      {/* The permission reason, kept apart from the format/editor reason below. */}
      {readonly && !permissionNoticeShown ? (
        <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground" data-testid="document-file-readonly">
          {t(readonlyKeys(canComment).fileHint)}
        </p>
      ) : null}
    </div>
  );
}
