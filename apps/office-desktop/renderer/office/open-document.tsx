import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { EditorSlot, type OfficeEditorLoader } from "@uniwork/views/office/editor-slot";
import { DocxEditor } from "@uniwork/views/office/docx";
import { Button } from "@uniwork/ui/components/ui/button";
import type { OfficeHost, OfficeIdentity } from "@uniwork/core/office";
import type { RendererBridge } from "../app";
import { createByteDocumentSession, type OpenedBytes } from "./session";

export function OpenByteDocument({ bridge, identity, opened, title, onBack }: { bridge: RendererBridge; identity: OfficeIdentity; opened: OpenedBytes; title: string; onBack: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const session = useMemo(() => createByteDocumentSession(bridge, identity, opened), [bridge, identity, opened]);
  const capability = useMemo(() => ({ format: "docx" as const, operation: "serialize", host: "desktop", engineBuild: "byte-preserving", contractRevision: "office-editor-host/1", status: opened.canSave === false ? "readonly" as const : "available" as const, fidelityWarnings: [] }), [opened.canSave]);
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
  return <OfficeShell title={title} breadcrumbs={[{ label: t("title") }]} saveCoordinator={session.coordinator} editorReady={opened.canSave !== false}
    saveLabel={opened.localHandle ? t("saveLocal") : undefined}
    actions={<Button type="button" variant="outline" onClick={onBack}>{t("back")}</Button>}
    editor={<><p role="status" className="mb-3 text-body text-muted-foreground">{t("contentPending")}</p><EditorSlot format="docx" host={host} editorHandle={session.editor} capability={capability} openState="ready" loadEditor={loadEditor} /></>} />;
}
