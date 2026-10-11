"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the editor landmark owns document shortcuts */

/**
 * HtmlEditor — the HTML document surface (task H2).
 *
 * It is the open/save/lifecycle host around `HtmlVisualShell` (view modes,
 * zoom, status bar, H3-H8 slots). The open handshake, the read-only decision,
 * the save coordinator, the section-level shortcuts and the asset-manifest
 * panel are the SAME contract the shared `SourceEditor` established; only the
 * canvas is different, so the HTML surface can offer source / split / preview /
 * present while Markdown keeps the two-pane editor.
 *
 * Chrome ownership: the shared UNI-931 ribbon (task RB) draws the tab row, the
 * command body and the Source | Split | Preview | Present control; the shared
 * save cluster (UNI-930) draws Save. Neither is re-implemented here.
 *
 * The preview mounts only through the injected `IsolatedPreviewPort`; this file
 * builds no iframe policy and weakens none.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { OfficeTooLargeNotice, openFailureClassOf } from "../too-large-notice";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { assetManifestRows, hasFailedAsset, type AssetManifestLike, type AssetStatus } from "../asset-manifest";
import type { TextEditorHandle, TextViewState } from "../source-editor-types";
import { canStepHistory, stepHistory } from "../common/history-step";
import { OfficeFrame } from "../frame";
import { HeaderActionsFill } from "../../layout/header-actions-slot";
import { MarkdownPrintMenuItems, MarkdownPrintShortcut } from "../markdown/wysiwyg/print-menu";
import { PrintNotice, usePrintNotice } from "../markdown/wysiwyg/print-notice";
import { createBrowserPrintPort } from "../print";
import { HtmlFind, type HtmlFindHandle } from "./find";
import { HtmlRibbon } from "./ribbon";
import { HtmlStatusBar } from "./status-bar";
import { HtmlVisualShell } from "./visual/shell";
import { useHtmlVisualEdit } from "./visual/use-visual-edit";
import type { HtmlSourceSelection } from "./source";
import { HTML_ZOOM_DEFAULT, nextViewMode, type HtmlViewMode } from "./visual/shell-model";
import type { HtmlEditorProps, HtmlOpenOutcome } from "./types";
import { useOfficeDocumentActiveRef } from "../common/document-active";

function failureFor(documentKey: string, error: unknown): Extract<HtmlOpenOutcome, { outcome: "failed" }> {
  return {
    outcome: "failed",
    document_id: documentKey,
    format: "html",
    failure_class: openFailureClassOf(error),
    message: error instanceof Error ? error.message : String(error),
  } as Extract<HtmlOpenOutcome, { outcome: "failed" }>;
}

function sourceText<TSnapshot>(editor: TextEditorHandle<TSnapshot>, fallback: string): string {
  if (editor.source) return editor.source.getText();
  if (editor.getText) return editor.getText();
  return fallback;
}

function sourceManifest<TSnapshot>(editor: TextEditorHandle<TSnapshot>, fallback: AssetManifestLike | null): AssetManifestLike {
  return editor.getAssetManifest?.() ?? fallback ?? { entries: [] };
}

function canWrite<TSnapshot>(editor: TextEditorHandle<TSnapshot>): boolean {
  return Boolean(editor.source?.setText || editor.setText);
}

function statusLabel(status: AssetStatus, t: (key: string) => string): string {
  if (status === "ready") return t("asset.ready");
  if (status === "missing") return t("asset.missing");
  if (status === "unauthorised") return t("asset.unauthorised");
  return t("asset.failed");
}

/** Every row the asset panel would show: manifest entries plus host failures. */
function assetPanelRows(manifest: AssetManifestLike, failures?: Readonly<Record<string, AssetStatus | boolean>>) {
  const rows = assetManifestRows(manifest);
  const extra = Object.entries(failures ?? {}).map(([path, status]) => ({
    path,
    assetId: null,
    status: status === true || status === false ? "failed" as const : status,
    reason: null,
  }));
  return [...rows, ...extra];
}

