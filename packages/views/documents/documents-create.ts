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

/**
 * Create one document of a type in the open folder with its default name and
 * open it — no name prompt (user decision 2026-10-12); renaming happens on the
 * document's breadcrumb. A page keeps today's "New page" flow; the six file
 * types go through the blank-file route. Create awaits the server, never an
 * optimistic row (CLAUDE.md § State Rules: create navigates).
 */
export function useCreateOfType(wsId: string, onOpen: (documentId: string) => void) {
  const { t } = useTranslation();
  const createPage = useCreateDocument(wsId);
  const createBlank = useCreateBlankFile(wsId);
  const createFolder = useCreateFolder(wsId);
  // A type the server answered 404/501 for (its blank route or format is not
  // deployed yet): the card stays visible, disabled with a hint, for the session.
  // A second click while the first create is in flight must not make a second folder.
  const folderBusy = useRef(false);
  const [unavailable, setUnavailable] = useState<ReadonlySet<CreateType>>(new Set());

  const create = async (type: CreateType, parentId: string | null) => {
    try {
      if (type === "page") {
        const doc = await createPage.mutateAsync({
          title: t("documents.page.new_page"),
          ...(parentId ? { parent_id: parentId } : {}),
        });
        onOpen(doc.id);
        return;
      }
      const doc = await createBlank.mutateAsync({
        format: type satisfies BlankDocumentFormat,
        title: t(`documents.home.default_names.${type}`),
        ...(parentId ? { parentId } : {}),
        idempotencyKey: createSafeId(),
      });
      onOpen(doc.id);
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
    try {
      const folder = await createFolder.mutateAsync({
        title: (customTitle ?? t("documents.home.folders.default_name")).trim(),
        ...(parentId ? { parentId } : {}),
        idempotencyKey: createSafeId(),
      });
      toast.success(t("documents.home.folders.toast.created", { title: folder.title }));
      return folder.id;
    } catch (error) {
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
