"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createDocument, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import { sanitizePageContent } from "@uniwork/core/documents/schema";
import { cn } from "@uniwork/ui/lib/utils";
import { EditorBubbleMenu } from "../editor/bubble-menu";
import { createPageDocumentExtensions } from "../editor/extensions";
import { createMentionSuggestion } from "../editor/extensions/mention-suggestion";
import {
  createDocumentAssetUploadExtension,
  type DocumentAssetUploader,
} from "./document-asset-upload";
import { DocumentImageExtension } from "./document-image-extension";

/**
 * The page editor: TipTap over the G1-01 page schema, persisted as JSON.
 *
 * It is deliberately NOT the Markdown ContentEditor. Task and chat content is
 * stored as Markdown and the two paths must not be mixed — a page is parsed and
 * serialized as `{type:"doc"}` JSON, so nothing ever round-trips through
 * Markdown (`JSON → Markdown → JSON` loses marks and attrs the page schema
 * allows). The extension stack comes from `createPageDocumentExtensions`, the
 * toolbar is the shared `EditorBubbleMenu`, and the chunk is mounted through
 * React.lazy by the detail view so the library route stays light.
 */

export interface DocumentEditorHandle {
  /**
   * Land `content` in the editor, bypassing the dirty guard. The caller owns
   * that decision: only call it once the local draft has been resolved (saved,
   * discarded, or the user chose the server copy).
   */
  adoptContent: (content: unknown, revision: string) => void;
  focus: (position?: "start" | "end") => void;
}

