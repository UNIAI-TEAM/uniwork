"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { getOfficeCapabilities } from "@uniwork/core/api/endpoints/office";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";
import type { DocxTiptapSnapshot } from "@uniwork/views/office/docx";
import { OfficeEditorHost, type OfficeEditorHostProps, type OfficeFormatAdapter } from "./editor-host";
import { createDocxDocumentsTransport } from "./docx-save-transport";

export function DocxOfficeEditorHost(props: OfficeEditorHostProps) {
  const { document, readonly } = props;
  const { user } = useSession();
  const { t } = useTranslation();
  const unavailable = t("office.docx.errors.capabilityUnavailable");
  const presentation = useRef({ title: document.title, unavailable });
  presentation.current = { title: document.title, unavailable };
  const [loaded, setLoaded] = useState<{ key: string; adapter?: OfficeFormatAdapter<DocxTiptapSnapshot>; capability: OfficeCapabilityEntry } | null>(null);
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
    let adapter: OfficeFormatAdapter<DocxTiptapSnapshot> | undefined;
    const capability: OfficeCapabilityEntry = { format: "docx", operation: "serialize", host: "web", engineBuild: "09485f884dc845cf3bf27fb7edfe489f9d457aad", contractRevision: "office-editor-host/1", status: "unknown", reason: presentation.current.unavailable, fidelityWarnings: [] };
    const load = async () => {
      if (!identity) return;
      try {
        const result = await getOfficeCapabilities(identity.documentId);
        if (!active) return;
        const supported = result?.documentId === identity.documentId && result.format === "docx" && ["open", "edit", "serialize"].every((operation) => result.operations.some((row) => row.operation === operation && row.supported));
        capability.status = supported && !readonly ? "available" : readonly ? "readonly" : "unavailable";
        if (capability.status === "available") capability.reason = null;
        if (capability.status === "available") {
          const { createDocxFormatAdapter } = await import("./docx-adapter");
          if (!active) return;
          adapter = createDocxFormatAdapter({
            identity, session: { sessionId: identity.accountId, deploymentId: identity.deploymentId, accountId: identity.accountId, generation: identity.generation },
            documents: createDocxDocumentsTransport(identity.documentId), capability, title: presentation.current.title,
          });
        }
        if (active) setLoaded({ key, adapter, capability });
      } catch {
        if (active) setLoaded({ key, capability: { ...capability, status: "unavailable" } });
      }
    };
    void load();
    return () => { active = false; void adapter?.session.dispose(); };
  }, [identity, key, readonly]);

  const current = loaded?.key === key ? loaded : null;
  return <OfficeEditorHost<DocxTiptapSnapshot> document={document} wsId={props.wsId} readonly={readonly} breadcrumbs={props.breadcrumbs} className={props.className} formatAdapter={current?.adapter} capability={current?.capability} />;
}
