"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleForFormat } from "@uniwork/core/office/office-modules";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { pinnedFrameVersion } from "../office-frame/frame-versions";
import { detectDocumentFormat, type OfficeEditorHostProps } from "./editor-host";
import { useOfficeTabTitle } from "./tab-title";

// The document page's one host entry. It routes by FORMAT, never by
// elimination: a document whose format no host can open gets a typed
// unsupported state instead of being handed to a host that would silently
// open it as something else (the previous xlsx fallback).

function LoadingEditor() {
  const { t } = useTranslation();
  return <div role="status" className="p-4 text-body text-muted-foreground">{t("office.editor.loading")}</div>;
}

const DocxHost = dynamic(() => import("./docx-office-host").then((module) => module.DocxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const DocxFrameHost = dynamic(() => import("../office-frame/docs-frame-host").then((module) => module.DocxFrameOrG3Host), { ssr: false, loading: LoadingEditor });
const PdfHost = dynamic(() => import("./pdf-office-host").then((module) => module.PdfOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const XlsxHost = dynamic(() => import("./xlsx-office-host").then((module) => module.XlsxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const MarkdownHost = dynamic(() => import("./md-html-adapter").then((module) => module.MarkdownOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const HtmlHost = dynamic(() => import("./md-html-adapter").then((module) => module.HtmlOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const PptxHost = dynamic(() => import("./pptx-office-host").then((module) => module.PptxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const ModuleFrameHost = dynamic(() => import("../office-frame/module-frame-host").then((module) => module.ModuleFrameOrG3Host), { ssr: false, loading: LoadingEditor });

/**
 * The G3 host of each module other than Docs (UNI-927 P0-1: .pptx has its own
 * browser host). The module comes from the same table that names its flag.
 */
const G3_HOSTS: Readonly<Record<Exclude<OfficeModule, "docs">, ComponentType<OfficeEditorHostProps>>> = {
  pdf: PdfHost, sheets: XlsxHost, markdown: MarkdownHost, html: HtmlHost, slides: PptxHost,
};

/** A format this host build has no editor for. Typed, never a silent fallback. */
function UnsupportedHost({ format, title }: { format: string; title: string }) {
  const { t } = useTranslation();
  return (
    <div className="p-4" data-office-editor-host data-office-unsupported={format}>
      <Alert variant="destructive" role="alert" data-testid="office-host-unsupported">
        <AlertTitle>{t("office.editor.capability_unavailable")}</AlertTitle>
        <AlertDescription>{t("office.editor.editor_pending", { format })} {title}</AlertDescription>
      </Alert>
    </div>
  );
}

export function DocumentOfficeEditorHost(props: OfficeEditorHostProps) {
  useOfficeTabTitle(props.document.title);
  const format = detectDocumentFormat(props.document);
  const officeModule = officeModuleForFormat(format);
  // UNI-1013: the genoffice Docs frame when office_docs_web is on; the G3 host otherwise.
  if (officeModule === "docs") return <DocxFrameHost {...props} fallback={<DocxHost {...props} />} />;
  if (officeModule) {
    // UNI-1014/1015/1016: the module frame when its bundle is installed (the switch then reads
    // the module's flag); the G3 host alone otherwise, so nothing changes without the bundle.
    const G3Host = G3_HOSTS[officeModule];
    return pinnedFrameVersion(officeModule) ? <ModuleFrameHost {...props} module={officeModule} fallback={<G3Host {...props} />} /> : <G3Host {...props} />;
  }
  // The conversion-only sources (xls, odt) have no web editor yet.
  // Say so; do not route them to a host for a different format.
  return <UnsupportedHost format={format === "unknown" ? props.document.file?.filename ?? "unknown" : format} title={props.document.title} />;
}
