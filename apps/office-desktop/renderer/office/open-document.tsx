import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import type { PptxDocumentSession } from "./pptx-session";
import { PptxEditorView, type PptxDeckModel } from "@uniwork/views/office/pptx";
import type { FormatEdit, PptxEdit, PptxParagraphLike } from "@uniwork/office-engine/pptx";
import type { SlidesEditTransformRequest } from "@uniwork/office-contracts";
import { DOCX_DESKTOP_ENGINE_BUILD } from "./docx-surface";
import { PPTX_DESKTOP_ENGINE_BUILD } from "./pptx-surface";

/** Format dispatcher: a tab's session already knows its format, so the DOCX
 * byte shell and the PPTX deck shell each stay typed to their own session. */
export function OpenByteDocument(props: {
  bridge: RendererBridge; identity: OfficeIdentity; session: ByteDocumentSession | PptxDocumentSession; title: string; onBack: () => void;
  active?: boolean; kind?: "local" | "cloud"; signedIn?: boolean; onSignIn?: () => void; onLocalFileRebound?: (file: { handleId: string; displayName: string }) => void;
}) {
  const { session, ...rest } = props;
  return session.editor.format === "pptx"
    ? <OpenPptxDocument {...rest} session={session as PptxDocumentSession} />
    : <OpenDocxDocument {...rest} session={session as ByteDocumentSession} />;
}

function OpenDocxDocument({ bridge, identity, session, title, onBack, active = true, kind = "cloud", signedIn = false, onSignIn, onLocalFileRebound }: { bridge: RendererBridge; identity: OfficeIdentity; session: ByteDocumentSession; title: string; onBack: () => void; active?: boolean; kind?: "local" | "cloud"; signedIn?: boolean; onSignIn?: () => void; onLocalFileRebound?: (file: { handleId: string; displayName: string }) => void }) {
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
      saveDestination={session.localHandle ? "local" : "cloud"}
      actions={<>{kind === "local" ? <LockedAiEntry signedIn={signedIn} onSignIn={onSignIn} /> : null}{ready && session.canSave && session.localHandle ? <Button type="button" variant="outline" size="sm" disabled={saveState === "saving"} onClick={() => { void saveAs(); }}>{t("saveAs")}</Button> : null}<Button type="button" variant="outline" size="sm" onClick={onBack}>{kind === "local" ? tLocal("home") : t("back")}</Button></>}
      editor={<>
        {recovered ? <p role="status" className="mb-3 text-caption text-muted-foreground">{t("draftRecovered")}</p> : null}
        {notice ? <RecoveryNotice state={notice} className="mb-3" /> : null}
        {actionFailed ? <p role="alert" className="mb-3 text-caption text-destructive">{t("actionError")}</p> : null}
        <EditorSlot format="docx" host={host} editorHandle={session.editor} capability={current?.failure ? { ...capability, status: "available" } : capability} openState={current?.failure ? "error" : ready ? "ready" : "loading"} openError={current?.failure?.message} onRetry={() => { setLoaded(null); setOpenAttempt((value) => value + 1); }} loadEditor={loadEditor} />
        {ready && !session.canSave ? <section className="flex min-h-0 flex-1 flex-col" aria-label={effectiveTitle} data-testid="docx-readonly-surface">{session.editor.renderSurface?.()}</section> : null}
      </>} /></>;
}

/** Plain text of every element on every slide of the opaque deck model; the
 * desktop find port only reads the documented `text.paragraphs[].runs[].text`
 * shape the render tree already consumes. */
function deckSlideTexts(deck: PptxDeckModel | null): string[] {
  if (!deck) return [];
  return deck.slides.map((slide) => {
    const elements = (slide as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) return "";
    return elements
      .map((element) => {
        const paragraphs = (element as { text?: { paragraphs?: unknown } }).text?.paragraphs;
        if (!Array.isArray(paragraphs)) return "";
        return paragraphs
          .map((paragraph) => {
            const runs = (paragraph as { runs?: unknown }).runs;
            if (!Array.isArray(runs)) return "";
            return runs.map((run) => (run as { text?: string }).text ?? "").join("");
          })
          .join("\n");
      })
      .join("\n");
  });
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
  const capability = useMemo(() => ({ format: "pptx" as const, operation: "serialize", host: "desktop", engineBuild: PPTX_DESKTOP_ENGINE_BUILD, contractRevision: "office-editor-host/1", status: session.canSave ? "available" as const : "readonly" as const, fidelityWarnings: [] }), [session]);
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
  // A real find port: jump to the first slide whose element text carries the query.
  const find = useCallback((query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const index = deckSlideTexts(session.editor.deck()).findIndex((text) => text.toLowerCase().includes(needle));
    if (index >= 0) setSelected(index);
  }, [session]);

  return <PptxEditorView
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
    onFind={find}
    saveCoordinator={session.coordinator}
    breadcrumbs={[{ label: t(kind === "local" ? "local" : "title") }]}
    fullscreen={false}
  />;
}
