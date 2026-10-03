import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { EditorSlot, type OfficeEditorLoader } from "@uniwork/views/office/editor-slot";
import { DocxEditor, type DocxOpenFailure } from "@uniwork/views/office/docx";
import { DraftRecoveryPrompt } from "@uniwork/views/office/leave-dialog";
import { RecoveryNotice, type DesktopRecoveryState } from "../recovery-status";
import { LockedAiEntry } from "../ai-entry";
import { Button } from "@uniwork/ui/components/ui/button";
import type { OfficeHost, OfficeIdentity } from "@uniwork/core/office";
import type { DesktopDraftMetadata } from "../../shared/ipc";
import type { RendererBridge } from "../app";
import type { ByteDocumentSession } from "./session";
import { DOCX_DESKTOP_ENGINE_BUILD } from "./docx-surface";

export function OpenByteDocument({ bridge, identity, session, title, onBack, active = true, kind = "cloud", signedIn = false, onSignIn, onLocalFileRebound }: { bridge: RendererBridge; identity: OfficeIdentity; session: ByteDocumentSession; title: string; onBack: () => void; active?: boolean; kind?: "local" | "cloud"; signedIn?: boolean; onSignIn?: () => void; onLocalFileRebound?: (file: { handleId: string; displayName: string }) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const { t: tLocal } = useTranslation(undefined, { keyPrefix: "officeDesktop.local" });
  const [offer, setOffer] = useState<{ metadata: DesktopDraftMetadata; conflict: boolean } | null>(null);
  const [notice, setNotice] = useState<DesktopRecoveryState | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [surfaceVersion, setSurfaceVersion] = useState(0);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [actionFailed, setActionFailed] = useState(false);
  const [localFile, setLocalFile] = useState<{ handleId: string; displayName: string } | null>(null);
  const [loaded, setLoaded] = useState<{ session: ByteDocumentSession; failure?: DocxOpenFailure } | null>(null);
  const saveState = useSyncExternalStore(session.coordinator.subscribe, () => session.coordinator.getState().state);
  const effectiveTitle = localFile?.displayName ?? title;
  const documentKey = localFile?.handleId ?? identity.documentId;
  const current = loaded?.session === session ? loaded : null;
  const ready = Boolean(current && !current.failure);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    let active = true;
    void session.openEditor().then(() => { if (active) setLoaded({ session }); }).catch((error: unknown) => {
      if (active) setLoaded({ session, failure: { outcome: "failed", document_id: identity.documentId, format: "docx", failure_class: "engine_error", message: error instanceof Error ? error.message : String(error) } });
    });
    return () => { active = false; };
  }, [identity.documentId, session, openAttempt]);
  useEffect(() => {
    let active = true;
    void session.listDrafts().then((view) => {
      if (!active) return;
      if (view.status === "found") setOffer({ metadata: view.metadata, conflict: view.conflict });
      else if (view.status === "locked" || view.status === "blocked" || view.status === "unavailable") setNotice(view.status);
    });
    return () => { active = false; };
  }, [session]);
  const capability = useMemo(() => ({ format: "docx" as const, operation: "serialize", host: "desktop", engineBuild: DOCX_DESKTOP_ENGINE_BUILD, contractRevision: "office-editor-host/1", status: session.canSave ? "available" as const : "readonly" as const, fidelityWarnings: [] }), [session]);
  const host = useMemo<OfficeHost>(() => ({
    read: { readDocument: async () => (await session.editor.captureSnapshot()).value, openDocument: async () => ({ outcome: "opened", document_id: identity.documentId, document_model_ref: identity.documentId, warnings: [] }) },
    write: { writeOutput: async () => { throw new Error("use_save_coordinator"); } },
    assets: { resolveFont: async () => null, resolveImage: async () => null, resolveAsset: async () => null },
    ipc: { call: async () => { throw new Error("host_operation_unbound"); }, send: () => undefined, subscribe: () => () => undefined },
  }), [identity.documentId, session]);
  const loadEditor = useMemo<OfficeEditorLoader<Uint8Array>>(() => async () => ({ default: function DesktopDocx() {
    // A recovered draft owns a new TipTap surface; remount its shared toolbar.
    void surfaceVersion;
    return <DocxEditor documentKey={documentKey} title={effectiveTitle} editor={session.editor} coordinator={session.coordinator} capability={capability} manageSession={false} showDocumentControls={false} open={{ open: async () => (await session.openEditor()).openOutcome()! }} />;
  } }), [capability, documentKey, session, effectiveTitle, surfaceVersion]);
  useEffect(() => bridge.onOfficeSaveRequested?.((event) => { if (active && ready && session.canSave && event.documentId === documentKey) void session.coordinator.save("menu"); }), [active, bridge, documentKey, ready, session]);
  const saveAs = async () => {
    setActionFailed(false);
    try {
      const result = await session.saveAs();
      if (!result.accepted || session.isDisposed || !session.localHandle || !session.localName) return;
      const rebound = { handleId: session.localHandle, displayName: session.localName };
      setLocalFile(rebound); onLocalFileRebound?.(rebound);
    } catch { setActionFailed(true); }
  };
  return <>{offer ? <DraftRecoveryPrompt open={active} metadata={offer.metadata} conflict={offer.conflict} recoverable={!offer.conflict}
    onOpenChange={(open) => { if (!open) setOffer(null); }}
    onRecover={async () => { const outcome = await session.recoverDraft(offer.metadata); if (outcome === "locked") { setNotice("locked"); setOffer(null); return true; } const applied = outcome === "recovered"; setRecovered(applied); if (applied) { setOffer(null); setSurfaceVersion((value) => value + 1); } return applied; }}
    onKeep={async () => { setOffer(null); return true; }}
    onDiscard={async () => { if (!await session.discardDraft(offer.metadata)) return false; setOffer(null); return true; }} /> : null}
    <OfficeShell title={effectiveTitle} breadcrumbs={[{ label: t(kind === "local" ? "local" : "title") }]} saveCoordinator={session.coordinator} editorReady={active && ready && session.canSave}
      saveLabel={session.localHandle ? t("saveLocal") : undefined}
      saveDestination={session.localHandle ? "local" : "cloud"}
      actions={<>{kind === "local" ? <LockedAiEntry signedIn={signedIn} onSignIn={onSignIn} /> : null}{ready && session.canSave && session.localHandle ? <Button type="button" variant="outline" disabled={saveState === "saving"} onClick={() => { void saveAs(); }}>{t("saveAs")}</Button> : null}<Button type="button" variant="outline" onClick={onBack}>{kind === "local" ? tLocal("home") : t("back")}</Button></>}
      editor={<>
        {recovered ? <p role="status" className="mb-3 text-caption text-muted-foreground">{t("draftRecovered")}</p> : null}
        {notice ? <RecoveryNotice state={notice} className="mb-3" /> : null}
        {actionFailed ? <p role="alert" className="mb-3 text-caption text-destructive">{t("actionError")}</p> : null}
        <EditorSlot format="docx" host={host} editorHandle={session.editor} capability={current?.failure ? { ...capability, status: "available" } : capability} openState={current?.failure ? "error" : ready ? "ready" : "loading"} openError={current?.failure?.message} onRetry={() => { setLoaded(null); setOpenAttempt((value) => value + 1); }} loadEditor={loadEditor} />
        {ready && !session.canSave ? <section className="flex min-h-0 flex-1 flex-col" aria-label={effectiveTitle} data-testid="docx-readonly-surface">{session.editor.renderSurface?.()}</section> : null}
      </>} /></>;
}
