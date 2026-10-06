import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { EditorSlot, type OfficeEditorLoader } from "@uniwork/views/office/editor-slot";
import type { DocxOpenFailure } from "@uniwork/views/office/docx";
import type { PdfOpenFailure } from "@uniwork/views/office/pdf";
import { DraftRecoveryPrompt } from "@uniwork/views/office/leave-dialog";
import { RecoveryNotice, type DesktopRecoveryState } from "../recovery-status";
import { LockedAiEntry } from "../ai-entry";
import { FeatureOffNotice } from "./feature-off-notice";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import type { OfficeHost, OfficeIdentity } from "@uniwork/core/office";
import type { DesktopDraftMetadata } from "../../shared/ipc";
import type { RendererBridge } from "../app";
import type { ByteDocumentSession } from "./session";
import type { PptxDocumentSession } from "./pptx-session";
import { PptxEditorView } from "@uniwork/views/office/pptx";
import type { FormatEdit, PptxEdit, PptxParagraphLike } from "@uniwork/office-engine/pptx";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import { desktopEngineBuild, type DesktopDocumentFormat } from "../../shared/document-formats";
import { desktopEditorLoader } from "./editor-registry";
import { printTextDocument } from "./text-print";

/** The header overflow control. Inline rather than a lucide import: the
 * desktop package does not depend on the icon set directly. */
function MoreIcon() {
  return <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
}

/** The one draft-recovery flow both tab shells share: list this document's
 * rows once per session, offer the newest through DraftRecoveryPrompt (a row
 * recorded against another base is a conflict and is not recoverable), and
 * surface locked/blocked/unavailable as the typed notice. */
function useDraftRecovery(session: Pick<ByteDocumentSession, "listDrafts" | "recoverDraft" | "discardDraft">, onRecovered?: () => void) {
  const [offer, setOffer] = useState<{ metadata: DesktopDraftMetadata; conflict: boolean } | null>(null);
  const [notice, setNotice] = useState<DesktopRecoveryState | null>(null);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    let active = true;
    void session.listDrafts().then((view) => {
      if (!active) return;
      if (view.status === "found") setOffer({ metadata: view.metadata, conflict: view.conflict });
      else if (view.status === "locked" || view.status === "blocked" || view.status === "unavailable") setNotice(view.status);
    });
    return () => { active = false; };
  }, [session]);
  const prompt = (open: boolean) => offer ? <DraftRecoveryPrompt open={open} metadata={offer.metadata} conflict={offer.conflict} recoverable={!offer.conflict}
    onOpenChange={(next) => { if (!next) setOffer(null); }}
    onRecover={async () => { const outcome = await session.recoverDraft(offer.metadata); if (outcome === "locked") { setNotice("locked"); setOffer(null); return true; } const applied = outcome === "recovered"; setRecovered(applied); if (applied) { setOffer(null); onRecovered?.(); } return applied; }}
    onKeep={async () => { setOffer(null); return true; }}
    onDiscard={async () => { if (!await session.discardDraft(offer.metadata)) return false; setOffer(null); return true; }} /> : null;
  return { prompt, notice, recovered };
}

/** Format dispatcher: a tab's session already knows its format, so the byte
 * shell (DOCX/PDF through the editor registry) and the PPTX deck shell each
 * stay typed to their own session. */
export function OpenByteDocument(props: {
  bridge: RendererBridge; identity: OfficeIdentity; session: ByteDocumentSession | PptxDocumentSession; title: string; onBack: () => void;
  active?: boolean; kind?: "local" | "cloud"; signedIn?: boolean; onSignIn?: () => void; onLocalFileRebound?: (file: { handleId: string; displayName: string }) => void;
  /** The tab is view-only because the format's Office flag is off, not because of the reader's permission. */
  readOnlyReason?: "feature_off";
}) {
  const { session, readOnlyReason, ...rest } = props;
  return session.editor.format === "pptx"
    ? <OpenPptxDocument {...rest} session={session as PptxDocumentSession} />
    : <OpenByteSessionDocument {...rest} readOnlyReason={readOnlyReason} session={session as ByteDocumentSession} />;
}

