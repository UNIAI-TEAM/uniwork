"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Download, FileText, RotateCcwClock, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentVersions } from "@uniwork/core/documents/hooks-versions";
import type { Document, DocumentVersion } from "@uniwork/core/types/document";
import { useOfficeEnabled, type OfficeEnabledState } from "@uniwork/core/documents/office-enabled";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Notice } from "../common/notice";
import { useOfficeFormatName } from "../office/editor-slot";
import { HeaderActionsFill } from "../layout/header-actions-slot";
import { leaveGuardAllows } from "../navigation";
import { DocumentFileMenuItems, useDocumentFileActions } from "./document-file-actions";
import { DocumentSaveIndicator } from "./document-save-indicator";

export interface DocumentFileViewProps {
  wsId: string;
  doc: Document;
  readonly: boolean;
  /** Platform-only Office host injected by the web app. Views never import
   * Next.js or a browser engine directly. */
  officeEditorHost?: ComponentType<{ wsId: string; document: Document; readonly: boolean }>;
  /** The page's own gate (`useDocumentOfficeGate`), so the page layout and this
   * view decide "editor mounted" from one state. Without it the view keeps its own. */
  officeGate?: DocumentOfficeGate;
  /** The page already states the permission reason; the card does not repeat it. */
  permissionNoticeShown?: boolean;
}

/** The version reason is a schema identifier; only its label is translated. */
const REASON_KEY: Record<string, string> = {
  upload: "reason_upload",
  manual: "reason_manual",
  auto: "reason_auto",
  restore: "reason_restore",
  agent: "reason_agent",
};

function reasonLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  version: DocumentVersion,
): string {
  const key = REASON_KEY[version.reason];
  return key ? t(`documents.file.${key}`) : t("documents.file.unknown_reason");
}

