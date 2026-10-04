"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { getOfficeCapabilities, type OfficeCapabilities } from "@uniwork/core/api/endpoints/office";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";
import type { PdfSnapshot } from "@uniwork/views/office/pdf";
import { OfficeEditorHost, type OfficeEditorHostProps, type OfficeFormatAdapter } from "./editor-host";
import { createPdfDocumentsTransport } from "./pdf-save-transport";

/**
 * The web PDF host owns its client capability row. The engine service keeps
 * the pdf server serialize unbound (host-contract "Capability and provider
 * limits": keep server capability false; client editor work remains format-lane
 * owned), so the binding fact for this host is the browser build itself: the
 * PDF slot ships in this bundle and the save travels through the shared
 * coordinator and the existing Documents upload/commit endpoints. The server
 * rows are evidence about the service runtime only and feed
 * `fidelityWarnings`; they can never make the client row available, and a
 * failed fetch just means no warnings.
 */
const PDF_WEB_ENGINE_BUILD = "09485f884dc845cf3bf27fb7edfe489f9d457aad";

function serverWarnings(result: OfficeCapabilities | null, documentId: string): string[] {
  if (!result || result.documentId !== documentId || result.format !== "pdf") return [];
  return result.operations
    .filter((row) => !row.supported && row.reason)
    .map((row) => `${row.operation}: ${row.reason}`);
}

export function PdfOfficeEditorHost(props: OfficeEditorHostProps) {
  const { document, readonly } = props;
  const { user } = useSession();
  const { t } = useTranslation();
  const unavailable = t("office.pdf.errors.capabilityUnavailable");
  const presentation = useRef({ title: document.title, unavailable });
  presentation.current = { title: document.title, unavailable };
  const [loaded, setLoaded] = useState<{ key: string; adapter?: OfficeFormatAdapter<PdfSnapshot>; capability: OfficeCapabilityEntry } | null>(null);
  const accountId = user?.id;
  const versionId = document.file?.version_id;
  const identity = useMemo(() => accountId && versionId ? {
    deploymentId: "web", accountId, organizationId: document.organization_id,
    workspaceId: document.workspace_id, documentId: document.id, generation: 1,
    baseVersionId: versionId, baseRevision: document.revision,
  } : null, [accountId, document.organization_id, document.workspace_id, document.id, versionId, document.revision]);
  const key = JSON.stringify([identity, readonly]);

  useEffect(() => {
    let active = true;
    let adapter: OfficeFormatAdapter<PdfSnapshot> | undefined;
    const load = async () => {
      if (!identity) return;
      let capability: OfficeCapabilityEntry = {
        format: "pdf", operation: "edit", host: "web",
        engineBuild: PDF_WEB_ENGINE_BUILD, contractRevision: "office-editor-host/1",
        status: readonly ? "readonly" : "available",
        reason: readonly ? presentation.current.unavailable : null,
        fidelityWarnings: [],
      };
      try {
        const result = await getOfficeCapabilities(identity.documentId);
        if (!active) return;
        capability = { ...capability, fidelityWarnings: serverWarnings(result, identity.documentId) };
      } catch {
        // A capability fetch failure is not an editor failure: no warnings.
      }
      if (readonly) {
        if (active) setLoaded({ key, capability });
        return;
      }
      try {
        const { createPdfFormatAdapter } = await import("./pdf-adapter");
        if (!active) return;
        adapter = createPdfFormatAdapter({
          identity, session: { sessionId: identity.accountId, deploymentId: identity.deploymentId, accountId: identity.accountId, generation: identity.generation },
          documents: createPdfDocumentsTransport(identity.documentId), capability, title: presentation.current.title,
        });
        if (active) setLoaded({ key, adapter, capability });
      } catch {
        if (active) setLoaded({ key, capability: { ...capability, status: "unavailable" } });
      }
    };
    void load();
    return () => { active = false; void adapter?.session.dispose(); };
  }, [identity, key, readonly]);

  const current = loaded?.key === key ? loaded : null;
  return <OfficeEditorHost<PdfSnapshot> document={document} wsId={props.wsId} readonly={readonly} breadcrumbs={props.breadcrumbs} className={props.className} formatAdapter={current?.adapter} capability={current?.capability} />;
}