function OpenByteSessionDocument({ bridge, identity, session, title, onBack, active = true, kind = "cloud", signedIn = false, onSignIn, onLocalFileRebound, readOnlyReason }: { bridge: RendererBridge; identity: OfficeIdentity; session: ByteDocumentSession; title: string; onBack: () => void; active?: boolean; kind?: "local" | "cloud"; signedIn?: boolean; onSignIn?: () => void; onLocalFileRebound?: (file: { handleId: string; displayName: string }) => void; readOnlyReason?: "feature_off" }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const { t: tLocal } = useTranslation(undefined, { keyPrefix: "officeDesktop.local" });
  const { t: tOffice } = useTranslation(undefined, { keyPrefix: "office" });
  const { t: tAi } = useTranslation(undefined, { keyPrefix: "officeDesktop.ai" });
  const [surfaceVersion, setSurfaceVersion] = useState(0);
  const { prompt, notice, recovered } = useDraftRecovery(session, () => setSurfaceVersion((value) => value + 1));
  const [openAttempt, setOpenAttempt] = useState(0);
  const [actionFailed, setActionFailed] = useState(false);
  const [localFile, setLocalFile] = useState<{ handleId: string; displayName: string } | null>(null);
  const format = session.editor.format;
  const [loaded, setLoaded] = useState<{ session: ByteDocumentSession; failure?: DocxOpenFailure | PdfOpenFailure } | null>(null);
  const saveState = useSyncExternalStore(session.coordinator.subscribe, () => session.coordinator.getState().state);
  const effectiveTitle = localFile?.displayName ?? title;
  const documentKey = localFile?.handleId ?? identity.documentId;
  const current = loaded?.session === session ? loaded : null;
  const ready = Boolean(current && !current.failure);
  // A flag-off tab is view-only by the feature switch: one neutral notice replaces the permission chip/alert and the capability box.
  const featureOff = readOnlyReason === "feature_off" && !session.canSave;
  const readOnlyMessage = !session.canSave && !current?.failure;
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    let active = true;
    void session.openEditor().then(() => { if (active) setLoaded({ session }); }).catch((error: unknown) => {
      if (active) setLoaded({ session, failure: { outcome: "failed", document_id: identity.documentId, format, failure_class: (error as { failureClass?: string })?.failureClass ?? "engine_error", message: error instanceof Error ? error.message : String(error) } as DocxOpenFailure | PdfOpenFailure });
    });
    return () => { active = false; };
  }, [format, identity.documentId, session, openAttempt]);
  const capability = useMemo(() => ({ format,operation: "serialize", host: "desktop", engineBuild: desktopEngineBuild(format as DesktopDocumentFormat), contractRevision: "office-editor-host/1", status: session.canSave ? "available" as const : "readonly" as const, fidelityWarnings: [] }), [format, session]);
  const host = useMemo<OfficeHost>(() => ({
    read: { readDocument: async () => (await session.editor.captureSnapshot()).value, openDocument: async () => ({ outcome: "opened", document_id: identity.documentId, document_model_ref: identity.documentId, warnings: [] }) },
    write: { writeOutput: async () => { throw new Error("use_save_coordinator"); } },
    assets: { resolveFont: async () => null, resolveImage: async () => null, resolveAsset: async () => null },
    ipc: { call: async () => { throw new Error("host_operation_unbound"); }, send: () => undefined, subscribe: () => () => undefined },
  }), [identity.documentId, session]);
  const loadEditor = useMemo<OfficeEditorLoader<Uint8Array>>(() => async (requestedFormat) => {
    const loader = desktopEditorLoader(requestedFormat as DesktopDocumentFormat, { documentKey, title: effectiveTitle, session, capability, surfaceVersion, printBridge: bridge });
    if (!loader) throw new Error("desktop_surface_unbound");
    return loader(requestedFormat);
  }, [bridge, capability, documentKey, session, effectiveTitle, surfaceVersion]);
  useEffect(() => bridge.onOfficeSaveRequested?.((event) => { if (active && ready && session.canSave && event.documentId === documentKey) void session.coordinator.save("menu"); }), [active, bridge, documentKey, ready, session]);
  const printText = async () => {
    setActionFailed(false);
    const text = session.editor.getText?.();
    if ((format !== "md" && format !== "html") || text === undefined) { setActionFailed(true); return; }
    const result = await printTextDocument(bridge, format, text, effectiveTitle);
    if (result.outcome === "failed") setActionFailed(true);
  };
  const saveAs = async () => {
    setActionFailed(false);
    try {
      const result = await session.saveAs();
      if (!result.accepted || session.isDisposed || !session.localHandle || !session.localName) return;
      const rebound = { handleId: session.localHandle, displayName: session.localName };
      setLocalFile(rebound); onLocalFileRebound?.(rebound);
    } catch { setActionFailed(true); }
  };
  return <>{prompt(active)}
    <OfficeShell title={effectiveTitle} breadcrumbs={[{ label: t(kind === "local" ? "local" : "title") }]} saveCoordinator={session.coordinator} saveStatus={featureOff ? "ready" : undefined} editorReady={active && ready && session.canSave}
      saveDestination={session.localHandle ? "local" : "cloud"}
      actions={<DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={tOffice("ribbon.more")} title={tOffice("ribbon.more")} data-office-document-menu />}>
          <MoreIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {kind === "local" ? <DropdownMenuGroup aria-label={tAi("entry")} className="p-1 [&>button]:w-full [&>button]:justify-start"><LockedAiEntry signedIn={signedIn} onSignIn={onSignIn} /></DropdownMenuGroup> : null}
          {ready && session.canSave && session.localHandle ? <DropdownMenuItem className="gap-2 px-2 py-2" disabled={saveState === "saving"} onClick={() => { void saveAs(); }}>{t("saveAs")}</DropdownMenuItem> : null}
          {ready && (format === "md" || format === "html") ? <DropdownMenuItem className="gap-2 px-2 py-2" onClick={() => { void printText(); }}>{tOffice("markdown.print.title")}</DropdownMenuItem> : null}
          <DropdownMenuItem className="gap-2 px-2 py-2" onClick={onBack}>{kind === "local" ? tLocal("home") : t("back")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
      editor={<>
        {recovered ? <p role="status" className="mb-3 text-caption text-muted-foreground">{t("draftRecovered")}</p> : null}
        {notice ? <RecoveryNotice state={notice} className="mb-3" /> : null}
        {actionFailed ? <p role="alert" className="mb-3 text-caption text-destructive">{t("actionError")}</p> : null}
        {featureOff ? <FeatureOffNotice formatName={tOffice(`formatName.${format}`, { defaultValue: format.toUpperCase() })} className="mx-4 my-2" /> : null}
        {/* The shell header is the only frame: neutralize the shared EditorSlot card so the editor fills the page like DOCX/XLSX (web has no card either). A read-only message is a notice, not the editor: it keeps its margin and its own height so the read-only surface below sits right under it. */}
        {featureOff && !current?.failure ? null : <EditorSlot className={readOnlyMessage ? "flex-none rounded-none border-0 bg-transparent px-4 py-2" : "rounded-none border-0 bg-transparent p-0"} format={format} host={host} editorHandle={session.editor} capability={current?.failure ? { ...capability, status: "available" } : capability} openState={current?.failure ? "error" : ready ? "ready" : "loading"} openError={current?.failure?.message} onRetry={() => { setLoaded(null); setOpenAttempt((value) => value + 1); }} loadEditor={loadEditor} />}
        {session.editor.renderSurface && ready && !session.canSave ? <section className="flex min-h-0 flex-1 flex-col" aria-label={effectiveTitle} data-testid="readonly-surface">{session.editor.renderSurface?.()}</section> : null}
      </>} /></>;
}

