import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { EditorSlot, type OfficeEditorLoader } from "@uniwork/views/office/editor-slot";
import { DocxEditor } from "@uniwork/views/office/docx";
import { DraftRecoveryPrompt } from "@uniwork/views/office/leave-dialog";
import { RecoveryNotice, type DesktopRecoveryState } from "../recovery-status";
import { Button } from "@uniwork/ui/components/ui/button";
import type { OfficeHost, OfficeIdentity } from "@uniwork/core/office";
import type { RendererBridge } from "../app";
import type { ByteDocumentSession } from "./session";

export function OpenByteDocument({ bridge, identity, session, title, onBack }: { bridge: RendererBridge; identity: OfficeIdentity; session: ByteDocumentSession; title: string; onBack: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [recovery, setRecovery] = useState<{ conflict: boolean; recoverable: boolean } | null>(null);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => session.coordinator.subscribe(() => undefined), [session]);
  useEffect(() => {
    let active = true;
    void session.listDrafts().then((view) => {
      if (!active) return;
      if (view.status === "found") setRecovery({ conflict: view.conflict, recoverable: !view.conflict });
      else if (view.status === "locked" || view.status === "blocked") setRecovery({ conflict: false, recoverable: false });
    });
    return () => { active = false; };
  }, [session]);
  const capability = useMemo(() => ({ format: "docx" as const, operation: "serialize", host: "desktop", engineBuild: "byte-preserving", contractRevision: "office-editor-host/1", status: session.canSave ? "available" as const : "readonly" as const, fidelityWarnings: [] }), [session]);
  const host = useMemo<OfficeHost>(() => ({
    read: { readDocument: async () => (await session.editor.captureSnapshot()).value, openDocument: async () => ({ outcome: "opened", document_id: identity.documentId, document_model_ref: identity.documentId, warnings: [] }) },
    write: { writeOutput: async () => { throw new Error("use_save_coordinator"); } },
    assets: { resolveFont: async () => null, resolveImage: async () => null, resolveAsset: async () => null },
    ipc: { call: async () => { throw new Error("host_operation_unbound"); }, send: () => undefined, subscribe: () => () => undefined },
  }), [identity.documentId, session]);
  const loadEditor = useMemo<OfficeEditorLoader<Uint8Array>>(() => async () => ({ default: function DesktopDocx() {
    return <DocxEditor documentKey={identity.documentId} title={title} editor={session.editor} coordinator={session.coordinator} capability={capability} open={{ open: async () => ({ outcome: "opened", document_id: identity.documentId, document_model_ref: identity.documentId, warnings: [] }) }} />;
  } }), [capability, identity.documentId, session, title]);
  useEffect(() => bridge.onOfficeSaveRequested?.((event) => { if (event.documentId === identity.documentId) void session.coordinator.save("menu"); }), [bridge, identity.documentId, session]);
  const notice: DesktopRecoveryState | null = recovery ? (recovery.conflict ? "conflict" : recovery.recoverable ? null : "blocked") : null;
  return <>{recovery ? <DraftRecoveryPrompt open metadata={null} conflict={recovery.conflict} recoverable={recovery.recoverable}
    onOpenChange={(open) => { if (!open) setRecovery(null); }}
    onRecover={async () => { const view = await session.listDrafts(); if (view.status !== "found") return false; const applied = await session.recoverDraft(view.metadata); setRecovered(applied); if (applied) setRecovery(null); return applied; }}
    onKeep={async () => { setRecovery(null); return true; }}
    onDiscard={async () => { const view = await session.listDrafts(); if (view.status === "found" && !(await session.discardDraft())) return false; setRecovery(null); return true; }} /> : null}
    <OfficeShell title={title} breadcrumbs={[{ label: t("title") }]} saveCoordinator={session.coordinator} editorReady={session.canSave}
      saveLabel={session.localHandle ? t("saveLocal") : undefined}
      saveDestination={session.localHandle ? "local" : "cloud"}
      actions={<Button type="button" variant="outline" onClick={onBack}>{t("back")}</Button>}
      editor={<><p role="status" className="mb-3 text-body text-muted-foreground">{t("contentPending")}</p>
        {recovered ? <p role="status" className="mb-3 text-caption text-muted-foreground">{t("draftRecovered")}</p> : null}
        {notice ? <RecoveryNotice state={notice} className="mb-3" /> : null}
        <EditorSlot format="docx" host={host} editorHandle={session.editor} capability={capability} openState="ready" loadEditor={loadEditor} /></>} /></>;
}
