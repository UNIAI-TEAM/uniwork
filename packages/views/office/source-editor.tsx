"use client";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the editor landmark owns document shortcuts */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { OfficeTooLargeNotice, openFailureClassOf } from "./too-large-notice";
import { Clipboard, Copy, Redo2, Undo2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { assetManifestRows, hasFailedAsset, type AssetManifestLike, type AssetStatus } from "./asset-manifest";
import { HtmlSourceEditor, type HtmlSourceEditorProps } from "./html/source";
import type {
  IsolatedPreviewPort,
  TextCapability,
  TextEditorHandle,
  TextOpenFailure,
  TextOpenOutcome,
  TextSaveCoordinator,
  TextViewState,
  TextEditorPermissions,
} from "./source-editor-types";

export interface SourceEditorProps<TSnapshot = unknown> {
  format: "md" | "html";
  documentKey: string;
  editor: TextEditorHandle<TSnapshot>;
  open: { open(signal?: AbortSignal): Promise<TextOpenOutcome> };
  coordinator: TextSaveCoordinator;
  capability?: TextCapability;
  preview?: IsolatedPreviewPort;
  manifest?: AssetManifestLike | null;
  assetFailures?: Readonly<Record<string, AssetStatus | boolean>>;
  permissions?: TextEditorPermissions;
  title: string;
  className?: string;
  onOpen?: (outcome: TextOpenOutcome) => void;
}

function failureFor(documentKey: string, format: "md" | "html", error: unknown): TextOpenFailure {
  return {
    outcome: "failed",
    document_id: documentKey,
    format,
    failure_class: openFailureClassOf(error),
    message: error instanceof Error ? error.message : String(error),
  } as TextOpenFailure;
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

function AssetManifestPanel({ format, manifest, failures }: { format: "md" | "html"; manifest: AssetManifestLike; failures?: Readonly<Record<string, AssetStatus | boolean>> }) {
  const { t } = useTranslation(undefined, { keyPrefix: `office.${format === "md" ? "markdown" : "html"}` });
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

/** Source editor shared by the Markdown and HTML format wrappers. */
export function SourceEditor<TSnapshot = unknown>({
  format,
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
}: SourceEditorProps<TSnapshot>) {
  const { t } = useTranslation(undefined, { keyPrefix: `office.${format === "md" ? "markdown" : "html"}` });
  const [viewState, setViewState] = useState<TextViewState>("opening");
  const [failure, setFailure] = useState<TextOpenFailure | null>(null);
  const [text, setText] = useState("");
  const [manifest, setManifest] = useState<AssetManifestLike>(() => sourceManifest(editor, manifestProp ?? null));
  const [coordinatorState, setCoordinatorState] = useState(() => coordinator.getState());
  const [previewState, setPreviewState] = useState<"idle" | "ready" | "unavailable">("idle");
  const [retryToken, setRetryToken] = useState(0);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewSessionRef = useRef<{ dispose(): void; update?(text: string, manifest?: AssetManifestLike): Promise<void> | void } | null>(null);
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
    setPreviewState("idle");
    setText("");
    setManifest(sourceManifest(activeEditor, manifestPropRef.current ?? null));

    const run = async () => {
      if (activeCapability?.operation !== "serialize" || activeCapability.status !== "available" || !canWrite(activeEditor)) {
        const blocked = failureFor(documentKey, format, new Error(activeCapability?.reason ?? translate("capabilityUnavailable")));
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
        const next = failureFor(documentKey, format, error);
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
    // Callback and adapter objects are refs so shell identity churn cannot
    // restart a live document session.
  }, [documentKey, format, retryToken, capability?.operation, capability?.status]);

  useEffect(() => {
    const container = previewContainerRef.current;
    if (viewState !== "ready" || !container) return undefined;
    if (!preview) {
      setPreviewState("unavailable");
      return undefined;
    }
    let active = true;
    setPreviewState("idle");
    const mount = async () => {
      try {
        const session = await preview.mount({ container, format, title, text: latestTextRef.current, manifest: latestManifestRef.current });
        if (!active || disposedRef.current) {
          session.dispose();
          return;
        }
        previewSessionRef.current = session;
        // Source edits may arrive while the initial mount opens its asset
        // scope. Push the latest copy before marking the preview ready so the
        // first visible frame cannot lag behind the textarea.
        const update = session.update?.(latestTextRef.current, latestManifestRef.current);
        if (update && typeof (update as Promise<void>).then === "function") await update;
        if (!active || disposedRef.current) {
          session.dispose();
          previewSessionRef.current = null;
          return;
        }
        setPreviewState("ready");
      } catch {
        if (active) setPreviewState("unavailable");
      }
    };
    void mount();
    return () => {
      active = false;
      previewSessionRef.current?.dispose();
      previewSessionRef.current = null;
    };
  }, [format, preview, title, viewState]);

  useEffect(() => {
    if (viewState !== "ready" || !previewSessionRef.current) return;
    try {
      const update = previewSessionRef.current.update?.(text, manifest);
      if (update && typeof (update as Promise<void>).catch === "function") void (update as Promise<void>).catch(() => setPreviewState("unavailable"));
    } catch {
      setPreviewState("unavailable");
    }
  }, [manifest, text, viewState]);

  const markDirty = useCallback(() => coordinator.markDirty?.(editorRef.current.getDirtyGeneration()), [coordinator]);
  const checkpoint = useCallback(() => {
    if (!composingRef.current) void coordinatorRef.current.checkpoint?.();
  }, []);
  const onTextChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    if (editorRef.current.source) editorRef.current.source.setText(next);
    else editorRef.current.setText?.(next);
    setText(next);
    markDirty();
    if (!(event.nativeEvent as InputEvent).isComposing) checkpoint();
  }, [checkpoint, markDirty]);
  const onCompositionStart = useCallback((_event: CompositionEvent<HTMLTextAreaElement>) => { composingRef.current = true; }, []);
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    checkpoint();
  }, [checkpoint]);
  const onHtmlTextChange: HtmlSourceEditorProps["onChange"] = useCallback((next) => {
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
    const next = area.value.slice(0, start) + incoming + area.value.slice(end);
    if (editorRef.current.source) editorRef.current.source.setText(next);
    else editorRef.current.setText?.(next);
    setText(next);
    markDirty();
    checkpoint();
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = start + incoming.length;
    });
  }, [checkpoint, markDirty, permissions.canPaste]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save("shortcut");
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      // A denied permission still blocks the gesture on the HTML path; only
      // the custom writeText path is skipped there, where CodeMirror owns the
      // native clipboard.
      if (permissions.canCopy === false) event.preventDefault();
      else if (format !== "html" && editorRef.current.clipboard?.writeText) { event.preventDefault(); void copySelection().catch(() => undefined); }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      if (permissions.canPaste === false) event.preventDefault();
      else if (format !== "html" && editorRef.current.clipboard?.readText) { event.preventDefault(); void pasteText().catch(() => undefined); }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        history(event.shiftKey ? "redo" : "undo");
        return;
      }
      // CodeMirror's historyKeymap used to own Mod-Y redo in the HTML pane.
      // The snapshot stack is the single undo owner now, so route that gesture
      // here too; the Markdown textarea keeps the browser's native Mod-Y.
      if (key === "y" && format === "html") {
        event.preventDefault();
        history("redo");
      }
    }
  }, [copySelection, format, history, pasteText, permissions.canCopy, permissions.canPaste, save]);

  return (
    <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-background", className)} data-testid={`${format}-editor`} data-document-key={documentKey} onKeyDown={onKeyDown} role="application" aria-label={title} tabIndex={0}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h1 className="min-w-0 truncate text-title font-semibold">{title}</h1>
        <span className="text-caption text-muted-foreground" data-testid={`${format}-open-state`}>
          {viewState === "opening" ? t("state.opening") : viewState === "ready" ? t(`saveState.${coordinatorState.state}`) : t("state.error")}
        </span>
      </header>
      {viewState === "ready" ? (
        <>
          <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-2 py-1" data-testid={`${format}-toolbar`} role="toolbar" aria-label={t("toolbar.label")}>
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.undo")} disabled={readOnly || saving} onClick={() => history("undo")}><Undo2 aria-hidden /></Button>
            <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.redo")} disabled={readOnly || saving} onClick={() => history("redo")}><Redo2 aria-hidden /></Button>
            {format === "md" ? (
              <>
                <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.copy")} disabled={readOnly || saving || permissions.canCopy === false || !editor.clipboard?.writeText} onClick={() => void copySelection().catch(() => undefined)}><Copy aria-hidden /></Button>
                <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("actions.paste")} disabled={readOnly || saving || permissions.canPaste === false || !editor.clipboard?.readText} onClick={() => void pasteText().catch(() => undefined)}><Clipboard aria-hidden /></Button>
              </>
            ) : null}
            <span className="min-w-0 flex-1" />
            <Button type="button" variant="brand" size="sm" data-testid={`${format}-save`} disabled={readOnly || saving || !dirty || blockedAsset} onClick={() => save("button")}>
              {saving ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-2">
            <div className="flex min-h-64 min-w-0 flex-col gap-2">
              {format === "html" ? (
                <span className="text-label font-medium">{t("source.label")}</span>
              ) : (
                <label className="text-label font-medium" htmlFor={`${format}-source`}>{t("source.label")}</label>
              )}
              {format === "html" ? (
                <HtmlSourceEditor
                  value={text}
                  readOnly={readOnly}
                  className="min-h-64 flex-1 overflow-hidden rounded-md border border-border bg-background"
                  ariaLabel={t("source.label")}
                  onChange={onHtmlTextChange}
                  onCheckpoint={checkpoint}
                />
              ) : (
                <textarea
                  ref={textAreaRef}
                  id={`${format}-source`}
                  className="min-h-64 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-body leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  value={text}
                  readOnly={readOnly}
                  spellCheck={false}
                  onChange={onTextChange}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={onCompositionEnd}
                  data-testid={`${format}-source`}
                  aria-label={t("source.label")}
                />
              )}
            </div>
            <div className="flex min-h-64 min-w-0 flex-col gap-2">
              <span className="text-label font-medium">{t("preview.label")}</span>
              <div ref={previewContainerRef} className="min-h-64 flex-1 overflow-hidden rounded-md border border-border bg-muted/10" data-testid={`${format}-preview`}>
                {previewState === "unavailable" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.unavailable")}</p> : null}
                {previewState === "idle" ? <p className="p-3 text-body text-muted-foreground" role="status">{t("preview.loading")}</p> : null}
              </div>
            </div>
          </div>
          <aside className="border-t border-border" aria-label={t("asset.label")} data-testid={`${format}-assets`}>
            <AssetManifestPanel format={format} manifest={manifest} failures={assetFailures} />
            {blockedAsset ? <p className="px-3 pb-3 text-caption text-destructive" role="alert">{t("asset.saveBlocked")}</p> : null}
          </aside>
        </>
      ) : viewState === "error" && failure ? failure.failure_class === "too_large" ? <OfficeTooLargeNotice format={format} /> : (
        <Alert className="m-3" variant="destructive" role="alert" data-testid={`${format}-error-state`}>
          <AlertTitle>{t("errors.title")}</AlertTitle>
          <AlertDescription>{failure.message ?? t("errors.unknown")}</AlertDescription>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => setRetryToken((value) => value + 1)}>{t("actions.retry")}</Button>
        </Alert>
      ) : (
        <div className="flex min-h-64 flex-1 items-center justify-center text-body text-muted-foreground" role="status" data-testid={`${format}-opening`}>{t("state.opening")}</div>
      )}
    </section>
  );
}