/** "1,2 MB" in the reader's locale; a size is read, not parsed. */
function formatFileSize(bytes: number, locale: string): string {
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

/**
 * `kind=file`: what the document actually is, its versions, and the only two
 * actions the H1 API supports — download the bytes and stage a new version
 * (POST uploads + POST versions/commit, C-01 §14.4).
 *
 * There is deliberately no Office "Edit" button: opening an Office format
 * needs the engine consumer and a checked capability (G3), and a button that
 * cannot open anything is worse than saying the format is not editable here
 * yet.
 */
function officeFormat(doc: Document): string | null {
  const filename = doc.file?.filename.toLowerCase() ?? "";
  const mime = doc.file?.mime_type.toLowerCase() ?? "";
  if (mime.includes("wordprocessingml.document") || filename.endsWith(".docx")) return "docx";
  if (mime.includes("spreadsheetml.sheet") || filename.endsWith(".xlsx")) return "xlsx";
  if (mime.includes("presentationml.presentation") || filename.endsWith(".pptx")) return "pptx";
  if (mime === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (mime === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) return "md";
  if (mime === "text/html" || filename.endsWith(".html") || filename.endsWith(".htm")) return "html";
  return null;
}

/**
 * F7: a mounted editor closes only on a settled "off" answer, never while the
 * answer is loading, refetching or failed. Closing runs the registered leave
 * guards first, so a dirty editor offers Save / keep draft / discard; when the
 * reader cancels, the editor stays until they leave the page.
 */
function useLiveEditorGate(state: OfficeEnabledState, answeredAt: number): boolean {
  const [open, setOpen] = useState(state === "on");
  useEffect(() => {
    if (state === "on") { setOpen(true); return undefined; }
    if (state !== "off" || !open) return undefined;
    let active = true;
    void leaveGuardAllows("office:feature-off").then((allowed) => { if (active && allowed) setOpen(false); });
    return () => { active = false; };
  // `answeredAt` re-asks after a refused close when the next answer is off again.
  }, [state, open, answeredAt]);
  return open;
}

/** True when the file opens in the Office editor instead of the file card. */
export function usesOfficeEditor(doc: Document, officeEnabled: boolean, hasHost: boolean): boolean {
  return officeEnabled && hasHost && Boolean(doc.file) && officeFormat(doc) !== null;
}

export type DocumentOfficeGate = { office: ReturnType<typeof useOfficeEnabled>; editorOpen: boolean };

/**
 * The Office editor is allowed for this document (`office_engine` and the
 * format's own flag, answered for the document's organization) and, once
 * mounted, stays mounted until a settled "off" passes the leave guards (F7).
 * The page and the file view must read the same instance (review-fe-r1 R3).
 */
export function useDocumentOfficeGate(doc: Document): DocumentOfficeGate {
  const format = officeFormat(doc);
  const office = useOfficeEnabled(doc.organization_id, format);
  // A page or a non-Office file never mounts the editor, so it never runs the leave guards either.
  const editorOpen = useLiveEditorGate(format !== null && doc.file ? office.state : "off", office.answeredAt);
  return { office, editorOpen };
}

export function DocumentFileView(props: DocumentFileViewProps) {
  return props.officeGate ? <DocumentFileBody {...props} gate={props.officeGate} /> : <SelfGatedDocumentFileView {...props} />;
}

function SelfGatedDocumentFileView(props: DocumentFileViewProps) {
  const gate = useDocumentOfficeGate(props.doc);
  return <DocumentFileBody {...props} gate={gate} />;
}

function DocumentFileBody({ wsId, doc, readonly, officeEditorHost: OfficeEditorHost, permissionNoticeShown, gate }: DocumentFileViewProps & { gate: DocumentOfficeGate }) {
  const { t, i18n } = useTranslation();
  const file = doc.file;
  const versions = useDocumentVersions(wsId, doc.id);
  const actions = useDocumentFileActions(wsId, doc);
  const { download, downloading } = actions;
  const officeFormatId = officeFormat(doc);
  const { office, editorOpen } = gate;
  const formatName = useOfficeFormatName();

  if (!file) {
    return (
      <Notice tone="warning" icon={FileText} layout="inline">
        {t("documents.file.missing_file")}
      </Notice>
    );
  }

  if (usesOfficeEditor(doc, editorOpen, Boolean(OfficeEditorHost)) && OfficeEditorHost) {
    // The editor replaces this view, so its file commands move to the page
    // overflow menu (version history is already one of its entries).
    return (
      <>
        <HeaderActionsFill menuItems={<DocumentFileMenuItems actions={actions} readonly={readonly} />} />
        <OfficeEditorHost wsId={wsId} document={doc} readonly={readonly} />
        {actions.uploadDialog}
      </>
    );
  }

  const rows = versions.data?.pages.flatMap((page) => page.versions) ?? [];
  // A host is mounted and the format is an Office one, so the card stands in for
  // the editor and says why: checking, could not check, or turned off.
  const officeCardState = Boolean(OfficeEditorHost) && officeFormatId !== null ? office.state : null;
  const format = formatName(officeFormatId ?? "");

  return (
    <div className="flex flex-col gap-4">
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
        <dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
          <Fact label={t("documents.file.version")} value={String(file.version)} />
          <Fact label={t("documents.file.size")} value={formatFileSize(file.size_bytes, i18n.language)} />
          <Fact label={t("documents.file.mime")} value={file.mime_type} />
          <Fact label={t("documents.file.checksum")} value={file.checksum_sha256} mono />
        </dl>
        {/* The permission reason, kept apart from the format/editor reason below. */}
        {readonly && !permissionNoticeShown ? (
          <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground" data-testid="document-file-readonly">
            {t("documents.file.readonly_hint")}
          </p>
        ) : null}
      </div>

      {officeCardState === "off" ? (
        <Notice tone="info" icon={FileText} layout="inline">
          <span className="font-medium text-foreground">{t("documents.file.office_off_title", { format })}</span>{" "}
          {t("documents.file.office_off_description", { format })}
        </Notice>
      ) : officeCardState === "unknown" ? (
        <Notice
          tone="warning"
          icon={FileText}
          layout="inline"
          action={<Button type="button" variant="outline" size="sm" onClick={office.retry}>{t("documents.file.office_unknown_retry")}</Button>}
        >
          <span className="font-medium text-foreground">{t("documents.file.office_unknown_title", { format })}</span>{" "}
          {t("documents.file.office_unknown_description")}
        </Notice>
      ) : officeCardState !== null ? (
        // Loading (or an "on" answer whose editor mounts on the next render): no cause is claimed yet.
        <Notice tone="muted" icon={FileText} layout="inline">
          {t("documents.file.office_checking", { format })}
        </Notice>
      ) : (
        <Notice tone="info" icon={FileText} layout="inline">
          <span className="font-medium text-foreground">{t("documents.file.no_web_editor_title")}</span>{" "}
          {t("documents.file.no_web_editor_description")}
        </Notice>
      )}

      <section aria-labelledby="document-versions-heading" className="rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <RotateCcwClock aria-hidden className="size-4 text-muted-foreground" />
          <h2 id="document-versions-heading" className="text-title-sm font-medium text-foreground">
            {t("documents.file.history_title")}
          </h2>
        </div>
        {versions.isPending ? (
          <div className="space-y-2 px-4 py-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : versions.isError ? (
          <p role="alert" className="px-4 py-3 text-caption text-destructive">
            {t("documents.file.history_error")}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-3 text-caption text-muted-foreground">
            {t("documents.file.history_empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body text-foreground">
                    {t("documents.file.version_row", { no: version.version })}
                    {version.label ? <span className="text-muted-foreground"> · {version.label}</span> : null}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {reasonLabel(t, version)}
                    {version.size_bytes > 0
                      ? ` · ${formatFileSize(version.size_bytes, i18n.language)}`
                      : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("documents.file.download_version", { no: version.version })}
                  disabled={downloading !== null}
                  onClick={() => void download(version.version)}
                >
                  <Download aria-hidden className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center gap-2">
        <DocumentSaveIndicator readonly={readonly} />
      </div>

      {actions.uploadDialog}
    </div>
  );
}
