"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import type { Document } from "@uniwork/core/types/document";
import { useSession } from "@uniwork/core/auth";
import { getOfficeCapabilities } from "@uniwork/core/api/endpoints/office";
import { getPublicConfig } from "@uniwork/core/api/endpoints/config";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { OfficeEditorHost, type OfficeEditorHostProps, type OfficeFormatAdapter } from "./editor-host";
import { createXlsxDocumentsTransport, createXlsxFormatAdapter } from "./xlsx-adapter";
import { createWebXlsxSessionRuntime } from "./xlsx-runtime";

function xlsxDocument(document: Document): boolean {
  return document.file?.mime_type.toLowerCase().includes("spreadsheetml.sheet") === true || document.file?.filename.toLowerCase().endsWith(".xlsx") === true;
}

export function XlsxOfficeEditorHost(props: OfficeEditorHostProps): ReactElement {
  const { document, readonly, wsId } = props;
  const { user } = useSession();
  const { t } = useTranslation();
  const accountId = user?.id;
  const isXlsx = xlsxDocument(document);
  const scopeKey = JSON.stringify([accountId, document.organization_id, document.workspace_id, document.id, wsId, readonly, isXlsx]);
  const [negotiated, setNegotiated] = useState<{ key: string; entry: OfficeCapabilityEntry } | null>(null);
  const capability = negotiated?.key === scopeKey ? negotiated.entry : null;
  const [loaded, setLoaded] = useState<{ key: string; capability: OfficeCapabilityEntry; adapter: OfficeFormatAdapter<XlsxWorkbookSnapshot> } | null>(null);
  const sessionInput = useRef({ document, accountId, readonly, wsId });
  sessionInput.current = { document, accountId, readonly, wsId };
  const unavailable = useRef(t("office.xlsx.errors.capabilityUnavailable"));
  unavailable.current = t("office.xlsx.errors.capabilityUnavailable");
  // Undefined (never guessed) until the server advertises a binding; the
  // desktop open action fails closed on an id it was never given.
  const [officeDeploymentId, setOfficeDeploymentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void getPublicConfig(document.organization_id).then((config) => {
      if (active) setOfficeDeploymentId(config.office_deployment_id);
    }).catch(() => {
      // Config unavailable: stay closed rather than guess a deployment id.
    });
    return () => { active = false; };
  }, [document.organization_id]);

  useEffect(() => {
    let active = true;
    if (!isXlsx) return undefined;
    void getOfficeCapabilities(document.id).then((result) => {
      if (!active) return;
      const matching = result?.documentId === document.id && result.format === "xlsx";
      const row = result?.operations.find((candidate) => candidate.operation === "edit");
      const opens = matching && result.operations.some((candidate) => candidate.operation === "open" && candidate.supported);
      const available = Boolean(opens && row?.supported && result?.operations.some((candidate) => candidate.operation === "serialize" && candidate.supported));
      setNegotiated({ key: scopeKey, entry: {
        format: "xlsx",
        operation: "edit",
        host: "web",
        engineBuild: result?.engineVersion || "unknown",
        contractRevision: "office-engine/1",
        status: readonly && opens ? "readonly" : available ? "available" : "unavailable",
        reason: available || readonly && opens ? null : unavailable.current,
        fidelityWarnings: [],
      } });
    }).catch(() => {
      if (!active) return;
      setNegotiated({ key: scopeKey, entry: {
        format: "xlsx", operation: "open", host: "web", engineBuild: "unknown", contractRevision: "office-engine/1",
        status: "unavailable", reason: unavailable.current, fidelityWarnings: [],
      } });
    });
    return () => { active = false; };
  }, [document.id, isXlsx, readonly, scopeKey]);

  useEffect(() => {
    const input = sessionInput.current;
    if (!input.accountId || !input.document.file || !capability || !["available", "readonly"].includes(capability.status)) return undefined;
    // Server metadata and our own Save receipts must not replace the live
    // N+1 model. The coordinator/runtime advance their base from the receipt;
    // an external revision remains a conflict against that retained base.
    const identity = {
      deploymentId: "web",
      accountId: input.accountId,
      organizationId: input.document.organization_id || input.wsId,
      workspaceId: input.document.workspace_id,
      documentId: input.document.id,
      generation: 1,
      baseVersionId: input.document.file.version_id,
      baseRevision: input.document.revision,
    };
    const runtime = createWebXlsxSessionRuntime({ documentId: identity.documentId, baseRevision: identity.baseRevision });
    const adapter = createXlsxFormatAdapter({
      identity,
      session: { sessionId: input.accountId, deploymentId: "web", accountId: input.accountId, generation: 1 },
      runtime,
      documents: createXlsxDocumentsTransport({ documentId: identity.documentId }),
      capability,
      readonly: input.readonly,
      title: input.document.title,
      embedded: true,
      clipboard: typeof navigator !== "undefined" && navigator.clipboard ? {
        readText: () => navigator.clipboard.readText(),
        writeText: (text) => navigator.clipboard.writeText(text),
      } : undefined,
    });
    setLoaded({ key: scopeKey, capability, adapter });
    return () => { void adapter.session.dispose(); };
  }, [capability, scopeKey]);

  const adapter = loaded?.key === scopeKey && loaded.capability === capability ? loaded.adapter : undefined;
  if (!isXlsx) return <OfficeEditorHost {...props} officeDeploymentId={officeDeploymentId} />;
  const pending = !capability || (["available", "readonly"].includes(capability.status) && !adapter);
  const loadingView = pending ? <div className="flex min-h-64 flex-col gap-3 rounded-panel border border-border bg-background p-4" role="status" aria-live="polite" aria-busy="true">
    <p className="text-body text-muted-foreground">{t("office.xlsx.state.opening")}</p>
    <Skeleton className="h-11 w-full" />
    <Skeleton className="min-h-48 flex-1" />
  </div> : undefined;
  return <OfficeEditorHost<XlsxWorkbookSnapshot> {...(props as OfficeEditorHostProps<XlsxWorkbookSnapshot>)} officeDeploymentId={officeDeploymentId} formatAdapter={adapter} editorView={loadingView} capability={capability ?? undefined} />;
}
