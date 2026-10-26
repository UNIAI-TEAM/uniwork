"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Download, Eye, FileText, MonitorUp, RotateCcwClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentVersions } from "@uniwork/core/documents/hooks-versions";
import type { Document, DocumentVersion } from "@uniwork/core/types/document";
import { useOfficeEnabled, type OfficeEnabledState } from "@uniwork/core/documents/office-enabled";
import { isLegacyOfficeFormat } from "@uniwork/core/office/office-modules";
import { parseVersionParam } from "@uniwork/core/office/version-view";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Notice } from "../common/notice";
import { LegacyFormatDialog, type LegacyFormatDesktopOpenProps } from "../office/legacy-format-dialog";
import { useOfficeFormatName } from "../office/format-name";
import { HeaderActionsFill } from "../layout/header-actions-slot";
import { leaveGuardAllows, useOptionalNavigation } from "../navigation";
import { DocumentFileMenuItems, useDocumentFileActions } from "./document-file-actions";
import { DocumentFileCard, formatFileSize } from "./document-file-card";
import { DocumentMediaViewer } from "./document-media-viewer";
import { isImageDocument } from "./document-media-kind";
import { readonlyReaderCanComment } from "./document-readonly-copy";
import { DocumentSaveIndicator } from "./document-save-indicator";