function AssetManifestPanel({ rows }: { rows: ReturnType<typeof assetPanelRows> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
  return (
    <ul className="divide-y divide-border" data-testid="asset-manifest">
      {rows.map((row, index) => (
        <li className="flex min-w-0 items-center justify-between gap-2 px-3 py-2 text-caption" key={`${row.path}-${index}`}>
          <span className="min-w-0 truncate font-mono" title={row.path}>{row.path}</span>
          <span className={cn("shrink-0", row.status === "ready" ? "text-muted-foreground" : "text-destructive")}>
            {row.assetId ?? statusLabel(row.status, t)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The web host's print path when the host injects none (same as Markdown). */
const browserPrintPort = createBrowserPrintPort();

/** The HTML document surface: lifecycle + the view shell. */
export function HtmlEditor<TSnapshot = unknown>({
  documentKey,
  editor,
  open,
  coordinator,
  capability,
  preview,
  manifest: manifestProp,
  assetFailures,
  permissions = {},
  title,
  className,
  printPort,
  visualEdit,
  onOpen,
}: HtmlEditorProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
  const [viewState, setViewState] = useState<TextViewState>("opening");
  const [failure, setFailure] = useState<Extract<HtmlOpenOutcome, { outcome: "failed" }> | null>(null);
  const [text, setText] = useState("");
  const [manifest, setManifest] = useState<AssetManifestLike>(() => sourceManifest(editor, manifestProp ?? null));
  const [coordinatorState, setCoordinatorState] = useState(() => coordinator.getState());
  const [viewMode, setViewMode] = useState<HtmlViewMode>("split");
  const [zoom, setZoom] = useState(HTML_ZOOM_DEFAULT);
  const [sourceSelection, setSourceSelection] = useState<HtmlSourceSelection | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const disposedRef = useRef(false);
  // The editor landmark owns the mode shortcut. A mode change can unmount the
  // pane that held focus (source -> preview), which drops focus to <body> and
  // makes the NEXT press miss the section handler entirely - the visual
  // report of "Ctrl+backslash from Preview needs two presses". Remember whether
  // the press came from inside the landmark and take focus back when it did.
  const rootRef = useRef<HTMLElement | null>(null);
  const findRef = useRef<HtmlFindHandle>(null);
  const restoreFocusRef = useRef(false);
  const savedGenerationRef = useRef(0);
  const editorRef = useRef(editor);
  const openRef = useRef(open);
  const coordinatorRef = useRef(coordinator);
  const capabilityRef = useRef(capability);
  const manifestPropRef = useRef(manifestProp);
  const onOpenRef = useRef(onOpen);
  const translateRef = useRef(t);
  editorRef.current = editor;
  openRef.current = open;
  coordinatorRef.current = coordinator;
  capabilityRef.current = capability;
  manifestPropRef.current = manifestProp;
  onOpenRef.current = onOpen;
  translateRef.current = t;

  const effectiveTitle = title ?? t("title");
  const readOnly = capability?.operation !== "serialize" || capability.status !== "available" || !canWrite(editor);
  const saving = coordinatorState.state === "saving";
  const blockedAsset = hasFailedAsset(manifest, assetFailures);
  // M-2/F9: the rows the asset band would draw. An empty manifest draws no
  // band at all, so the surface never stacks a second full-width row above the
  // status bar.
  const assetRows = assetPanelRows(manifest, assetFailures);
  // M-8: the generation the coordinator last committed. A checkpoint request
  // must never write a draft for content a successful save already cleared, or
  // reopening the document right after a save offers a stale draft.
  savedGenerationRef.current = coordinatorState.lastSavedGeneration;

  useEffect(() => {
    setCoordinatorState(coordinator.getState());
    return coordinator.subscribe(setCoordinatorState);
  }, [coordinator, documentKey]);

  useEffect(() => {
    const port = editor.source;
    if (!port?.subscribe) return undefined;
    return port.subscribe((next) => setText(next));
  }, [editor, documentKey]);

  useEffect(() => {
    const activeEditor = editorRef.current;
    const activeOpen = openRef.current;
    const activeCoordinator = coordinatorRef.current;
    const activeCapability = capabilityRef.current;
    const activeOnOpen = onOpenRef.current;
    const translate = translateRef.current;
    const controller = new AbortController();
    disposedRef.current = false;
    setViewState("opening");
    setFailure(null);
    setText("");
    setManifest(sourceManifest(activeEditor, manifestPropRef.current ?? null));

    const run = async () => {
      // A readonly row opens the document read-only (view-only member): `readOnly` above keeps every edit and Save closed.
      if (activeCapability?.operation !== "serialize" || (activeCapability.status !== "available" && activeCapability.status !== "readonly") || !canWrite(activeEditor)) {
        const blocked = failureFor(documentKey, new Error(activeCapability?.reason ?? translate("capabilityUnavailable")));
        setFailure(blocked);
        setViewState("error");
        activeOnOpen?.(blocked);
        return;
      }
      try {
        const outcome = await activeOpen.open(controller.signal);
        if (controller.signal.aborted || disposedRef.current) return;
        activeOnOpen?.(outcome);
        if (outcome.outcome === "failed") {
          setFailure(outcome);
          setViewState("error");
          return;
        }
        await activeEditor.open();
        if (controller.signal.aborted || disposedRef.current) return;
        setText(sourceText(activeEditor, ""));
        setManifest(sourceManifest(activeEditor, manifestPropRef.current ?? null));
        setViewState("ready");
      } catch (error) {
        if (controller.signal.aborted || disposedRef.current) return;
        const next = failureFor(documentKey, error);
        setFailure(next);
        setViewState("error");
        activeOnOpen?.(next);
      }
    };
    void run();
    return () => {
      disposedRef.current = true;
      controller.abort();
      void activeEditor.cancel?.("document_changed");
      void activeCoordinator.cancel?.();
      void activeEditor.dispose();
    };
  }, [documentKey, retryToken, capability?.operation, capability?.status]);

  const markDirty = useCallback(() => coordinator.markDirty?.(editorRef.current.getDirtyGeneration()), [coordinator]);
  // H1 suppresses the IME window itself, so no composition gate is needed here
  // (the earlier composingRef was never assigned).
  const checkpoint = useCallback(() => {
    // A save already committed this generation: checkpointing here would
    // recreate the draft the successful save just cleared, and the next open
    // would offer it back (M-8).
    if (editorRef.current.getDirtyGeneration() <= savedGenerationRef.current) return;
    void coordinatorRef.current.checkpoint?.();
  }, []);
  // H1 reports a committed edit through onChange AND onCheckpoint; checkpointing
  // here too would double every save checkpoint.
  const onTextChange = useCallback((next: string) => {
    if (editorRef.current.source) editorRef.current.source.setText(next);
    else editorRef.current.setText?.(next);
    setText(next);
    markDirty();
  }, [markDirty]);
  const save = useCallback((entryPoint: "button" | "shortcut") => {
    if (viewState === "ready" && !readOnly && !blockedAsset && !saving) void coordinator.save(entryPoint);
  }, [blockedAsset, coordinator, readOnly, saving, viewState]);
  const history = useCallback((kind: "undo" | "redo") => {
    // An empty stack is not a change: no dirty mark, no checkpoint (UNI-954).
    if (!stepHistory(editorRef.current, kind)) return;
    setText(sourceText(editorRef.current, ""));
    markDirty();
    checkpoint();
  }, [checkpoint, markDirty]);
  // The visual editor (H5-H8) is behind the office_html_visual_edit flag AND an
  // injected host; an applied op re-reads the source the way an undo does.
  const readEngineText = useCallback(() => sourceText(editorRef.current, ""), []);
  const onVisualApplied = useCallback(() => {
    setText(readEngineText());
    markDirty();
    checkpoint();
  }, [checkpoint, markDirty, readEngineText]);
  const visual = useHtmlVisualEdit({ host: visualEdit, text, readOnly, presenting: viewMode === "present", readText: readEngineText, onApplied: onVisualApplied });
  const cycleView = useCallback(() => {
    // A mode change can unmount the pane that held focus, and the preview
    // iframe or a click on the canvas can leave focus outside the landmark
    // entirely. Ask for the landmark back unconditionally; the effect below
    // only moves focus when it actually fell out.
    restoreFocusRef.current = true;
    setViewMode((mode) => nextViewMode(mode));
  }, []);
  // The ribbon's trailing Find affordance (C6) opens the panel through this
  // handle; Ctrl+F / Ctrl+H are owned by HtmlFind itself.
  const openFind = useCallback(() => findRef.current?.open(false), []);
  // UNI-928 print parity: the source IS HTML, so the "render" step is the
  // source itself - `sanitizePrintCopy` (scripts: false) then builds the
  // script-free preview copy handed to the port.
  const renderPrintHtml = readEngineText;
  const printNotice = usePrintNotice();
  // After the mode settles, return focus to the landmark when the pane that
  // held it is gone, so one press moves one mode from every mode (C11).
  useEffect(() => {
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const root = rootRef.current;
    if (!root) return;
    // The preview iframe lives inside the landmark but is a focus boundary:
    // keys typed in its own document never reach the section, so it does NOT
    // count as "the landmark holds focus".
    if (root.contains(document.activeElement) && !(document.activeElement instanceof HTMLIFrameElement)) return;
    root.focus();
  }, [viewMode]);
  // The preview pane is a sandboxed iframe. Once it owns keyboard focus, a
  // keydown is delivered inside its own document and never reaches this
  // window, so both the section handler and the window listener miss it and
  // the FIRST press from Preview is lost (M-7 r2). Reclaim the landmark the
  // moment focus lands on the preview frame, so the shortcut owner never
  // loses the keyboard and one press always advances one mode.
  //
  // Known limit (M-7 r3): a real mouse click into the sandboxed preview fires
  // no focusin here - the parent only sees a window `blur` - and keys typed in
  // that frame never reach this window. There is deliberately NO blur reclaim:
  // Ctrl+C copies from the focused frame, so taking focus back would make a
  // preview selection uncopyable. After such a click, Ctrl+\ needs focus back
  // on the editor first (click the ribbon/canvas chrome, or Shift+Tab).
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) return;
      if (!(target instanceof HTMLIFrameElement) || !root.contains(target)) return;
      root.focus();
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, []);
  // The section owns Ctrl+\ only while focus is inside it. When focus sits
  // outside the landmark (the preview iframe, the present overlay, a canvas
  // click) the keydown never reaches the section and the press is lost, so the
  // cycle appears to need two presses. This window listener covers exactly that
  // gap; a press inside the landmark still runs the section handler alone.
  // UNI-957: only the visible document's window listener may cycle its view.
  const documentActiveRef = useOfficeDocumentActiveRef();
  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!documentActiveRef.current) return;
      if (!(event.metaKey || event.ctrlKey) || event.code !== "Backslash") return;
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      event.preventDefault();
      cycleView();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [cycleView, documentActiveRef]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.code === "Backslash") {
      // Ctrl+\ cycles source -> split -> preview -> present -> source (C11).
      event.preventDefault();
      cycleView();
      return;
    }
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save("shortcut");
      return;
    }
    if (mod && event.key.toLowerCase() === "c") {
      // A denied permission still blocks the gesture; CodeMirror owns the
      // native clipboard write otherwise.
      if (permissions.canCopy === false) event.preventDefault();
      return;
    }
    if (mod && event.key.toLowerCase() === "v") {
      if (permissions.canPaste === false) event.preventDefault();
      return;
    }
    if (mod && !event.nativeEvent.isComposing) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        history(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (key === "y") {
        event.preventDefault();
        history("redo");
      }
    }
  }, [cycleView, history, permissions.canCopy, permissions.canPaste, save]);

  const presenting = viewMode === "present";
  // The ribbon models the three inline modes; present is its own toggle.
  const ribbonViewMode = viewMode === "present" ? "preview" : viewMode;
  // RBF-2: stable identities. A fresh `commands` object or inline closures made
  // the ribbon rebuild its tab/quick-access/trailing memos on every keystroke.
  const ribbonCommands = useMemo(() => ({ onUndo: () => history("undo"), onRedo: () => history("redo") }), [history]);
  const onRibbonViewModeChange = useCallback((mode: "source" | "split" | "preview") => setViewMode(mode), []);
  const onTogglePresent = useCallback(() => setViewMode((mode) => (mode === "present" ? "preview" : "present")), []);

  return (
    <section
      ref={rootRef}
      className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}
      data-testid="html-editor"
      data-document-key={documentKey}
      onKeyDown={onKeyDown}
      role="application"
      aria-label={effectiveTitle}
      tabIndex={0}
    >
      {viewState === "ready" ? (
        <OfficeFrame
          ribbon={
            /*
              The shared UNI-931 ribbon (RB-1) is the HTML surface's chrome: the
              tab row, the command body and the trailing
              Source | Split | Preview | Present control. Undo/redo ride its
              quick-access slot and the view modes its trailing control. The
              inline/insert intents stay disabled until an H3-op-wired caller
              supplies `commands`, which is the documented contract of
              `HtmlRibbon` - disabled, never hidden. Save is NOT here: the page
              header cluster owns it (F2).
            */
            <HtmlRibbon
              commands={ribbonCommands}
              state={{ readOnly, canUndo: canStepHistory(editor, "undo"), canRedo: canStepHistory(editor, "redo") }}
              onFind={openFind}
              viewMode={ribbonViewMode}
              onViewModeChange={onRibbonViewModeChange}
              presenting={presenting}
              onTogglePresent={onTogglePresent}
            />
          }
          bottom={
            // F9: ONE band. With no asset rows and no failures the aside is
            // absent entirely, so the status bar is the only full-width row
            // under the canvas instead of a second empty one.
            assetRows.length === 0 ? undefined : (
              <aside className="max-h-40 shrink-0 overflow-auto border-t border-border bg-office-band" aria-label={t("asset.label")} data-testid="html-assets">
                <AssetManifestPanel rows={assetRows} />
                {blockedAsset ? <p className="px-3 pb-3 text-caption text-destructive" role="alert">{t("asset.saveBlocked")}</p> : null}
              </aside>
            )
          }
          /*
            F1/F8: the status bar lives in the frame's own `statusBar` slot, so
            it is the bottom-most row - BELOW the assets `bottom` slot - and the
            `?` help affordance is part of the surface. Present mode is chrome-
            free, so the bar is suppressed while presenting.
          */
          statusBar={
            presenting ? undefined : (
              <HtmlStatusBar
                text={text}
                selection={viewMode === "preview" ? null : sourceSelection}
                zoom={zoom}
                onZoomChange={setZoom}
                zoomDisabled={viewMode === "source"}
                // F9: with the assets strip above, the two rows share ONE band;
                // only the strip keeps the top separator.
                joinedBand={assetRows.length > 0}
              />
            )
          }
          subbar={
            /*
              UNI-928: the shared FindReplacePanel docks here, in the frame's
              full-width `subbar` row (the slot OfficeFrame documents for a
              "find bar"), so it can never cover the page header. It renders
              NOTHING while closed, so no empty chrome row is drawn.
            */
            <HtmlFind
              ref={findRef}
              handle={editor}
              editable={!readOnly}
              onChange={onTextChange}
              onCheckpoint={checkpoint}
            />
          }
          canvasClassName="flex min-h-0 flex-col overflow-hidden"
        >
          {/* UNI-928: print rides the page overflow menu (C4), like Markdown;
              with no injected port the shared browser port prints. */}
          <HeaderActionsFill menuItems={<MarkdownPrintMenuItems port={printPort ?? browserPrintPort} renderHtml={renderPrintHtml} title={effectiveTitle} onStart={printNotice.onStart} onOutcome={printNotice.onOutcome} />} />
          <MarkdownPrintShortcut port={printPort ?? browserPrintPort} renderHtml={renderPrintHtml} title={effectiveTitle} onStart={printNotice.onStart} onOutcome={printNotice.onOutcome} />
          <PrintNotice notice={printNotice.notice} />
          <HtmlVisualShell
            documentKey={documentKey}
            text={text}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            readOnly={readOnly}
            onChange={onTextChange}
            onCheckpoint={checkpoint}
            onSourceSelectionChange={setSourceSelection}
            preview={preview}
            manifest={manifest}
            title={effectiveTitle}
            zoom={zoom}
            className="min-h-0 flex-1"
            {...visual}
          />
        </OfficeFrame>
      ) : viewState === "error" && failure ? failure.failure_class === "too_large" ? <OfficeTooLargeNotice format="html" /> : (
        <Alert className="m-3" variant="destructive" role="alert" data-testid="html-error-state">
          <AlertTitle>{t("errors.title")}</AlertTitle>
          <AlertDescription>{failure.message ?? t("errors.unknown")}</AlertDescription>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => setRetryToken((value) => value + 1)}>{t("actions.retry")}</Button>
        </Alert>
      ) : (
        <div className="flex min-h-64 flex-1 items-center justify-center text-body text-muted-foreground" role="status" data-testid="html-opening">{t("state.opening")}</div>
      )}
    </section>
  );
}

export type { HtmlEditorProps } from "./types";
