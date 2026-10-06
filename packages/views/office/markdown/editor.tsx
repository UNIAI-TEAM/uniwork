"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the editor landmark owns document shortcuts */

/**
 * MarkdownEditor — the Markdown document surface (task M-WIRE).
 *
 * It is the open/save/lifecycle HOST around the M1 WYSIWYG canvas. The open
 * handshake, the capability gate, the read-only decision, the save coordinator
 * and the asset-manifest panel are the SAME contract the shared `SourceEditor`
 * established for this format; only the canvas is different, so the Markdown
 * surface can offer the visual editor while keeping the source textarea.
 *
 * Both canvases edit the ONE text source on the caller's `TextEditorHandle`:
 * the visual editor parses it on mount and publishes every edit back through
 * `source.setText`, and the textarea writes the same port, so a document that
 * is opened and saved without an edit keeps its exact bytes (front matter,
 * tables, fences, raw HTML, comments).
 *
 * Chrome ownership: the shared Markdown ribbon (M2/M3/M4, R8) draws the tab
 * row, the command body, the undo/redo quick access and the trailing
 * Source | Visual control (C11). The host owns the mode state, so the control
 * survives the visual canvas unmounting when source mode is showing. The save
 * cluster is the host's own row.
 *
 * The preview mounts only through the injected `IsolatedPreviewPort`; this file
 * builds no iframe policy and weakens none.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Clipboard, Copy, Redo2, Undo2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { assetManifestRows, hasFailedAsset, type AssetManifestLike, type AssetStatus } from "../asset-manifest";
import { OfficeFrame } from "../frame";
import { MarkdownStatusBar } from "./status-bar";
import { useMarkdownCaret } from "./use-caret-position";
import type { PreviewSession } from "../source-editor-types";
import { HeaderActionsFill } from "../../layout/header-actions-slot";
import { buildMarkdownPreviewCopy } from "@uniwork/office-engine/markdown";
import { MarkdownWysiwygEditor } from "./wysiwyg/editor";
import { MARKDOWN_NARROW_QUERY, MarkdownFindButton, MarkdownRibbon, MarkdownViewModeToggle } from "./wysiwyg/ribbon";
import { MarkdownSlash } from "./wysiwyg/slash";
import { MarkdownTableMenu } from "./wysiwyg/table-menu";
import { MarkdownFind, type MarkdownFindHandle } from "./wysiwyg/find";
import { MarkdownOutlinePane } from "./wysiwyg/outline";
import { MarkdownFrontmatterPanel } from "./wysiwyg/frontmatter";
import { MarkdownPrintMenuItems } from "./wysiwyg/print-menu";
import type { MarkdownPrintPort } from "./wysiwyg/print";
import type { MarkdownEditorProps, MarkdownOpenOutcome } from "./types";

/** The two canvases the surface switches between. Visual is the demo default. */
type MarkdownViewMode = "visual" | "source";

function failureFor(documentKey: string, error: unknown): Extract<MarkdownOpenOutcome, { outcome: "failed" }> {
  return {
    outcome: "failed", document_id: documentKey, format: "md", failure_class: "engine_error",
    message: error instanceof Error ? error.message : String(error),
  } as Extract<MarkdownOpenOutcome, { outcome: "failed" }>;
}

function sourceText<TSnapshot>(editor: MarkdownEditorProps<TSnapshot>["editor"], fallback: string): string {
  if (editor.source) return editor.source.getText();
  if (editor.getText) return editor.getText();
  return fallback;
}

function sourceManifest<TSnapshot>(editor: MarkdownEditorProps<TSnapshot>["editor"], fallback: AssetManifestLike | null): AssetManifestLike {
  return editor.getAssetManifest?.() ?? fallback ?? { entries: [] };
}

function canWrite<TSnapshot>(editor: MarkdownEditorProps<TSnapshot>["editor"]): boolean {
  return Boolean(editor.source?.setText || editor.setText);
}

/**
 * The web host's print path for this surface (M8: the view calls the INJECTED
 * port, never `window.print()`). The sanitized copy goes into an off-screen
 * frame and only that frame prints, so app chrome never reaches the job.
 */
