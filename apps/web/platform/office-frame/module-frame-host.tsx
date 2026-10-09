"use client";

import type { ReactNode } from "react";
import { paths } from "@uniwork/core/paths";
import type { OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { OfficeModuleFrame, OfficeModuleOpenSwitch } from "@uniwork/views/office";
import type { OfficeEditorHostProps } from "../office/editor-host";
import { pinnedFrameVersion } from "./frame-versions";

type ModuleHostProps = OfficeEditorHostProps & { module: OfficeModule };

function ModuleFrameHost(props: ModuleHostProps & { frameVersion: string }) {
  const { module, document, wsId, readonly, className, frameVersion } = props;
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  return (
    <OfficeModuleFrame
      module={module}
      wsId={wsId}
      documentId={document.id}
      title={document.title}
      frameVersion={frameVersion}
      readonly={readonly}
      className={className}
      // Save as made a new document and the frame already edits it; follow it so the URL names what is open.
      onSavedAs={(copyId) => push(paths.workspace(workspace.organization_slug, workspace.slug).document(copyId))}
    />
  );
}

/**
 * A pdf, md, html, pptx or xlsx opens in its genoffice module frame
 * (UNI-1014/1015/1016) when the module's flag is on for the document's
 * organization and its bundle is installed; the G3 host (`fallback`)
 * otherwise, and until the flag's answer arrives. The document screen only
 * mounts this when `pinnedFrameVersion(module)` is set. A view-only user of a
 * module marked `viewOnlyInG3` (slides) stays on the G3 host.
 */
export function ModuleFrameOrG3Host(props: ModuleHostProps & { fallback: ReactNode }) {
  const frameVersion = pinnedFrameVersion(props.module);
  if (!frameVersion || (props.readonly && officeModuleSpec(props.module).viewOnlyInG3)) return props.fallback;
  const { fallback, ...hostProps } = props;
  return (
    <OfficeModuleOpenSwitch
      module={hostProps.module}
      organizationId={hostProps.document.organization_id}
      frame={<ModuleFrameHost {...hostProps} frameVersion={frameVersion} />}
      fallback={fallback}
    />
  );
}