export interface DocumentEditorProps {
  wsId: string;
  documentId: string;
  /** Working-copy JSON, read once at mount. */
  initialContent: unknown;
  /** Latest server content; adopted only while the editor is clean. */
  content: unknown;
  /** Revision of `content` — the change signal for the sync below. */
  contentRevision: string;
  /**
   * True while a local edit has not been proven saved. Realtime and refetches
   * never overwrite a dirty editor; the user's own bytes win until they are
   * acknowledged.
   */
  dirty: boolean;
  editable: boolean;
  onChange: (content: unknown) => void;
  /** Uploads one pasted/dropped image; resolves with the asset that lands in the JSON. */
  onUploadAsset: DocumentAssetUploader;
  onAssetError?: (error: unknown) => void;
  /** How many image uploads are in flight — the save indicator gates on this. */
  onPendingUploadsChange?: (pending: number) => void;
  onContentError?: (error: unknown) => void;
  onReady?: () => void;
  onFocusTitle?: () => void;
}

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(
  function DocumentEditor(
    {
      wsId,
      documentId,
      initialContent,
      content,
      contentRevision,
      dirty,
      editable,
      onChange,
      onUploadAsset,
      onAssetError,
      onPendingUploadsChange,
      onContentError,
      onReady,
      onFocusTitle,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const members = useMembers(wsId);
    const membersRef = useRef(members.data);
    membersRef.current = members.data;
    const translateRef = useRef(t);
    translateRef.current = t;
    const imageInputRef = useRef<HTMLInputElement>(null);
    const focusTitleRef = useRef(onFocusTitle);
    focusTitleRef.current = onFocusTitle;
    const onChangeRef = useRef(onChange);
    const onAssetErrorRef = useRef(onAssetError);
    const onContentErrorRef = useRef(onContentError);
    const onReadyRef = useRef(onReady);
    const onPendingUploadsChangeRef = useRef(onPendingUploadsChange);
    const uploaderRef = useRef<DocumentAssetUploader | undefined>(undefined);
    const dirtyRef = useRef(dirty);
    const pendingUploadsRef = useRef(0);
    const adoptedRevisionRef = useRef(contentRevision);
    const [pendingUploads, setPendingUploads] = useState(0);

    onChangeRef.current = onChange;
    onAssetErrorRef.current = onAssetError;
    onContentErrorRef.current = onContentError;
    onReadyRef.current = onReady;
    onPendingUploadsChangeRef.current = onPendingUploadsChange;
    uploaderRef.current = onUploadAsset;
    dirtyRef.current = dirty;

    const handlePendingChange = useCallback((pending: number) => {
      pendingUploadsRef.current = pending;
      setPendingUploads(pending);
      onPendingUploadsChangeRef.current?.(pending);
    }, []);

    const extensions = useMemo(
      () =>
        createPageDocumentExtensions({
          image: DocumentImageExtension,
          assetUpload: createDocumentAssetUploadExtension({
            getUploader: () => uploaderRef.current,
            onPendingChange: handlePendingChange,
            onError: (error) => onAssetErrorRef.current?.(error),
          }),
          placeholder: ({ editor: instance }) => translateRef.current(instance.isEmpty
            ? "documents.page_ui.empty_placeholder" : "documents.page_ui.line_placeholder"),
          slash: { translate: (key, options) => translateRef.current(key, options), chooseImage: () => imageInputRef.current?.click() },
          mention: {
            ...createMentionSuggestion(queryClient, { mode: "context", getContextItems: () =>
              (membersRef.current ?? []).map((member) => ({ id: member.user_id, label: member.display_name, type: "member" as const })) }),
            // Both typed @ and the slash menu's @ use the page vocabulary.
            allow: ({ editor: instance }) => instance.isEditable,
            command: ({ editor: instance, range, props }) => {
              instance.chain().focus().insertContentAt(range, [
                { type: "mention", attrs: { id: props.id, label: props.label, kind: "user" } },
                { type: "text", text: " " },
              ]).run();
            },
          },
        }),
      // Built once per mount on purpose: Tiptap reads its extension set at
      // creation, like every other editor in this package.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const editor = useEditor({
      immediatelyRender: false,
      editable,
      content: initialContent as JSONContent | undefined,
      extensions,
      onUpdate: ({ editor: instance }) => {
        // Only the closed vocabulary may reach the save machine: unknown
        // nodes/marks are dropped here, so nothing the server would reject is
        // ever queued as a draft.
        try {
          const sanitized = sanitizePageContent(instance.getJSON());
          onChangeRef.current(sanitized.content);
        } catch (error) {
          onContentErrorRef.current?.(error);
        }
      },
      editorProps: {
        attributes: {
          class:
            "rich-text-editor document-page-prose min-h-64 text-body leading-relaxed",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": t("documents.editor.aria_label"),
        },
        handleKeyDown: (view, event) => {
          if (!editable || event.isComposing || !focusTitleRef.current) return false;
          if (event.key !== "ArrowUp" && event.key !== "Backspace") return false;
          const { selection, doc: body } = view.state;
          if (!selection.empty || selection.from !== 1 || !body.firstChild?.isTextblock || body.firstChild.content.size !== 0) return false;
          event.preventDefault();
          focusTitleRef.current();
          return true;
        },
      },
    });

    const readyFiredRef = useRef(false);
    useEffect(() => {
      if (!editor || readyFiredRef.current) return;
      readyFiredRef.current = true;
      onReadyRef.current?.();
    }, [editor]);

    // Read-only is a permission, not a mount-time decision: losing edit keeps
    // the committed copy on screen, so the flag has to reach the live instance.
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      if (editor.isEditable !== editable) editor.setEditable(editable, false);
    }, [editor, editable]);

    // Adopt server content only while clean. `contentRevision` is the signal:
    // a refetch that carries the revision the editor already shows is a no-op.
    // Upload placeholders are local work even after their sanitized body ACK.
    // Equivalent server bodies must preserve the live selection and history.
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      if (dirtyRef.current || pendingUploadsRef.current > 0) return;
      if (contentRevision === adoptedRevisionRef.current) return;
      const next = createDocument(content as JSONContent, editor.schema);
      if (!editor.state.doc.eq(next)) editor.commands.setContent(next, { emitUpdate: false });
      adoptedRevisionRef.current = contentRevision;
    }, [content, contentRevision, editor]);

    useImperativeHandle(
      ref,
      () => ({
        adoptContent: (next: unknown, revision: string) => {
          if (!editor || editor.isDestroyed) return;
          editor.commands.setContent(next as JSONContent, { emitUpdate: false });
          adoptedRevisionRef.current = revision;
        },
        focus: (position) => editor?.commands.focus(position),
      }),
      [editor],
    );

    useEffect(() => {
      if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
    }, [editor, t]);

    if (!editor) return <div className="flex-1" data-testid="document-editor-loading" />;

    return (
      <div className="relative flex flex-1 flex-col" data-document-id={documentId} data-ws-id={wsId}>
        <EditorContent editor={editor} className="flex flex-1 flex-col" />
        {editable ? <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
          aria-label={t("documents.page_ui.choose_image")} onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!files.length || !editor.isEditable) return;
            // Run the existing paste asset handler, including its pending/save
            // accounting and asset:// replacement, for the chosen local file.
            const paste = new Event("paste", { bubbles: true, cancelable: true });
            Object.defineProperty(paste, "clipboardData", { value: { files, getData: () => "" } });
            editor.view.dom.dispatchEvent(paste);
          }} /> : null}
        {editable ? <EditorBubbleMenu editor={editor} variant="page" /> : null}
        <span className="sr-only" role="status" aria-live="polite">
          {pendingUploads > 0 ? t("documents.save.asset_uploading") : ""}
        </span>
      </div>
    );
  },
);
