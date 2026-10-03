import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { EditorSlot, type OfficeEditorLoader } from "@uniwork/views/office/editor-slot";
import { DocxEditor } from "@uniwork/views/office/docx";
import { DraftRecoveryPrompt } from "@uniwork/views/office/leave-dialog";
import { RecoveryNotice, type DesktopRecoveryState } from "../recovery-status";
import { Button } from "@uniwork/ui/components/ui/button";
import type { OfficeHost, OfficeIdentity } from "@uniwork/core/office";
import type { DesktopDraftMetadata } from "../../shared/ipc";
import type { RendererBridge } from "../app";
import type { ByteDocumentSession } from "./session";
import { LockedAiEntry } from "../ai-entry";

export function OpenByteDocument({ identity, session, title, onBack, active = true, kind, signedIn, onSignIn }: { bridge: RendererBridge; identity: OfficeIdentity; session: ByteDocumentSession; title: string; onBack: () => void; active?: boolean; kind: "local" | "cloud"; signedIn: boolean; onSignIn?: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const { t: tLocal } = useTranslation(undefined, { keyPrefix: "officeDesktop.local" });
  const [offer, setOffer] = useState<{ metadata: DesktopDraftMetadata; conflict: boolean } | null>(null);
  const [notice, setNotice] = useState<DesktopRecoveryState | null>(null);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    let active = true;
    void session.listDrafts().then((view) => {
      if (!active) return;
      if (view.status === "found") setOffer({ metadata: view.metadata, conflict: view.conflict });
      else if (view.status === "locked" || view.status === "blocked" || view.status === "unavailable") setNotice(view.status);
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
    return <DocxEditor documentKey={identity.documentId} title={title} editor={session.editor} coordinator={session.coordinator} capability={capability} manageSession={false} showDocumentControls={false} open={{ open: async () => ({ outcome: "opened", document_id: identity.documentId, document_model_ref: identity.documentId, warnings: [] }) }} />;
  } }), [capability, identity.documentId, session, title]);
  return <>{offer ? <DraftRecoveryPrompt open={active} metadata={offer.metadata} conflict={offer.conflict} recoverable={!offer.conflict}
    onOpenChange={(open) => { if (!open) setOffer(null); }}
    onRecover={async () => {
      const outcome = await session.recoverDraft(offer.metadata);
      if (outcome === "locked") { setNotice("locked"); setOffer(null); return true; }
      const applied = outcome === "recovered";
      setRecovered(applied); if (applied) setOffer(null); return applied;
    }}
    onKeep={async () => { setOffer(null); return true; }}
    onDiscard={async () => { if (!await session.discardDraft(offer.metadata)) return false; setOffer(null); return true; }} /> : null}
    <OfficeShell title={title} breadcrumbs={[{ label: t(kind === "local" ? "local" : "title") }]} saveCoordinator={session.coordinator} editorReady={active && session.canSave}
      saveLabel={session.localHandle ? t("saveLocal") : undefined}
      saveDestination={session.localHandle ? "local" : "cloud"}
      actions={<>
        {kind === "local" ? <LockedAiEntry signedIn={signedIn} onSignIn={onSignIn} /> : null}
        {kind === "local" && session.localHandle ? <Button type="button" variant="outline" onClick={() => { void session.saveAs(); }}>{tLocal("saveAs")}</Button> : null}
        <Button type="button" variant="outline" onClick={onBack}>{kind === "local" ? tLocal("home") : t("back")}</Button>
      </>}
      editor={<><p role="status" className="mb-3 text-body text-muted-foreground">{t("contentPending")}</p>
        {recovered ? <p role="status" className="mb-3 text-caption text-muted-foreground">{t("draftRecovered")}</p> : null}
        {notice ? <RecoveryNotice state={notice} className="mb-3" /> : null}
        <EditorSlot format="docx" host={host} editorHandle={session.editor} capability={capability} openState="ready" loadEditor={loadEditor} /></>} /></>;
}
