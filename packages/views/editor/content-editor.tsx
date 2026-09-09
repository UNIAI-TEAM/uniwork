"use client";

/**
 * ContentEditor — the rich-text editor used wherever the user TYPES content.
 *
 * Architecture decisions (April 2026 refactor):
 *
 * 1. EDITING ONLY. Read-only display is handled by `ReadonlyContent` (a
 *    react-markdown renderer), not this component. There used to be an
 *    `editable` prop here that toggled between modes, but every readonly
 *    callsite migrated to ReadonlyContent and the prop only invited
 *    misuse — Tiptap's `useEditor` reads `editable` at mount, so toggling
 *    the prop later silently failed (mounted-as-readonly editors stayed
 *    unfocusable forever). To express "currently disabled", wrap this
 *    component in a layout that sets `pointer-events-none` / `aria-disabled`
 *    — don't reach into the editor.
 *
 * 2. ONE MARKDOWN PIPELINE via @tiptap/markdown. Content is loaded with
 *    `contentType: 'markdown'` and saved with `editor.getMarkdown()`.
 *    Previously we had a custom `markdownToHtml()` pipeline (Marked library)
 *    for loading and regex post-processing for saving — two asymmetric paths
 *    that caused roundtrip inconsistencies. The @tiptap/markdown extension
 *    (v3.21.0+) handles table cell <p> wrapping and custom mention tokenizers
 *    natively, eliminating the need for the HTML detour.
 *
 * 3. PREPROCESSING is minimal: only legacy mention shortcode migration and
 *    URL linkification (preprocessMarkdown). No HTML conversion.
 *
 * Tech: Tiptap v3 (ProseMirror wrapper), @tiptap/markdown for
 * bidirectional Markdown ↔ ProseMirror JSON conversion.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { cn } from "@uniwork/ui/lib/utils";
import type { UploadResult } from "@uniwork/core/hooks/use-file-upload";
import { useEditorWorkspaceSlug } from "./workspace-slug";
import { useQueryClient } from "@tanstack/react-query";
import type { Attachment } from "@uniwork/core/types";
import {
  parseMarkdownChunked,
  MARKDOWN_CHUNK_THRESHOLD,
  type MarkdownManagerLike,
} from "./utils/parse-markdown-chunked";
import type { MentionItem } from "./extensions/mention-suggestion";
import type { TaskIdentifierResolver } from "./extensions/task-identifier-autolink";
import type { BuiltinCommandSuggestionOptions } from "./extensions/slash-command-suggestion";
import { createEditorExtensions } from "./extensions";
import {
  uploadAndInsertFile,
  insertUploadPlaceholder,
  settleUploadNode,
} from "./extensions/file-upload";
import { useConfigStore } from "@uniwork/core/editor/config-store";
import { preprocessMarkdown } from "./utils/preprocess";
import { repairEmptyListItems } from "./utils/repair-list-items";
import {
  navigateWithFallback,
  resolveClickIntent,
  useOptionalNavigation,
  type LinkClickIntent,
} from "@uniwork/views/navigation";
import { createTaskIdentifierResolver } from "./content-editor-task-resolver";
import { useAppOrigin } from "./use-app-origin";
import { openLink, isMentionHref } from "./utils/link-handler";
import { EditorBubbleMenu } from "./bubble-menu";
import { posFromAnchor, type TextAnchor } from "./text-anchor";
import { useLinkHover, LinkHoverCard } from "./link-hover-card";
import { AttachmentDownloadProvider } from "./attachment-download-context";
import "katex/dist/katex.min.css";
import "./styles/index.css";
import {
  normalizeMarkdown,
  normalizeEditorMarkdown,
  hasUploadingNode,
} from "./content-editor-helpers";

import type { ContentEditorProps, ContentEditorRef } from "./content-editor-types";
export type { ContentEditorProps, ContentEditorRef } from "./content-editor-types";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ContentEditor = forwardRef<ContentEditorRef, ContentEditorProps>(
  function ContentEditor(
    {
      defaultValue,
      value,
      onUpdate,
      placeholder: placeholderText = "",
      className,
      debounceMs = 300,
      onSubmit,
      onBlur,
      onUploadFile,
      pasteAsFileThreshold,
      onUploadingChange,
      showBubbleMenu = true,
      currentTaskId,
      onCreateSubTask,
      disableMentions = false,
      mentionMode = "default",
      mentionContextItems,
      enableSlashCommands = false,
      slashCommandMode = "skill",
      quickActionMenu,
      attachments,
      flushPendingOnUnmount = false,
      onReady,
    },
    ref,
  ) {
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const flushPendingOnUnmountRef = useRef(flushPendingOnUnmount);
    // Markdown serialized at `onUpdate` time, awaiting its debounce fire. The
    // unmount flush emits this cached copy — it runs mid-teardown and can't
    // assume the editor instance is still readable.
    const pendingFlushRef = useRef<string | null>(null);
    const pendingBaseRef = useRef<string | null>(null);
    const onUpdateRef = useRef(onUpdate);
    const onSubmitRef = useRef(onSubmit);
    const onBlurRef = useRef(onBlur);
    const onReadyRef = useRef(onReady);
    const onUploadingChangeRef = useRef(onUploadingChange);
    const onUploadFileRef = useRef<
      ((file: File, uploadId: string) => Promise<UploadResult | null>) | undefined
    >(undefined);
    // Same reasoning as placeholderRef below: the extension array is built once
    // at mount, so the paste-as-file threshold is read through a ref to stay
    // live without remounting the editor.
    const pasteAsFileThresholdRef = useRef<number | undefined>(pasteAsFileThreshold);
    const mentionContextItemsRef = useRef<MentionItem[]>(mentionContextItems ?? []);
    // Kept in a ref for the same reason as mentionContextItems: the extension
    // set is built once at mount, so a directly-captured options object would
    // freeze whatever closures existed then and stop seeing new quick actions.
    const quickActionMenuRef = useRef<BuiltinCommandSuggestionOptions | undefined>(quickActionMenu);
    const lastEmittedRef = useRef<string | null>(null);
    // `content` already consumes the initial synchronized value when Tiptap
    // mounts. Track later changes separately so the sync effect does not parse
    // the initial document twice when Markdown serialization canonicalizes it.
    const lastSyncedValueRef = useRef(value);
    // Authoritative Markdown behind the document the user is editing. Keep the
    // raw controlled value rather than the editor serialization: Tiptap may
    // omit invisible channel-media provenance comments while retaining the
    // visible image, and the server needs those comments in the merge base.
    const documentBaseRef = useRef(normalizeMarkdown(value ?? defaultValue ?? ""));
    // Live placeholder text. Passed into the Placeholder extension as a getter
    // (not a static string) so the plugin re-reads it on every decoration pass —
    // the sync effect below updates this ref and nudges a repaint. Tiptap
    // snapshots a *string* placeholder at mount, so a getter is what lets it
    // change without remounting the editor.
    const placeholderRef = useRef(placeholderText);

    // In-session record of attachments freshly uploaded through this editor.
    // Surfaces (like the quick-create modal) that don't have a server-supplied
    // `attachments` prop still need the AttachmentDownloadProvider to know
    // about images the user just pasted/dropped — without a record in scope,
    // Attachment.normalize() can't swap the persisted /api/attachments/<id>/
    // download URL to a freshly-loadable one, and the <img> renders broken in
    // any environment where the renderer's origin doesn't proxy /api to the
    // API host (UNI-0, Desktop/Electron).
    const [sessionUploads, setSessionUploads] = useState<Attachment[]>([]);
    // Wrap the caller-supplied uploader so we can stash each successful result
    // in `sessionUploads`. The wrapper is rebuilt only when the underlying
    // `onUploadFile` identity changes, so the inner ref handed to Tiptap stays
    // stable across renders the way the original passthrough did.
    const wrappedOnUploadFile = useMemo(() => {
      if (!onUploadFile) return undefined;
      return async (file: File, uploadId: string): Promise<UploadResult | null> => {
        const result = await onUploadFile(file, uploadId);
        // Only track attachments that carry a persisted id — the no-workspace
        // avatar branch returns an id-less record that the resolver can't key
        // off of, and tracking it would just bloat memory without helping
        // anyone. See useFileUpload's `markdownLink` docstring for why.
        if (result?.id) {
          setSessionUploads((prev) =>
            // Deduplicate on id so a re-upload (or a paste-then-drop of the
            // same blob) doesn't create a parallel record.
            prev.some((a) => a.id === result.id) ? prev : [...prev, result],
          );
        }
        return result;
      };
    }, [onUploadFile]);

    // Merged list fed to AttachmentDownloadProvider. Caller-supplied attachments
    // (issue / comment editors that pre-load the full attachments[] from the
    // server) take precedence — we only append session uploads the caller
    // doesn't already have, so a parent re-render that includes the same record
    // doesn't end up with two copies.
    //
    // One exception on id collision: when the caller's copy has an EMPTY
    // `download_url` (the create-issue draft strips the short-lived signed URL
    // before persisting), backfill it from the session upload. The session copy
    // holds the this-response signed URL, so the just-pasted image first-paints
    // from it instead of taking an extra redirect hop through `markdown_url`.
    const providerAttachments = useMemo(() => {
      if (sessionUploads.length === 0) return attachments;
      const sessionById = new Map(sessionUploads.map((a) => [a.id, a]));
      const merged: Attachment[] = [];
      for (const a of attachments ?? []) {
        const session = a.id ? sessionById.get(a.id) : undefined;
        if (session) sessionById.delete(a.id);
        merged.push(
          session && !a.download_url
            ? { ...a, download_url: session.download_url }
            : a,
        );
      }
      merged.push(...sessionById.values());
      return merged;
    }, [attachments, sessionUploads]);

    // Current org/ws slug kept in a ref so the click handler always sees the
    // latest value without recreating the editor. Used by openLink to prefix
    // legacy /tasks/... style paths that lack an org/workspace prefix.
    const workspaceSlug = useEditorWorkspaceSlug();
    const workspaceSlugRef = useRef(workspaceSlug);
    workspaceSlugRef.current = workspaceSlug;

    // Same reasoning for this deployment's app origin: it tells openLink which
    // absolute URLs address this app and must route in-app instead of opening
    // the system browser.
    const appOrigin = useAppOrigin();
    const appOriginRef = useRef(appOrigin);
    appOriginRef.current = appOrigin;

    const navigation = useOptionalNavigation();
    const navigateRef = useRef<(path: string, disposition?: LinkClickIntent) => void>(
      () => undefined,
    );
    navigateRef.current = (path, disposition = "push") => {
      navigateWithFallback(navigation, path, disposition);
    };

    // Keep refs in sync without recreating editor
    onUpdateRef.current = onUpdate;
    onSubmitRef.current = onSubmit;
    onBlurRef.current = onBlur;
    onReadyRef.current = onReady;
    onUploadingChangeRef.current = onUploadingChange;
    onUploadFileRef.current = wrappedOnUploadFile;
    pasteAsFileThresholdRef.current = pasteAsFileThreshold;
    mentionContextItemsRef.current = mentionContextItems ?? [];
    quickActionMenuRef.current = quickActionMenu;
    flushPendingOnUnmountRef.current = flushPendingOnUnmount;

    const queryClient = useQueryClient();

    // Linear-style bare identifier autolink resolver. Fully lazy — it runs only
    // on user input, never on render, so it adds no query hook to this widely
    // used component. It reads the current workspace from the query cache (via
    // the slug ref) and returns null outside a workspace, for non-identifier
    // tokens, or when the prefix can't match this workspace, so no network call
    // happens for those; the exact-match filter enforces correctness.
    const resolveTaskIdentifierRef = useRef<TaskIdentifierResolver | undefined>(
      undefined,
    );
    resolveTaskIdentifierRef.current = createTaskIdentifierResolver(
      queryClient,
      () => workspaceSlugRef.current,
    );

    const initialMarkdown = value ?? defaultValue ?? "";
    const initialContent = initialMarkdown
      ? // One-shot read: the editor preprocesses its initial document once at
        // load. Unlike the readonly renderer it does not need to re-run when
        // the CDN config lands later — the user's own edits drive the document
        // from here on.
        preprocessMarkdown(initialMarkdown, {
          cdnDomain: useConfigStore.getState().cdnDomain,
        })
      : "";
    // With `immediatelyRender: false` the Tiptap instance is created after
    // mount, so an imperative `focus()` fired on the same tick (e.g. chat
    // auto-focusing a brand-new conversation) would hit a null editor and no-op.
    // Latch the intent here and honor it in `onCreate` once the editor exists.
    const focusOnReadyRef = useRef(false);
    // Large markdown is parsed in chunks to dodge marked's O(n²) tokenizer (see
    // parseMarkdownChunked). Small docs stay on the single-parse fast path.
    const mountChunked = initialContent.length > MARKDOWN_CHUNK_THRESHOLD;

    const editor = useEditor({
      immediatelyRender: false,
      // Explicit for clarity — the real perf win is useEditorState in BubbleMenu.
      shouldRerenderOnTransaction: false,
      onCreate: ({ editor: ed }) => {
        // For large docs we mount empty (below) and parse in chunks here, so the
        // O(n²) marked tokenizer never sees the whole document at once.
        if (mountChunked) {
          const manager = (
            ed.storage as { markdown?: { manager?: MarkdownManagerLike } }
          ).markdown?.manager;
          if (manager) {
            ed.commands.setContent(
              parseMarkdownChunked(manager, initialContent),
              { emitUpdate: false },
            );
          } else {
            ed.commands.setContent(initialContent, {
              emitUpdate: false,
              contentType: "markdown",
            });
          }
        }
        // A markdown draft ending in an empty list item (e.g. `"1. \n\n"` left
        // after typing `1.`) parses into a caretless, schema-invalid item;
        // repair it so the mounted editor has a real cursor in the list.
        repairEmptyListItems(ed);
        lastEmittedRef.current = normalizeEditorMarkdown(ed);
        if (focusOnReadyRef.current) {
          focusOnReadyRef.current = false;
          ed.commands.focus("end");
        }
      },
      content: mountChunked ? "" : initialContent,
      contentType: mountChunked
        ? undefined
        : initialMarkdown
          ? "markdown"
          : undefined,
      extensions: createEditorExtensions({
        placeholder: () => placeholderRef.current,
        queryClient,
        onSubmitRef,
        onUploadFileRef,
        pasteAsFileThresholdRef,
        disableMentions,
        mentionMode,
        getMentionContextItems: () => mentionContextItemsRef.current,
        enableSlashCommands,
        slashCommandMode,
        quickActionMenu: {
          getQuickActions: () => quickActionMenuRef.current?.getQuickActions?.() ?? [],
          renderQuickAction: (id: string) =>
            quickActionMenuRef.current?.renderQuickAction?.(id) ?? Promise.resolve(""),
          onRenderError: (error: unknown) =>
            quickActionMenuRef.current?.onRenderError?.(error),
        },
        resolveTaskIdentifierRef,
      }),
      onUpdate: ({ editor: ed }) => {
        if (!onUpdateRef.current) return;
        pendingBaseRef.current = documentBaseRef.current;
        if (flushPendingOnUnmountRef.current) {
          pendingFlushRef.current = normalizeEditorMarkdown(ed);
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = undefined;
          pendingFlushRef.current = null;
          const base = pendingBaseRef.current ?? documentBaseRef.current;
          pendingBaseRef.current = null;
          const md = normalizeEditorMarkdown(ed);
          if (md === lastEmittedRef.current) return;
          lastEmittedRef.current = md;
          onUpdateRef.current?.(md, base);
        }, debounceMs);
      },
      onBlur: () => {
        onBlurRef.current?.();
      },
      editorProps: {
        handleDOMEvents: {
          click(_view, event) {
            const target = event.target as HTMLElement;
            // Skip links inside NodeView wrappers — they handle their own clicks
            if (target.closest("[data-node-view-wrapper]")) return false;

            const link = target.closest("a");
            const href = link?.getAttribute("href");
            if (!href || isMentionHref(href)) return false;

            event.preventDefault();
            openLink(
              href,
              workspaceSlugRef.current,
              appOriginRef.current,
              resolveClickIntent(event),
              (path, disposition) => navigateRef.current(path, disposition),
            );
            return true;
          },
          // Middle click never produces a `click` event. Route it through the
          // same path as a cmd-click (background tab) — on desktop the native
          // window-open request dead-ends against the shell's deny handler.
          auxclick(_view, event) {
            if (event.button !== 1) return false;
            const target = event.target as HTMLElement;
            if (target.closest("[data-node-view-wrapper]")) return false;
            const href = target.closest("a")?.getAttribute("href");
            if (!href || isMentionHref(href)) return false;
            event.preventDefault();
            openLink(
              href,
              workspaceSlugRef.current,
              appOriginRef.current,
              "background-tab",
              (path, disposition) => navigateRef.current(path, disposition),
            );
            return true;
          },
        },
        attributes: {
          class: cn("flex-1 rich-text-editor text-body outline-none", className),
        },
      },
    });

    // Signal hosts that the deferred editor instance now exists. Fired from a
    // passive effect (not `onCreate`) so it runs after the commit in which
    // <EditorContent> attached the editor DOM — callers can measure/focus it.
    const readyFiredRef = useRef(false);
    useEffect(() => {
      if (!editor || readyFiredRef.current) return;
      readyFiredRef.current = true;
      onReadyRef.current?.();
    }, [editor]);

    // Publish upload-queue transitions to the host so it can gate submit.
    //
    // Deliberately NOT derived from `onUpdate`: that path is debounced and
    // drops emissions whose markdown matches the last one — and a FAILED
    // upload removes its placeholder to leave byte-identical markdown (the
    // blob URL was stripped from it all along), so the un-gate would never
    // fire. Transactions carry the attr flip regardless of what serializes.
    useEffect(() => {
      if (!editor || !onUploadingChange) return;
      // Publish the current answer UNCONDITIONALLY on subscribe, then only on
      // flips. The host's state outlives any one editor instance — comment
      // edit unmounts the editor on cancel and mounts a fresh one on re-entry,
      // and chat swaps the editor by `key` when the agent changes. An editor
      // torn down mid-upload takes its pending node with it, so a host left
      // holding `uploading: true` has nothing left to un-gate it: skipping
      // this first emission because the new instance also reads "not
      // uploading" is exactly how submit gets wedged shut for good.
      //
      // `last` is per-subscription rather than a ref for the same reason: flip
      // tracking must not survive the instance it describes.
      let last = hasUploadingNode(editor);
      onUploadingChangeRef.current?.(last);
      const check = () => {
        if (editor.isDestroyed) return;
        const uploading = hasUploadingNode(editor);
        if (uploading === last) return;
        last = uploading;
        onUploadingChangeRef.current?.(uploading);
      };
      editor.on("transaction", check);
      return () => {
        editor.off("transaction", check);
      };
      // `onUploadingChange` is read for presence only; the ref carries the
      // live callback, so a host passing an inline arrow doesn't rebind.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, !!onUploadingChange]);

    // Cleanup on unmount. A pending debounced update is DROPPED by default,
    // not flushed — see the `flushPendingOnUnmount` prop doc for why. When the
    // owner opted in, emit the markdown cached at `onUpdate` time so a long
    // debounce can't swallow the last edit when the surrounding modal closes.
    useEffect(() => {
      return () => {
        if (!debounceRef.current) return;
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
        if (!flushPendingOnUnmountRef.current) return;
        const pending = pendingFlushRef.current;
        const base = pendingBaseRef.current ?? documentBaseRef.current;
        pendingFlushRef.current = null;
        pendingBaseRef.current = null;
        if (pending === null || pending === lastEmittedRef.current) return;
        lastEmittedRef.current = pending;
        onUpdateRef.current?.(pending, base);
      };
    }, []);

    // Replace the live document with external markdown. Shared by the
    // synchronized `value` effect below and the imperative `adoptContent`, so
    // both land content identically — chunked parse for large docs, no
    // onUpdate echo, caret preserved. Callers own the decision to apply;
    // the guards live in the effect, not here.
    const applyExternalContent = useCallback(
      (markdown: string) => {
        if (!editor || editor.isDestroyed) return;
        documentBaseRef.current = normalizeMarkdown(markdown);
        const before = normalizeEditorMarkdown(editor);

        // A controlled host commonly echoes the exact Markdown this editor
        // just emitted. Recognize that acknowledgment before preprocessing:
        // preprocessing a half-typed token can change its meaning (for
        // example `dev.de` used to become a link during a debounce pause).
        if (normalizeMarkdown(markdown) === before) return;

        const incoming = markdown
          ? preprocessMarkdown(markdown, {
              cdnDomain: useConfigStore.getState().cdnDomain,
            })
          : "";
        const incomingNormalized = normalizeMarkdown(incoming);
        // Normalized-equal short-circuit. Avoids a no-op transaction when the
        // preprocessed input serializes to the document already on screen.
        if (incomingNormalized === before) return;

        // `emitUpdate: false`. Tiptap v3's setContent defaults to
        // `emitUpdate: true`; without this we would re-trigger onUpdate →
        // server save → self-write loop.
        const { from, to } = editor.state.selection;
        // Same chunked path on WS-driven re-parse of a large description.
        const manager =
          incoming.length > MARKDOWN_CHUNK_THRESHOLD
            ? (editor.storage as { markdown?: { manager?: MarkdownManagerLike } })
                .markdown?.manager
            : undefined;
        if (manager) {
          editor.commands.setContent(parseMarkdownChunked(manager, incoming), {
            emitUpdate: false,
          });
        } else {
          editor.commands.setContent(incoming, {
            emitUpdate: false,
            contentType: "markdown",
          });
        }

        // An empty list item in the incoming markdown parses into a caretless,
        // schema-invalid node; repair it and let it own the caret. Otherwise clamp
        // the prior selection to the new doc size so the caret doesn't snap to
        // position 0 after ProseMirror replaces the document.
        if (!repairEmptyListItems(editor, { from, to })) {
          const docSize = editor.state.doc.content.size;
          editor.commands.setTextSelection({
            from: Math.min(from, docSize),
            to: Math.min(to, docSize),
          });
        }

        lastEmittedRef.current = normalizeEditorMarkdown(editor);
      },
      [editor],
    );

    // Sync explicit external `value` changes into the editor. `defaultValue`
    // is deliberately mount-only, matching React's normal uncontrolled-input
    // contract; drafts therefore cannot feed their own debounced writes back
    // into the live editor.
    // Tiptap v3 `useEditor` reads `content` only at mount (ueberdosis/tiptap#5831);
    // without this effect, a WS-driven description update keeps the editor
    // showing stale content until the issue is closed and reopened.
    useEffect(() => {
      if (!editor || editor.isDestroyed || value === undefined) return;

      const previousValue = lastSyncedValueRef.current;
      lastSyncedValueRef.current = value;

      // The initial value was already parsed through useEditor's
      // `content` option (or in onCreate for the chunked path). Comparing that
      // source Markdown to Tiptap's canonical serialization can differ even
      // when they represent the same document, and used to cause an immediate
      // second full parse. Only later prop changes belong to this sync effect.
      if (value === previousValue) return;

      // Guard 0: never clobber an in-flight upload. An external `value`
      // change can arrive mid-upload — e.g. chat lazy-creates a session on the
      // first file upload, which flips `activeSessionId` → the draft key →
      // `value`. If we `setContent` over a document that still holds an
      // `uploading` image/fileCard node, that node is wiped and the upload's
      // finalize can no longer find it (the file vanishes, leaving an empty
      // `!file[name]()`). Like the dirty guards below, an uploading node is
      // local state that an external sync must not overwrite.
      //
      // NOTE: this (like every guard here) SKIPS the sync permanently for this
      // value — `lastSyncedValueRef` has already advanced, so the effect will
      // not re-run for it. A host that must still land this content once the
      // block clears has to say so explicitly, via `adoptContent`.
      if (hasUploadingNode(editor)) return;

      const current = normalizeEditorMarkdown(editor);
      // "Dirty" = user has local edits not yet flushed through the debounced
      // `onUpdate`. `lastEmittedRef` is advanced only after a debounce fire,
      // so a divergence means the editor holds unsaved bytes.
      const isDirty =
        lastEmittedRef.current !== null && current !== lastEmittedRef.current;

      // Guard 1: focused AND dirty — protect bytes the user is actively
      // typing. Focused-but-clean falls through: applying setContent is safe
      // (no user input to lose) and necessary, because onBlur has no replay
      // mechanism and a focused clean editor would otherwise drop this sync
      // permanently.
      if (editor.isFocused && isDirty) return;

      // Guard 2: unfocused-but-dirty — blur happened but the debounce window
      // (debounceMs, 1500ms for description) hasn't flushed yet. The pending
      // onUpdate will reach the server and the cache will reconcile; skipping
      // here avoids overwriting unsaved local edits.
      if (isDirty) return;

      applyExternalContent(value);
    }, [value, editor, applyExternalContent]);

    // Sync external `placeholder` changes into the mounted editor.
    // The Placeholder extension is configured with a getter over `placeholderRef`
    // (see createEditorExtensions above), which the plugin re-invokes every time
    // it recomputes its decorations. Update the ref, then dispatch an empty
    // transaction to force that recompute — the placeholder refreshes without a
    // remount. Without this, it stays frozen at its mount value: switching
    // between an archived and an active chat session under the same agent (no
    // editor remount) leaves the input stuck on "This session is archived" even
    // though it is usable.
    useEffect(() => {
      if (placeholderRef.current === placeholderText) return;
      placeholderRef.current = placeholderText;
      if (!editor || editor.isDestroyed) return;
      // `docChanged` is false on an empty transaction, so onUpdate never fires
      // and no self-write loop is triggered.
      editor.view.dispatch(editor.state.tr);
    }, [editor, placeholderText]);

    useImperativeHandle(ref, () => ({
      // Intentionally NOT routed through `normalizeMarkdown` — see the "stays
      // untrimmed" safety net in content-editor.test.tsx. It used to also pass
      // through `stripBlobUrls`; that wrapper is gone because an in-flight
      // placeholder no longer serialises at all, which is strictly stronger
      // than scrubbing it back out afterwards.
      getMarkdown: () => editor?.getMarkdown() ?? "",
      clearContent: () => {
        editor?.commands.clearContent();
      },
      focus: () => {
        if (editor) editor.commands.focus();
        // Editor not mounted yet — defer the focus to `onCreate`.
        else focusOnReadyRef.current = true;
      },
      focusAtCoords: (coords: { x: number; y: number }) => {
        if (!editor) {
          // Editor not mounted yet — degrade to the latched plain focus.
          focusOnReadyRef.current = true;
          return;
        }
        const pos = editor.view.posAtCoords({ left: coords.x, top: coords.y });
        if (pos) editor.commands.focus(pos.pos);
        else editor.commands.focus("end");
      },
      focusAtAnchor: (anchor: TextAnchor) => {
        if (!editor) {
          // Editor not mounted yet — degrade to the latched plain focus.
          focusOnReadyRef.current = true;
          return;
        }
        editor.commands.focus(posFromAnchor(editor.state.doc, anchor));
      },
      blur: () => {
        editor?.commands.blur();
      },
      uploadFile: (file: File) => {
        if (!editor || !onUploadFileRef.current) return;
        const endPos = editor.state.doc.content.size;
        void uploadAndInsertFile(editor, file, onUploadFileRef.current, endPos);
      },
      hasActiveUploads: () => (editor ? hasUploadingNode(editor) : false),
      insertUploadPlaceholder: (upload) => {
        if (!editor || editor.isDestroyed) return false;
        return insertUploadPlaceholder(editor, upload);
      },
      settleUploadPlaceholder: (uploadId, result) => {
        if (!editor || editor.isDestroyed) return false;
        return settleUploadNode(editor, uploadId, result);
      },
      insertMarkdownAtEnd: (markdown: string) => {
        if (!editor || editor.isDestroyed) return false;
        editor.commands.insertContentAt(editor.state.doc.content.size, markdown, {
          contentType: "markdown",
        });
        return true;
      },
      flushPendingUpdate: () => {
        // No armed timer = nothing typed since the last emit. The editor is
        // already clean, so the host has nothing to re-route.
        if (!debounceRef.current) return null;
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
        pendingFlushRef.current = null;
        pendingBaseRef.current = null;
        if (!editor || editor.isDestroyed) return null;
        // Read the live document: unlike the unmount flush, the instance is
        // still alive here, so this is the freshest possible copy.
        const md = normalizeEditorMarkdown(editor);
        if (md === lastEmittedRef.current) return null;
        // Advance the emit watermark so the editor reads as clean — the host
        // is taking responsibility for these bytes, and the dirty guard must
        // now let the incoming synchronized value through.
        lastEmittedRef.current = md;
        return md;
      },
      adoptContent: (markdown: string) => applyExternalContent(markdown),
    }));

    // Link hover card — disabled when BubbleMenu is active (has selection)
    const wrapperRef = useRef<HTMLDivElement>(null);
    const hoverDisabled = !editor?.state.selection.empty;
    const hover = useLinkHover(wrapperRef, hoverDisabled);

    const handleContainerMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!editor) return;

      const target = event.target as HTMLElement;
      if (target.closest(".ProseMirror")) return;
      if (target.closest("a, button, input, textarea, [role='button'], [data-node-view-wrapper]")) return;

      event.preventDefault();
      editor.commands.focus("end");
    };

    if (!editor) return null;

    return (
      <AttachmentDownloadProvider attachments={providerAttachments}>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- click empty chrome focuses the editor caret */}
        <div
          ref={wrapperRef}
          className="relative flex flex-1 min-h-full flex-col"
          onMouseDown={handleContainerMouseDown}
        >
          <EditorContent className="flex flex-1 flex-col" editor={editor} />
          {showBubbleMenu && (
            <EditorBubbleMenu editor={editor} currentTaskId={currentTaskId} onCreateSubTask={onCreateSubTask} />
          )}
          <LinkHoverCard {...hover} />
        </div>
      </AttachmentDownloadProvider>
    );
  },
);

export { ContentEditor };
