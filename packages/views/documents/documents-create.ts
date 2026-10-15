"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { BlankDocumentFormat } from "@uniwork/core/api/endpoints/documents-blank";
import { useCreateDocument } from "@uniwork/core/documents/hooks";
import { isEndpointMissing, useCreateBlankFile, useCreateFolder } from "@uniwork/core/documents/hooks-library";
import { createSafeId } from "@uniwork/core/utils";
import { documentErrorMessage } from "./document-error-message";

/** What the create cards and the "New" menu offer, in the design's order. */
export const CREATE_TYPES = ["page", "docx", "xlsx", "pptx", "md", "html", "pdf"] as const;
export type CreateType = (typeof CREATE_TYPES)[number];

/** What the "New" menu offers inside an open folder: folder first, then CREATE_TYPES (FD-D9). */
export const CREATE_MENU_TYPES = ["folder", ...CREATE_TYPES] as const;
export type CreateMenuType = (typeof CREATE_MENU_TYPES)[number];

/**
 * "Created as restricted" with a Share action (DOC-02). The toast lives in the
 * app layer and survives the navigation into the new document; Share goes to
 * the document with `?share=1`, which its actions menu turns into the dialog.
 */
export function toastCreatedRestricted(t: (key: string) => string, onShare?: (documentId: string) => void, documentId?: string) {
  const share = onShare && documentId ? () => onShare(documentId) : null;
  toast.success(
    t("documents.home.create.created_restricted"),
    share ? { action: { label: t("documents.home.create.share_action"), onClick: share } } : undefined,
  );
}

/**
 * Create one document of a type in the open folder with its default name and
 * open it — no name prompt (user decision 2026-10-12); renaming happens on the
 * document's breadcrumb. A page keeps today's "New page" flow; the six file
 * types go through the blank-file route. Create awaits the server, never an
 * optimistic row (CLAUDE.md § State Rules: create navigates).
 */
export function useCreateOfType(wsId: string, onOpen: (documentId: string) => void, onShare?: (documentId: string) => void) {
  const { t } = useTranslation();
  const createPage = useCreateDocument(wsId);
  const createBlank = useCreateBlankFile(wsId);
  const createFolder = useCreateFolder(wsId);
  // A type the server answered 404/501 for (its blank route or format is not
  // deployed yet): the card stays visible, disabled with a hint, for the session.
  // A second click while the first create is in flight must not make a second folder.
  const folderBusy = useRef(false);
  const folderKeyRef = useRef<{ title: string; parentId: string | null; key: string } | null>(null);
  const [unavailable, setUnavailable] = useState<ReadonlySet<CreateType>>(new Set());

  // `restricted` is only true when the user switched it on; inside a restricted
  // folder the server inherits, so nothing is sent (DOC-02).
  const create = async (type: CreateType, parentId: string | null, restricted = false) => {
    const visibility = restricted ? ({ visibility: "restricted" } as const) : {};
    try {
      if (type === "page") {
        const doc = await createPage.mutateAsync({
          title: t("documents.page.new_page"),
          ...(parentId ? { parent_id: parentId } : {}),
          ...visibility,
        });
        onOpen(doc.id);
        if (restricted) toastCreatedRestricted(t, onShare, doc.id);
        return;
      }
      const doc = await createBlank.mutateAsync({
        format: type satisfies BlankDocumentFormat,
        title: t(`documents.home.default_names.${type}`),
        ...(parentId ? { parentId } : {}),
        ...visibility,
        idempotencyKey: createSafeId(),
      });
      onOpen(doc.id);
      if (restricted) toastCreatedRestricted(t, onShare, doc.id);
    } catch (error) {
      if (type !== "page" && isEndpointMissing(error)) {
        setUnavailable((prev) => new Set(prev).add(type));
        toast.error(t("documents.home.create_unavailable"));
        return;
      }
      toast.error(documentErrorMessage(error, t, "documents.home.create_failed"));
    }
  };

  /** A new folder takes the given or default name; the caller navigates into it. */
  const newFolder = async (parentId: string | null, customTitle?: string): Promise<string | null> => {
    if (folderBusy.current) return null;
    folderBusy.current = true;
    const title = (customTitle ?? t("documents.home.folders.default_name")).trim();
    if (folderKeyRef.current?.title !== title || folderKeyRef.current.parentId !== parentId) {
      folderKeyRef.current = { title, parentId, key: createSafeId() };
    }
    try {
      const folder = await createFolder.mutateAsync({
        title,
        ...(parentId ? { parentId } : {}),
        idempotencyKey: folderKeyRef.current.key,
      });
      folderKeyRef.current = null;
      toast.success(t("documents.home.folders.toast.created", { title: folder.title }));
      return folder.id;
    } catch (error) {
      if (customTitle !== undefined) {
        throw error;
      }
      toast.error(documentErrorMessage(error, t, "documents.home.folders.create_failed"));
      return null;
    } finally {
      folderBusy.current = false;
    }
  };

  return {
    create,
    newFolder,
    unavailable,
    pending: createPage.isPending || createBlank.isPending,
    folderPending: createFolder.isPending,
  };
}