/** The PPTX tab shell: the shared PptxEditorView mounts the deck canvas and
 * the same save coordinator that DOCX uses (upload + Documents version
 * commit). The editor handle and the opened deck come from the desktop pptx
 * surface; main still owns every file and cloud write. Every edit port the
 * desktop surface supports is bound here - a port with no implementation stays
 * unbound so the editor disables it honestly. */
function OpenPptxDocument({ bridge, identity, session, title, onBack, active = true, kind = "cloud" }: {
  bridge: RendererBridge; identity: OfficeIdentity; session: PptxDocumentSession; title: string; onBack: () => void;
  active?: boolean; kind?: "local" | "cloud"; signedIn?: boolean; onSignIn?: () => void; onLocalFileRebound?: (file: { handleId: string; displayName: string }) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(0);
  const [revision, setRevision] = useState(() => session.editor.revision());
  const [openAttempt, setOpenAttempt] = useState(0);
  // Restore replays the draft journal onto the opened deck and publishes a new
  // revision through the coordinator, so no surface remount is needed here.
  const { prompt, notice, recovered } = useDraftRecovery(session);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    void session.openEditor().then(() => { if (alive) setReady(true); }).catch((error: unknown) => { if (alive) setFailure(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [active, session, openAttempt]);
  // The desktop adapter publishes a fresh revision on every edit/undo/redo/restore
  // and reports each one to the shared coordinator, so the coordinator's own
  // notification is the signal that the model moved.
  useEffect(() => session.coordinator.subscribe(() => setRevision(session.editor.revision())), [session]);
  useEffect(() => bridge.onOfficeSaveRequested?.((event) => { if (active && ready && session.canSave && event.documentId === identity.documentId) void session.coordinator.save("menu"); }), [active, bridge, identity.documentId, ready, session]);
  const capability = useMemo(() => ({ format: "pptx" as const, operation: "serialize", host: "desktop", engineBuild: desktopEngineBuild("pptx"), contractRevision: "office-editor-host/1", status: session.canSave ? "available" as const : "readonly" as const, fidelityWarnings: [] }), [session]);
  const host = useMemo<OfficeHost>(() => ({
    read: { readDocument: async () => (await session.editor.captureSnapshot()).value as never, openDocument: async () => ({ outcome: "opened", document_id: identity.documentId, document_model_ref: identity.documentId, warnings: [] }) },
    write: { writeOutput: async () => { throw new Error("use_save_coordinator"); } },
    assets: { resolveFont: async () => null, resolveImage: async () => null, resolveAsset: async () => null },
    ipc: { call: async () => { throw new Error("host_operation_unbound"); }, send: () => undefined, subscribe: () => () => undefined },
  }), [identity.documentId, session]);
  // `revision` is a dependency so an edit/undo/redo/restore rebuilds the deck the
  // canvas keys its rendition cache on; the model object identity is stable across
  // mutations, so a [session]-only memo would never see the change. `ready` is one
  // too: deck()/slides() are empty until openEditor() resolves and opening does not
  // bump the revision, so without it the first open would keep the pre-open (empty) read.
  const deck = useMemo(() => {
    void ready;
    const model = session.editor.deck();
    // No deck before the open resolves: an empty object would make the editor
    // treat the canvas as deck-bound and pull the render artifact early.
    return model ? { deck: model, revision } : undefined;
  }, [ready, revision, session]);
  const slides = useMemo(() => {
    // A slide-structure edit (add/delete/reorder) must refresh the rail, so the
    // published revision participates even though the list itself reads the model.
    void revision;
    void ready;
    return session.editor.slides().map((slide, index) => ({ id: slide.id, label: String(index + 1), hidden: slide.hidden }));
  }, [ready, revision, session]);

  // Edit ports -> the adapter's typed edit channel (never a second write path).
  const commitText = useCallback((commit: { slideIndex: number; elementId: string; paragraphs: PptxParagraphLike[] }) =>
    session.editor.edit([{ op: "edit_text", slideIndex: commit.slideIndex, elementId: commit.elementId, paragraphs: commit.paragraphs }]), [session]);
  const transform = useCallback((request: SlidesEditTransformRequest) => {
    if (!request.sourceId) throw new Error("pptx_transform_needs_element");
    return session.editor.edit([{
      op: "edit_transform",
      slideIndex: request.slideIndex,
      elementId: request.sourceId,
      xPx: request.xPx,
      yPx: request.yPx,
      wPx: request.wPx,
      hPx: request.hPx,
      ...(request.rotationDeg === undefined ? {} : { rotationDeg: request.rotationDeg }),
      ...(request.fitWidthPx == null ? {} : { fitWidthPx: request.fitWidthPx }),
    }]);
  }, [session]);
  const applyEdit = useCallback((edit: PptxEdit | FormatEdit) => session.editor.edit([edit]), [session]);
  const deleteElements = useCallback((slideIndex: number, elementIds: readonly string[]) =>
    session.editor.edit(elementIds.map((elementId) => ({ op: "delete_element" as const, slideIndex, elementId }))), [session]);

  // The prompt waits for the deck: Recover replays the journal onto the opened model.
  return <>{prompt(active && ready)}
    {recovered ? <p role="status" className="px-4 py-2 text-caption text-muted-foreground">{t("draftRecovered")}</p> : null}
    {notice ? <RecoveryNotice state={notice} className="mx-4 my-2" /> : null}
    <PptxEditorView
    title={title}
    host={host}
    editorHandle={session.editor}
    capability={capability}
    openState={failure ? "error" : ready ? "ready" : "loading"}
    openError={failure ?? undefined}
    onRetry={() => { setFailure(null); setOpenAttempt((value) => value + 1); }}
    deck={deck}
    slides={slides}
    selectedIndex={selected}
    onSlideSelect={setSelected}
    onCommitText={commitText}
    onTransform={transform}
    onApplyEdit={applyEdit}
    onDeleteElements={deleteElements}
    // X4fix F2: no main-owned PDF/print path exists yet (no printToPDF handler,
    // no host:pdf-save in the IPC allowlist), so Print and Export PDF are hidden
    // here rather than run through an unverified iframe print in the sandbox.
    printPort={null}
    saveCoordinator={session.coordinator}
    saveDestination={session.localHandle ? "local" : "cloud"}
    breadcrumbs={[{ label: t(kind === "local" ? "local" : "title") }]}
    fullscreen={false}
  /></>;
}