export interface DocumentFileViewProps {
  wsId: string;
  doc: Document;
  readonly: boolean;
  /** Platform-only Office host injected by the web app. Views never import
   * Next.js or a browser engine directly. `officeFormat` is the gate's
   * resolved format: a host that takes it never re-reads the flag behind the
   * leave guards' back. */
  officeEditorHost?: ComponentType<{ wsId: string; document: Document; readonly: boolean; officeFormat?: string | null }>;
  /** The page's own gate (`useDocumentOfficeGate`), so the page layout and this
   * view decide "editor mounted" from one state. Without it the view keeps its own. */
  officeGate?: DocumentOfficeGate;
  /** The page already states the permission reason; the card does not repeat it. */
  permissionNoticeShown?: boolean;
  /** Host wiring for "Mở bằng UniWork Office" in the legacy-format modal. */
  desktopOpen?: LegacyFormatDesktopOpenProps;
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

/**
 * `kind=file`: what the document actually is, its versions, and the only two
 * actions the H1 API supports — download the bytes and stage a new version
 * (POST uploads + POST versions/commit, C-01 §14.4).
 *
 * There is deliberately no Office "Edit" button: opening an Office format
 * needs the engine consumer and a checked capability, and a button that
 * cannot open anything is worse than saying the format is not editable here
 * yet.
 */
function officeFormat(doc: Document): string | null {
  if (isLegacyOfficeFormat(doc.file)) return null;
  const filename = doc.file?.filename.toLowerCase() ?? "";
  const mime = doc.file?.mime_type.toLowerCase() ?? "";
  if (mime.includes("wordprocessingml.document") || filename.endsWith(".docx")) return "docx";
  if (mime.includes("spreadsheetml.sheet") || filename.endsWith(".xlsx")) return "xlsx";
  if (mime.includes("presentationml.presentation") || filename.endsWith(".pptx")) return "pptx";
  if (mime === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (mime === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) return "md";
  // A .txt opens as Markdown (plain mode in the frame) like a .md. By extension
  // only: a bare text/plain file (notes.csv, app.log, no extension) never maps.
  if (filename.endsWith(".txt")) return "md";
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
export function usesOfficeEditor(editorOpen: boolean, hasHost: boolean, format: string | null): boolean {
  return editorOpen && hasHost && format !== null;
}

export type DocumentOfficeGate = {
  office: ReturnType<typeof useOfficeEnabled>;
  editorOpen: boolean;
  /** The format the editor mounts for; null for a file no Office module opens. */
  format: string | null;
};

/**
 * The Office editor is allowed for this document (`office_engine` and the
 * format's own flag, answered for the document's organization) and, once
 * mounted, stays mounted until a settled "off" passes the leave guards (F7).
 * The page and the file view must read the same instance (review-fe-r1 R3).
 */
export function useDocumentOfficeGate(doc: Document): DocumentOfficeGate {
  const format = officeFormat(doc);
  const office = useOfficeEnabled(doc.organization_id, format);
  const editorOpen = useLiveEditorGate(!doc.file || format === null ? "off" : office.state, office.answeredAt);
  return { office, editorOpen, format };
}

export function DocumentFileView(props: DocumentFileViewProps) {
  return props.officeGate ? <DocumentFileBody {...props} gate={props.officeGate} /> : <SelfGatedDocumentFileView {...props} />;
}

function SelfGatedDocumentFileView(props: DocumentFileViewProps) {
  const gate = useDocumentOfficeGate(props.doc);
  return <DocumentFileBody {...props} gate={gate} />;
}

function DocumentFileBody({ wsId, doc, readonly, officeEditorHost: OfficeEditorHost, permissionNoticeShown, desktopOpen, gate }: DocumentFileViewProps & { gate: DocumentOfficeGate }) {
  const { t, i18n } = useTranslation();
  const nav = useOptionalNavigation();
  const urlVersion = parseVersionParam(nav?.searchParams.get("version"));
  const file = doc.file;
  const isLegacy = isLegacyOfficeFormat(file);
  const [legacyModal, setLegacyModal] = useState<{ open: boolean; version?: number }>(() => ({
    open: isLegacy,
    version: urlVersion ?? undefined,
  }));
  useEffect(() => {
    if (isLegacy && urlVersion !== null) {
      setLegacyModal({ open: true, version: urlVersion });
    }
  }, [isLegacy, urlVersion]);
  // A comment-level reader is read-only but not "view only" (UNI-1994).
  const canComment = readonlyReaderCanComment(doc);
  // An image opens in the viewer, which has no version list: history is the page menu's sheet.
  const isImage = isImageDocument(doc);
  const versions = useDocumentVersions(wsId, doc.id, { enabled: !isImage });
  const actions = useDocumentFileActions(wsId, doc);
  const { download, downloading } = actions;
  // The gate's one resolved format, so the body, the layout and the host agree.
  const officeFormatId = gate.format;
  const { office, editorOpen } = gate;
  const formatName = useOfficeFormatName();
  if (!file) {
    return (
      <Notice tone="warning" icon={FileText} layout="inline">
        {t("documents.file.missing_file")}
      </Notice>
    );
  }

  if (usesOfficeEditor(editorOpen, Boolean(OfficeEditorHost), officeFormatId) && OfficeEditorHost) {
    // The editor replaces this view, so its file commands move to the page
    // overflow menu (version history is already one of its entries). The host
    // gets the gate's format so it never detects a different one.
    return (
      <>
        <HeaderActionsFill menuItems={<DocumentFileMenuItems actions={actions} readonly={readonly} />} />
        <OfficeEditorHost wsId={wsId} document={doc} readonly={readonly} officeFormat={officeFormatId} />
        {actions.uploadDialog}
      </>
    );
  }

  if (isImage) {
    // Same shape as the Office editor: the viewer fills the page and its file
    // commands live in the page overflow menu beside "Lịch sử phiên bản".
    return (
      <>
        <HeaderActionsFill menuItems={<DocumentFileMenuItems actions={actions} readonly={readonly} />} />
        <DocumentMediaViewer
          wsId={wsId}
          doc={doc}
          file={file}
          actions={actions}
          readonly={readonly}
          canComment={canComment}
          permissionNoticeShown={permissionNoticeShown}
        />
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
      <DocumentFileCard file={file} actions={actions} readonly={readonly} canComment={canComment} permissionNoticeShown={permissionNoticeShown} />

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
      ) : isLegacy ? (
        <Notice
          tone="info"
          icon={FileText}
          layout="inline"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLegacyModal({ open: true, version: undefined })}
            >
              <MonitorUp aria-hidden className="size-3.5" />
              {t("office.desktop.action")}
            </Button>
          }
        >
          <span className="font-medium text-foreground">{t("documents.file.legacy_format_title")}</span>{" "}
          {t("documents.file.legacy_format_description")}
        </Notice>
      ) : (
        <Notice tone="info" icon={FileText} layout="inline">
          <span className="font-medium text-foreground">{t("documents.file.no_web_editor_title")}</span>{" "}
          {t(readonly ? "documents.file.no_web_editor_description_readonly" : "documents.file.no_web_editor_description")}
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
            {rows.map((version) => {
              const versionLegacy = isLegacyOfficeFormat({ mime_type: version.mime_type }) || (isLegacy && !version.mime_type);
              return (
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
                  <div className="flex shrink-0 items-center gap-0.5">
                    {versionLegacy ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("documents.file.open_version", { no: version.version })}
                        onClick={() => setLegacyModal({ open: true, version: version.version })}
                      >
                        <Eye aria-hidden className="size-3.5" />
                      </Button>
                    ) : null}
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex items-center gap-2">
        <DocumentSaveIndicator readonly={readonly} canComment={canComment} />
      </div>

      {isLegacy || legacyModal.open ? (
        <LegacyFormatDialog
          open={legacyModal.open}
          onOpenChange={(open) => setLegacyModal((prev) => ({ ...prev, open }))}
          documentId={doc.id}
          savedVersion={doc.current_version || file.version}
          version={legacyModal.version}
          operation={readonly ? "view" : "edit"}
          desktopOpen={desktopOpen}
        />
      ) : null}

      {actions.uploadDialog}
    </div>
  );
}
