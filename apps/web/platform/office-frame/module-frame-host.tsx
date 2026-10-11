"use client";

import type { ReactNode } from "react";
import { paths } from "@uniwork/core/paths";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec, officeModuleTooLarge } from "@uniwork/core/office/office-modules";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { downloadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import { DesktopOpenAction, OfficeModuleFrame, OfficeModuleOpenSwitch, OfficeTooLargeNotice, OfficeTooLargeProvider } from "@uniwork/views/office";
import type { OfficeEditorHostProps } from "../office/editor-host";
import { desktopOpenAllowed, useFrameDesktopOpen } from "../office/desktop-open-props";
import { pinnedFrameVersion } from "./frame-versions";

type ModuleHostProps = OfficeEditorHostProps & { module: OfficeModule };

function ModuleFrameHost(props: ModuleHostProps & { frameVersion: string }) {
  const { module, document, wsId, readonly, className, frameVersion } = props;
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const desktopOpen = useFrameDesktopOpen(document);
  return (
    <OfficeModuleFrame
      module={module}
      wsId={wsId}
      documentId={document.id}
      title={document.title}
      frameVersion={frameVersion}
      readonly={readonly}
      className={className}
      libraryHref={paths.workspace(workspace.organization_slug, workspace.slug).documents()}
      desktopOpen={desktopOpen}
      // Save as made a new document and the frame already edits it; follow it so the URL names what is open.
      onSavedAs={(copyId) => push(paths.workspace(workspace.organization_slug, workspace.slug).document(copyId))}
    />
  );
}

/**
 * A document over its module's size cap: the too-large notice with "Open in UniWork Office"
 * (the document page's launch-ticket action, shown only to a user who may edit) and the file's own
 * download, the same surface the G3 formats show. The G3 editor is not mounted.
 */
function ModuleTooLarge({ module, document, readonly }: ModuleHostProps) {
  const desktopOpen = useFrameDesktopOpen(document);
  const download = async () => {
    const blob = await downloadDocumentFile(document.id);
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url; link.download = document.file?.filename ?? document.title;
    window.document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const desktopAction = desktopOpenAllowed({ open: true, readonly }) ? (
    <DesktopOpenAction {...desktopOpen} documentId={document.id} placement="inline" />
  ) : null;
  return (
    <OfficeTooLargeProvider value={{ desktopAction, onDownload: download }}>
      <OfficeTooLargeNotice format={officeModuleSpec(module).format} />
    </OfficeTooLargeProvider>
  );
}

/**
 * A pdf, md, html, pptx or xlsx opens in its genoffice module frame
 * (UNI-1014/1015/1016) when the module's flag is on for the document's
 * organization and its bundle is installed; the G3 host (`fallback`)
 * otherwise, and until the flag's answer arrives. The document screen only
 * mounts this when `pinnedFrameVersion(module)` is set. A view-only user of a
 * module marked `viewOnlyInG3` (slides) stays on the G3 host. A document over its
 * module's size cap (Sheets, GO-D3) is not opened in the web at all: the stored size is checked here before any token is asked for, and a
 * frame that reports `too_large` (80 MB of worksheet XML) lands on the same
 * notice. Either way the person is told to open the file in the desktop app, and
 * the G3 editor stays for the frame's other failures (it did not load, no bundle).
 */
export function ModuleFrameOrG3Host(props: ModuleHostProps & { fallback: ReactNode }) {
  const frameVersion = pinnedFrameVersion(props.module);
  if (!frameVersion || (props.readonly && officeModuleSpec(props.module).viewOnlyInG3)) return props.fallback;
  const { fallback, ...hostProps } = props;
  const tooLarge = <ModuleTooLarge {...hostProps} />;
  // Over the module's size cap (Sheets): the open-in-the-app notice, not the standard editor.
  if (officeModuleTooLarge(props.module, props.document.file?.size_bytes)) return tooLarge;
  return (
    <OfficeModuleOpenSwitch
      module={hostProps.module}
      organizationId={hostProps.document.organization_id}
      frame={<ModuleFrameHost {...hostProps} frameVersion={frameVersion} />}
      fallback={fallback}
      tooLarge={tooLarge}
    />
  );
}