const browserPrintPort: MarkdownPrintPort = {
  print({ html, title }) {
    if (typeof document === "undefined") return { outcome: "failed", reason: "no_dom" };
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true"); frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.append(frame);
    const view = frame.contentWindow;
    if (!view?.document) { frame.remove(); return { outcome: "failed", reason: "no_print_frame" }; }
    view.document.open(); view.document.write(html); view.document.close();
    view.document.title = title;
    try { view.focus(); view.print(); } catch { frame.remove(); return { outcome: "failed", reason: "print_blocked" }; }
    window.setTimeout(() => frame.remove(), 0); return { outcome: "printed" };
  },
};

function statusLabel(status: AssetStatus, t: (key: string) => string): string {
  if (status === "ready") return t("asset.ready");
  if (status === "missing") return t("asset.missing");
  if (status === "unauthorised") return t("asset.unauthorised");
  return t("asset.failed");
}

function AssetManifestPanel({ manifest, failures }: { manifest: AssetManifestLike; failures?: Readonly<Record<string, AssetStatus | boolean>> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown" });
  const rows = assetManifestRows(manifest);
  const extra = Object.entries(failures ?? {}).map(([path, status]) => ({
    path,
    assetId: null,
    status: status === true || status === false ? "failed" as const : status,
    reason: null,
  }));
  if (rows.length === 0 && extra.length === 0) {
    return <p className="p-3 text-caption text-muted-foreground" data-testid="asset-manifest-empty">{t("asset.empty")}</p>;
  }
  return (
    <ul className="divide-y divide-border" data-testid="asset-manifest">
      {[...rows, ...extra].map((row, index) => (
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

/** The Markdown document surface: lifecycle + the visual / source canvases. */
export function MarkdownEditor<TSnapshot = unknown>({
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
  onOpen,
}: MarkdownEditorProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.markdown" });
  const [viewState, setViewState] = useState<"opening" | "ready" | "error">("opening");
  const [failure, setFailure] = useState<Extract<MarkdownOpenOutcome, { outcome: "failed" }> | null>(null);
  const [text, setText] = useState("");
  const [manifest, setManifest] = useState<AssetManifestLike>(() => sourceManifest(editor, manifestProp ?? null));
  const [coordinatorState, setCoordinatorState] = useState(() => coordinator.getState());
  const [mode, setMode] = useState<MarkdownViewMode>("visual");
  const [instance, setInstance] = useState<Editor | null>(null);
  const [uploadFailures, setUploadFailures] = useState<Readonly<Record<string, AssetStatus>>>({});
  const [previewState, setPreviewState] = useState<"idle" | "ready" | "unavailable">("idle");
  const [retryToken, setRetryToken] = useState(0);
  // M6/M7 chrome state: the ribbon owns the toggles, the host owns the panes.
  const [outlineVisible, setOutlineVisible] = useState(false);
  const [frontmatterVisible, setFrontmatterVisible] = useState(false);
  // M-4: at phone width the ribbon's trailing slot is dropped and these two
  // controls move onto the frame's subbar, so the tab row stays tabs-only.
  const narrow = useMediaQuery(MARKDOWN_NARROW_QUERY);
  const sectionRef = useRef<HTMLElement>(null);
  const findRef = useRef<MarkdownFindHandle>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const caret = useMarkdownCaret(mode, instance, textAreaRef, viewState === "ready");
  const sourceWrapperRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewSessionRef = useRef<PreviewSession | null>(null);
  const latestTextRef = useRef(text);
  const latestManifestRef = useRef(manifest);
  const composingRef = useRef(false);
  const disposedRef = useRef(false);
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
  latestTextRef.current = text;
  latestManifestRef.current = manifest;

  const effectiveTitle = title ?? t("title");
  const readOnly = capability?.operation !== "serialize" || capability.status !== "available" || !canWrite(editor);
  const saving = coordinatorState.state === "saving";
  // A host-reported failure (prop) or a failed paste/drop upload (recorded here)
  // keeps the document unsavable; a failed asset MUST block Save.
  const failures = useMemo(
    () => ({ ...(assetFailures ?? {}), ...uploadFailures }),
    [assetFailures, uploadFailures],
  );
  const blockedAsset = hasFailedAsset(manifest, failures);
  // F9: the assets strip and the status row are ONE band. With no assets and no
  // failures the strip renders nothing at all (no empty row above the status
  // bar); with assets the two share one surface, so only the strip keeps the
  // top separator.
  const assetRowCount = assetManifestRows(manifest).length + Object.keys(failures).length;

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
    setPreviewState("idle");
    setText("");
    setManifest(sourceManifest(activeEditor, manifestPropRef.current ?? null));
    // Per-document UI state: a new document starts back in the visual canvas,
    // with no stale upload failures and no instance from the previous one.
    setMode("visual");
    setInstance(null);
    setUploadFailures({});
    setOutlineVisible(false);
    setFrontmatterVisible(false);

    const run = async () => {
      // The gate refuses an engine that cannot serialize, or a handle with no
      // write port. A `readonly` capability is NOT a failure: the document
      // still opens and renders, just with every edit affordance disabled.
      if (activeCapability?.operation !== "serialize" || activeCapability.status === "unavailable" || !canWrite(activeEditor)) {
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

  // The source pane's preview mounts only in source mode, through the injected
  // port; it never runs while the visual canvas owns the pane.
  useEffect(() => {
    const container = previewContainerRef.current;
    if (viewState !== "ready" || mode !== "source" || !container) return undefined;
    if (!preview) {
      setPreviewState("unavailable");
      return undefined;
    }
    let active = true;
    setPreviewState("idle");
    void (async () => {
      try {
        const session = await preview.mount({ container, format: "md", title: effectiveTitle, text: latestTextRef.current, manifest: latestManifestRef.current });
        if (!active || disposedRef.current) {
          session.dispose();
          return;
        }
        previewSessionRef.current = session;
        await session.update?.(latestTextRef.current, latestManifestRef.current);
        if (!active || disposedRef.current) {
          session.dispose();
          previewSessionRef.current = null;
          return;
        }
        setPreviewState("ready");
      } catch {
        if (active) setPreviewState("unavailable");
      }
    })();
    return () => {
      active = false;
      previewSessionRef.current?.dispose();
      previewSessionRef.current = null;
    };
  }, [effectiveTitle, mode, preview, viewState]);

  useEffect(() => {
    if (viewState !== "ready" || mode !== "source" || !previewSessionRef.current) return;
    try {
      const update = previewSessionRef.current.update?.(text, manifest);
      if (update && typeof (update as Promise<void>).catch === "function") void (update as Promise<void>).catch(() => setPreviewState("unavailable"));
    } catch {
      setPreviewState("unavailable");
    }
  }, [manifest, mode, text, viewState]);

  const markDirty = useCallback(() => coordinator.markDirty?.(editorRef.current.getDirtyGeneration()), [coordinator]);
  const checkpoint = useCallback(() => {
    if (!composingRef.current) void coordinatorRef.current.checkpoint?.();
  }, []);
  const writeText = useCallback((next: string) => {
    if (editorRef.current.source) editorRef.current.source.setText(next);
    else editorRef.current.setText?.(next);
    setText(next);
    markDirty();
  }, [markDirty]);
  const onTextChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    writeText(event.target.value);
    if (!(event.nativeEvent as InputEvent).isComposing) checkpoint();
  }, [checkpoint, writeText]);
  const onCompositionStart = useCallback((_event: CompositionEvent<HTMLTextAreaElement>) => { composingRef.current = true; }, []);
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    checkpoint();
  }, [checkpoint]);
  // The visual canvas publishes through the same text port; this only mirrors
  // the value into the host state and marks the document dirty. A canvas
  // transaction that leaves the bytes alone - a find/replace highlight paint,
  // or the first publish after mount - is NOT an edit: it must neither dirty
  // the document nor ask the coordinator for a checkpoint. Those transactions
  // carry `preventUpdate` (see `applyMarkdownFindHighlight`), so they never
  // reach `onWysiwygChange` at all; this identity check is the belt to that
  // braces and the flag the checkpoint guard keys on below.
  const wysiwygEditedRef = useRef(false);
  const onWysiwygChange = useCallback((next: string) => {
    wysiwygEditedRef.current = next !== latestTextRef.current;
    setText(next);
    if (wysiwygEditedRef.current) markDirty();
  }, [markDirty]);
  // The guard keys on "has a REAL user edit been published", never on "the
  // first checkpoint call seen": the mount-time publish is suppressed at the
  // source (see `applyMarkdownFindHighlight`), so a clean-mounting document
  // must not lose the checkpoint for its first real edit.
  const onWysiwygCheckpoint = useCallback(() => {
    if (wysiwygEditedRef.current) checkpoint();
  }, [checkpoint]);
  const onAssetFailure = useCallback((name: string, status: AssetStatus) => {
    setUploadFailures((current) => ({ ...current, [name]: status }));
  }, []);
  const image = useMemo(() => ({ manifest, onAssetFailure }), [manifest, onAssetFailure]);
  const save = useCallback((entryPoint: "button" | "shortcut") => {
    if (viewState === "ready" && !readOnly && !blockedAsset && !saving) void coordinator.save(entryPoint);
  }, [blockedAsset, coordinator, readOnly, saving, viewState]);
  const history = useCallback((kind: "undo" | "redo") => {
    if (kind === "undo") editorRef.current.undo?.();
    else editorRef.current.redo?.();
    setText(sourceText(editorRef.current, latestTextRef.current));
    markDirty();
    checkpoint();
  }, [checkpoint, markDirty]);
  const copySelection = useCallback(async () => {
    if (permissions.canCopy === false || !editorRef.current.clipboard?.writeText) return;
    const area = textAreaRef.current;
    const selected = area ? area.value.slice(area.selectionStart, area.selectionEnd) : "";
    if (selected.length === 0) return;
    await editorRef.current.clipboard.writeText(selected);
  }, [permissions.canCopy]);
  const pasteText = useCallback(async () => {
    if (permissions.canPaste === false || !editorRef.current.clipboard?.readText) return;
    const incoming = await editorRef.current.clipboard.readText();
    const area = textAreaRef.current;
    if (!area) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    writeText(area.value.slice(0, start) + incoming + area.value.slice(end));
    checkpoint();
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = start + incoming.length;
    });
  }, [checkpoint, permissions.canPaste, writeText]);
  // The ribbon's trailing Find affordance (C6) opens the panel through this
  // handle; Ctrl+F / Ctrl+H are owned by MarkdownFind itself.
  const openFind = useCallback(() => findRef.current?.open(false), []);
  // M8 print: render the CURRENT source through the engine's browser-safe
  // preview renderer, then let the sanitizer + port take over. Never the raw
  // source, never `window.print()`.
  const renderPrintHtml = useCallback(() => buildMarkdownPreviewCopy({ source: sourceText(editorRef.current, latestTextRef.current), document_path: "document.md" }), []);
  // m3: the section owns Ctrl+S only while focus is inside it; after the find
  // panel closes with Escape, focus falls to `document.body` and the press is
  // lost. This window listener covers that gap - a press inside the landmark is
  // skipped by the containment check AND by the section's `defaultPrevented`.
  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
      if (event.key.toLowerCase() !== "s" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Node && sectionRef.current?.contains(target)) return;
      save("shortcut");
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [save]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.code === "Backslash") {
      // Ctrl+\ toggles the two canvases (C11: Source | Visual).
      event.preventDefault();
      setMode((current) => (current === "visual" ? "source" : "visual"));
      return;
    }
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save("shortcut");
      return;
    }
    if (mod && event.key.toLowerCase() === "c") {
      // A denied permission still blocks the gesture; the visual canvas owns
      // the native clipboard write otherwise.
      if (permissions.canCopy === false) event.preventDefault();
      else if (mode === "source" && editorRef.current.clipboard?.writeText) { event.preventDefault(); void copySelection().catch(() => undefined); }
      return;
    }
    if (mod && event.key.toLowerCase() === "v") {
      if (permissions.canPaste === false) event.preventDefault();
      else if (mode === "source" && editorRef.current.clipboard?.readText) { event.preventDefault(); void pasteText().catch(() => undefined); }
      return;
    }
    // The visual canvas owns its own history (TipTap); intercepting Mod-Z here
    // would undo the same edit twice.
    if (mod && mode === "source" && !event.nativeEvent.isComposing) {
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
  }, [copySelection, history, mode, pasteText, permissions.canCopy, permissions.canPaste, save]);

  return (
    <section ref={sectionRef} className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)} data-testid="md-editor" data-document-key={documentKey} data-md-view={mode} onKeyDown={onKeyDown} role="application" aria-label={effectiveTitle} tabIndex={0}>
      {viewState === "ready" ? (
        <OfficeFrame
          ribbon={
            /*
              The shared Markdown ribbon draws the tabs, the command body and
              the Source | Visual control. The host owns the mode so the control
              stays reachable while the visual canvas is unmounted (source mode).
            */
            <MarkdownRibbon
              editor={instance}
              editable={!readOnly && mode === "visual"}
              viewMode={mode}
              onViewModeChange={setMode}
              onOutlineChange={setOutlineVisible}
              onFrontmatterChange={setFrontmatterVisible}
              outline={outlineVisible}
              frontmatter={frontmatterVisible}
              onFind={openFind}
              scope="markdown"
            />
          }
          subbar={
            /*
              F3: the source-mode clipboard controls live on the frame's
              full-width subbar row, NOT inside the canvas. The ribbon's quick
              access drives the VISUAL pane through the live TipTap instance,
              but the source pane has no instance - its undo, redo, copy and
              paste are the host's own snapshot stack and clipboard port, so
              they ride here where they stay reachable. The row renders only in
              source mode: C5 forbids an empty chrome row, and C9 forbids a
              command floating over the canvas, so the print/export entries
              live in the page overflow menu instead (see HeaderActionsFill).
            */
            mode === "source" || narrow ? (
              <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border px-2 py-1" data-testid="md-subbar" role="toolbar" aria-label={t("toolbar.label")}>
                {/* M-4: the ribbon drops its trailing slot at this width, so
                    Find and Source | Visual mount HERE - one live instance each. */}
                {narrow ? <MarkdownFindButton onFind={openFind} /> : null}
                {narrow ? <MarkdownViewModeToggle viewMode={mode} onViewModeChange={setMode} /> : null}
                {mode === "source" ? (
                  <>
                    <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.undo")} disabled={readOnly || saving} onClick={() => history("undo")}><Undo2 aria-hidden /></Button>
                    <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.redo")} disabled={readOnly || saving} onClick={() => history("redo")}><Redo2 aria-hidden /></Button>
                    <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.copy")} disabled={readOnly || saving || permissions.canCopy === false || !editor.clipboard?.writeText} onClick={() => void copySelection().catch(() => undefined)}><Copy aria-hidden /></Button>
                    <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.paste")} disabled={readOnly || saving || permissions.canPaste === false || !editor.clipboard?.readText} onClick={() => void pasteText().catch(() => undefined)}><Clipboard aria-hidden /></Button>
                  </>
                ) : null}
              </div>
            ) : undefined
          }
          bottom={
            assetRowCount > 0 ? (
              <aside className="max-h-40 shrink-0 overflow-auto border-t border-border bg-office-band" aria-label={t("asset.label")} data-testid="md-assets">
                <AssetManifestPanel manifest={manifest} failures={failures} />
                {blockedAsset ? <p className="px-3 pb-3 text-caption text-destructive" role="alert">{t("asset.saveBlocked")}</p> : null}
              </aside>
            ) : undefined
          }
          statusBar={<MarkdownStatusBar state={coordinatorState.state} mode={mode} readOnly={readOnly} joinedBand={assetRowCount > 0} text={viewState === "ready" ? text : null} caret={caret} />}
          canvasClassName="flex min-h-0 flex-col overflow-hidden"
        >
          {/* M-6/C4: print + export ride the page overflow menu, not a
              floating button over the canvas (C9). Renders nothing itself. */}
          <HeaderActionsFill menuItems={<MarkdownPrintMenuItems port={printPort ?? browserPrintPort} renderHtml={renderPrintHtml} title={effectiveTitle} />} />
          {/*
            M7 find/replace owns the panel, Ctrl+F (find-only), Ctrl+H (with
            replace) and Escape. It is mounted for BOTH canvases: the visual
            half searches the flattened document, the source half the textarea.
            It stays the surface's own overlay panel (the frame's subbar has no
            open state to drive).
          */}
          <MarkdownFind ref={findRef} editor={instance} handle={editor} mode={mode} editable={!readOnly} sourceTextarea={textAreaRef} sourceOverlayTarget={sourceWrapperRef} />
          <div className="flex min-h-0 flex-1">
            {outlineVisible ? <MarkdownOutlinePane editor={instance} className="max-h-full" /> : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {mode === "visual" ? (
                <>
                  {/* M3 slash menu + table context toolbar: both mount against
                      the live TipTap instance and render nothing until their
                      trigger fires - a typed `/`, or a selection in a table. */}
                  <MarkdownSlash editor={instance} />
                  <MarkdownTableMenu editor={instance} />
                  <MarkdownWysiwygEditor
                    documentKey={documentKey}
                    editor={editor}
                    editable={!readOnly}
                    onEditorReady={setInstance}
                    onChange={onWysiwygChange}
                    onCheckpoint={onWysiwygCheckpoint}
                    showRibbon={false}
                    image={image}
                    className="min-h-0 flex-1"
                    ariaLabel={effectiveTitle}
                  />
                </>
              ) : (
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-2">
                  <div className="flex min-h-64 min-w-0 flex-col gap-2">
                    <label className="text-label font-medium" htmlFor="md-source">{t("source.label")}</label>
                    {/* The wrapper holds ONLY the field: M7's source highlight
                        overlay is portaled here and must align to the textarea. */}
                    <div ref={sourceWrapperRef} className="relative flex min-h-64 flex-1 flex-col">
                      <textarea
                        ref={textAreaRef}
                        id="md-source"
                        className="min-h-64 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-body leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        value={text}
                        readOnly={readOnly}
                        spellCheck={false}
                        onChange={onTextChange}
                        onCompositionStart={onCompositionStart}
                        onCompositionEnd={onCompositionEnd}
                        data-testid="md-source"
                        aria-label={t("source.label")}
                      />
                    </div>
                  </div>
                  <div className="flex min-h-64 min-w-0 flex-col gap-2">
                    <span className="text-label font-medium">{t("preview.label")}</span>
                    <div ref={previewContainerRef} className="min-h-64 flex-1 overflow-hidden rounded-md border border-border bg-muted/10" data-testid="md-preview">
                      {previewState === "unavailable" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.unavailable")}</p> : null}
                      {previewState === "idle" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.loading")}</p> : null}
                    </div>
                  </div>
                </div>
              )}
              {/* M6 front matter: the YAML block, edited as text and written
                  back by replacing exactly its span (byte-identity preserved). */}
              {frontmatterVisible ? <MarkdownFrontmatterPanel editor={editor} editable={!readOnly} className="max-h-64" /> : null}
            </div>
          </div>
        </OfficeFrame>
      ) : viewState === "error" && failure ? (
        <Alert className="m-3" variant="destructive" role="alert" data-testid="md-error-state">
          <AlertTitle>{t("errors.title")}</AlertTitle>
          <AlertDescription>{failure.message ?? t("errors.unknown")}</AlertDescription>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => setRetryToken((value) => value + 1)}>{t("actions.retry")}</Button>
        </Alert>
      ) : (
        <div className="flex min-h-64 flex-1 items-center justify-center text-body text-muted-foreground" role="status" data-testid="md-opening">{t("state.opening")}</div>
      )}
    </section>
  );
}

export type { MarkdownEditorProps } from "./types";
