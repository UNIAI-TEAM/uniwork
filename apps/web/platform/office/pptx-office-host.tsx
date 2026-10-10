// UNI-927 (P0-1) — the web PPTX office host.
//
// The engine service binds no pptx handler, so — like DOCX — the binding fact
// is the browser build itself: the vendored pptx artifact ships in this
// bundle and the save travels through the shared coordinator plus the existing
// Documents upload/commit endpoints. The server capability rows are evidence
// about the service runtime only; they feed fidelityWarnings and can never
// make the client row available. A failed artifact load is the unavailable
// path, and a readonly document mounts the same editor with saves blocked.
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import type { Document } from "@uniwork/core/types/document";
import { useSession } from "@uniwork/core/auth";
import { getOfficeCapabilities, type OfficeCapabilities } from "@uniwork/core/api/endpoints/office";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";
import { OfficeEditorHost, type OfficeEditorHostProps } from "./editor-host";
import { createPptxDocumentsTransport } from "./pptx-save-transport";
import type { PptxFormatAdapter } from "./pptx-adapter";
import type { PptxDeckSnapshot } from "./pptx-runtime";

/** The genoffice commit the vendored pptx artifact is pinned to (UNI-684). */
const PPTX_WEB_ENGINE_BUILD = "09485f884dc845cf3bf27fb7edfe489f9d457aad";

function pptxDocument(document: Document): boolean {
  return document.file?.mime_type.toLowerCase().includes("presentationml.presentation") === true || document.file?.filename.toLowerCase().endsWith(".pptx") === true;
}

/** Unsupported server rows become fidelity warnings, never a refusal: the
 * service runtime has no pptx lane and the browser build is what binds. */
function serverWarnings(result: OfficeCapabilities | null, documentId: string): string[] {
  if (!result || result.documentId !== documentId || result.format !== "pptx") return [];
  return result.operations.filter((row) => !row.supported && row.reason).map((row) => `${row.operation}: ${row.reason}`);
}

export function PptxOfficeEditorHost(props: OfficeEditorHostProps): ReactElement {
  const { document, readonly, wsId } = props;
  const { user } = useSession();
  const { t } = useTranslation();
  const accountId = user?.id;
  const isPptx = pptxDocument(document);
  const scopeKey = JSON.stringify([accountId, document.organization_id, document.workspace_id, document.id, wsId, readonly, isPptx]);
  const [negotiated, setNegotiated] = useState<{ key: string; entry: OfficeCapabilityEntry } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; capability: OfficeCapabilityEntry; adapter?: PptxFormatAdapter } | null>(null);
  const sessionInput = useRef({ document, accountId, readonly, wsId });
  sessionInput.current = { document, accountId, readonly, wsId };
  const unavailable = useRef(t("office.pptx.errors.capabilityUnavailable"));
  unavailable.current = t("office.pptx.errors.capabilityUnavailable");

  useEffect(() => {
    if (!isPptx) {
      setNegotiated(null);
      return undefined;
    }
    let active = true;
    const negotiate = async () => {
      let entry: OfficeCapabilityEntry = {
        format: "pptx",
        operation: "serialize",
        host: "web",
        engineBuild: PPTX_WEB_ENGINE_BUILD,
        contractRevision: "office-editor-host/1",
        status: readonly ? "readonly" : "available",
        reason: readonly ? unavailable.current : null,
        fidelityWarnings: [],
      };
      try {
        const result = await getOfficeCapabilities(document.id);
        if (!active) return;
        entry = { ...entry, fidelityWarnings: serverWarnings(result, document.id) };
      } catch {
        // A capability fetch failure is not an editor failure: no warnings.
      }
      if (active) setNegotiated({ key: scopeKey, entry });
    };
    void negotiate();
    return () => { active = false; };
  }, [document.id, isPptx, readonly, scopeKey]);

  useEffect(() => {
    if (!negotiated || negotiated.key !== scopeKey) return undefined;
    const entry = negotiated.entry;
    if (!["available", "readonly"].includes(entry.status)) return undefined;
    const input = sessionInput.current;
    if (!input.accountId || !input.document.file) return undefined;
    let active = true;
    let adapter: PptxFormatAdapter | undefined;
    const bind = async () => {
      try {
        // Both are loaded here, not in the negotiation chunk: the runtime
        // statically imports the generated pptx artifact, so a load failure
        // lands in this catch and the host fails closed.
        const [{ createPptxFormatAdapter }, { createWebPptxSessionRuntime }] = await Promise.all([
          import("./pptx-adapter"),
          import("./pptx-runtime"),
        ]);
        if (!active) return;
        const runtime = createWebPptxSessionRuntime({ documentId: input.document.id });
        adapter = createPptxFormatAdapter({
          runtime,
          identity: {
            deploymentId: "web",
            accountId: input.accountId as string,
            organizationId: input.document.organization_id || input.wsId,
            workspaceId: input.document.workspace_id,
            documentId: input.document.id,
            generation: 1,
            baseVersionId: input.document.file?.version_id ?? "",
            baseRevision: input.document.revision,
          },
          session: { sessionId: input.accountId as string, deploymentId: "web", accountId: input.accountId as string, generation: 1 },
          documents: createPptxDocumentsTransport(input.document.id),
          capability: entry,
          readonly: input.readonly,
          title: input.document.title,
        });
        if (active) setLoaded({ key: scopeKey, capability: entry, adapter });
      } catch {
        // The artifact could not load (or the adapter could not bind): fail
        // closed and let the shared host present the unbound alert.
        if (active) setLoaded({ key: scopeKey, capability: { ...entry, status: "unavailable", reason: unavailable.current } });
      }
    };
    void bind();
    return () => { active = false; void adapter?.session.dispose(); };
  }, [negotiated, scopeKey]);

  if (!isPptx) return <OfficeEditorHost {...props} />;

  const capability = negotiated?.key === scopeKey ? negotiated.entry : null;
  const current = loaded?.key === scopeKey ? loaded : null;
  const pending = !capability || (["available", "readonly"].includes(capability.status) && !current);
  const loadingView = pending ? (
    <div className="flex min-h-64 flex-col gap-3 rounded-panel border border-border bg-background p-4" role="status" aria-live="polite" aria-busy="true">
      <p className="text-body text-muted-foreground">{t("office.pptx.state.opening")}</p>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="min-h-48 flex-1" />
    </div>
  ) : undefined;
  // Negotiation is a distinct, sessionless busy state. Sending a loading view
  // to the fail-closed shared host would produce its unbound alert.
  if (pending) {
    return (
      <div className={props.className} data-office-editor-host>
        <OfficeShell title={document.title} breadcrumbs={props.breadcrumbs} editor={loadingView} editorReady={false} className="min-h-[20rem]" />
      </div>
    );
  }
  return (
    <OfficeEditorHost<PptxDeckSnapshot>
      {...(props as OfficeEditorHostProps<PptxDeckSnapshot>)}
     
      formatAdapter={current?.adapter}
      capability={current?.capability ?? capability ?? undefined}
    />
  );
}
