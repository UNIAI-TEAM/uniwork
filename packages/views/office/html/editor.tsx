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
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { assetManifestRows, hasFailedAsset, type AssetManifestLike, type AssetStatus } from "../asset-manifest";
import type { TextEditorHandle, TextViewState } from "../source-editor-types";
import { HtmlRibbon } from "./ribbon";
import { HtmlVisualShell } from "./visual/shell";
import { HTML_ZOOM_DEFAULT, nextViewMode, type HtmlViewMode } from "./visual/shell-model";
import type { HtmlEditorProps, HtmlOpenOutcome } from "./types";

function failureFor(documentKey: string, error: unknown): Extract<HtmlOpenOutcome, { outcome: "failed" }> {
  return {
    outcome: "failed",
    document_id: documentKey,
    format: "html",
    failure_class: "engine_error",
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

function AssetManifestPanel({ manifest, failures }: { manifest: AssetManifestLike; failures?: Readonly<Record<string, AssetStatus | boolean>> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html" });
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
  const [retryToken, setRetryToken] = useState(0);
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

  const effectiveTitle = title ?? t("title");
  const readOnly = capability?.operation !== "serialize" || capability.status !== "available" || !canWrite(editor);
  const dirty = coordinatorState.state === "dirty" || coordinatorState.dirtyGeneration > coordinatorState.lastSavedGeneration;
  const saving = coordinatorState.state === "saving";
  const blockedAsset = hasFailedAsset(manifest, assetFailures);

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
      if (activeCapability?.operation !== "serialize" || activeCapability.status !== "available" || !canWrite(activeEditor)) {
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
  const checkpoint = useCallback(() => {
    if (!composingRef.current) void coordinatorRef.current.checkpoint?.();
  }, []);
  // The H1 source editor reports a committed edit through onChange AND
  // onCheckpoint; checkpointing here too would double every save checkpoint.
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
    if (kind === "undo") editorRef.current.undo?.();
    else editorRef.current.redo?.();
    setText(sourceText(editorRef.current, ""));
    markDirty();
    checkpoint();
  }, [checkpoint, markDirty]);
  const cycleView = useCallback(() => setViewMode((mode) => nextViewMode(mode)), []);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === "\\") {
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

  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-background", className)}
      data-testid="html-editor"
      data-document-key={documentKey}
      onKeyDown={onKeyDown}
      role="application"
      aria-label={effectiveTitle}
      tabIndex={0}
    >
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h1 className="min-w-0 truncate text-title font-semibold">{effectiveTitle}</h1>
        <span className="text-caption text-muted-foreground" data-testid="html-open-state">
          {viewState === "opening" ? t("state.opening") : viewState === "ready" ? t(`saveState.${coordinatorState.state}`) : t("state.error")}
        </span>
      </header>
      {viewState === "ready" ? (
        <>
          {/*
            The shared UNI-931 ribbon (RB-1) is the HTML surface's chrome: the
            tab row, the command body and the trailing
            Source | Split | Preview | Present control. Undo/redo ride its
            quick-access slot and the view modes its trailing control, so H1's
            source editor and H2's modes are reachable from the ribbon. The
            inline/insert intents stay disabled until an H3-op-wired caller
            supplies `commands` (the shell has no patch port), which is the
            documented contract of `HtmlRibbon` - disabled, never hidden.
          */}
          <HtmlRibbon
            commands={{
              onUndo: () => history("undo"),
              onRedo: () => history("redo"),
            }}
            state={{ readOnly }}
            viewMode={ribbonViewMode}
            onViewModeChange={(mode) => setViewMode(mode)}
            presenting={presenting}
            onTogglePresent={() => setViewMode(presenting ? "preview" : "present")}
          />
          <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1" data-testid="html-toolbar" role="toolbar" aria-label={t("toolbar.label")}>
            <span className="min-w-0 flex-1" />
            <Button type="button" variant="brand" size="sm" data-testid="html-save" disabled={readOnly || saving || !dirty || blockedAsset} onClick={() => save("button")}>
              {saving ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>
          <HtmlVisualShell
            documentKey={documentKey}
            text={text}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            readOnly={readOnly}
            onChange={onTextChange}
            onCheckpoint={checkpoint}
            preview={preview}
            manifest={manifest}
            zoom={zoom}
            onZoomChange={setZoom}
            className="min-h-0 flex-1"
          />
          <aside className="border-t border-border" aria-label={t("asset.label")} data-testid="html-assets">
            <AssetManifestPanel manifest={manifest} failures={assetFailures} />
            {blockedAsset ? <p className="px-3 pb-3 text-caption text-destructive" role="alert">{t("asset.saveBlocked")}</p> : null}
          </aside>
        </>
      ) : viewState === "error" && failure ? (
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
