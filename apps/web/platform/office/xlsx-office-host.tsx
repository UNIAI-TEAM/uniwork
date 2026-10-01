"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
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
  const [capability, setCapability] = useState<OfficeCapabilityEntry | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
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
    setCapability(null);
    setCapabilityError(null);
    void getOfficeCapabilities(document.id).then((result) => {
      if (!active) return;
      const row = result?.operations.find((candidate) => candidate.operation === "edit");
      const available = Boolean(row?.supported && result?.operations.some((candidate) => candidate.operation === "serialize" && candidate.supported));
      setCapability({
        format: "xlsx",
        operation: "edit",
        host: "web",
        engineBuild: result?.engineVersion || "unknown",
        contractRevision: "office-engine/1",
        status: available ? "available" : readonly ? "readonly" : "unavailable",
        reason: available ? null : row?.reason ?? "XLSX editing is unavailable in this deployment",
        fidelityWarnings: [],
      });
    }).catch((error: unknown) => {
      if (!active) return;
      setCapabilityError(error instanceof Error ? error.message : String(error));
      setCapability({
        format: "xlsx", operation: "open", host: "web", engineBuild: "unknown", contractRevision: "office-engine/1",
        status: readonly ? "readonly" : "unavailable", reason: "Office capability negotiation failed", fidelityWarnings: [],
      });
    });
    return () => { active = false; };
  }, [document.id, readonly]);

  const identity = useMemo(() => {
    if (!user || !document.file) return null;
    return {
      deploymentId: "web",
      accountId: user.id,
      organizationId: document.organization_id || wsId,
      workspaceId: document.workspace_id,
      documentId: document.id,
      generation: 1,
      baseVersionId: document.file.version_id,
      baseRevision: document.revision,
    };
  }, [document, user, wsId]);

  const runtime = useMemo(() => identity ? createWebXlsxSessionRuntime({ documentId: document.id, baseRevision: document.revision }) : null, [document.id, document.revision, identity]);
  const adapter = useMemo(() => {
    if (!identity || !runtime || !capability || capability.status !== "available") return null;
    return createXlsxFormatAdapter({
      identity,
      session: { sessionId: user?.id ?? "", deploymentId: "web", accountId: user?.id ?? "", generation: 1 },
      runtime,
      documents: createXlsxDocumentsTransport({ documentId: document.id }),
      capability,
      readonly,
      title: document.title,
    });
  }, [capability, document.id, document.title, identity, readonly, runtime, user?.id]);

  useEffect(() => () => { void adapter?.session.dispose(); }, [adapter]);

  if (!xlsxDocument(document)) return <OfficeEditorHost {...props} officeDeploymentId={officeDeploymentId} />;
  if (capabilityError && !capability) return <OfficeEditorHost {...props} officeDeploymentId={officeDeploymentId} capability={{ format: "xlsx", operation: "open", host: "web", engineBuild: "unknown", contractRevision: "office-engine/1", status: "unavailable", reason: capabilityError, fidelityWarnings: [] }} />;
  return <OfficeEditorHost<XlsxWorkbookSnapshot> {...(props as OfficeEditorHostProps<XlsxWorkbookSnapshot>)} officeDeploymentId={officeDeploymentId} formatAdapter={adapter as OfficeFormatAdapter<XlsxWorkbookSnapshot> | undefined} capability={capability ?? undefined} />;
}
