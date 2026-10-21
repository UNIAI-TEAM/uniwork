"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { BlankDocumentFormat } from "@uniwork/core/api/endpoints/documents-blank";
import { useCreateDocument } from "@uniwork/core/documents/hooks";
import { isEndpointMissing, useCreateBlankFile, useCreateFolder } from "@uniwork/core/documents/hooks-library";
import { defaultStorage } from "@uniwork/core/platform";
import { createSafeId } from "@uniwork/core/utils";
import { documentErrorMessage } from "./document-error-message";

/** What the create cards and the "New" menu offer, in the design's order. */
export const CREATE_TYPES = ["page", "docx", "xlsx", "pptx", "md", "txt", "html", "pdf"] as const;
export type CreateType = (typeof CREATE_TYPES)[number];

/** The "Tạo nhanh" strip: UniNote and the three Office formats; the rest live only in the New menu (user 2026-10-21). */
const QUICK_CREATE_TYPES = ["page", "docx", "xlsx", "pptx"] as const satisfies readonly CreateType[];

/**
 * The strip plus the type created last when it is not already one of them
 * (user 2026-10-21): someone who keeps making Markdown files gets a pill for it.
 */
export function quickCreateTypes(recent: CreateType | null | undefined): readonly CreateType[] {
  const base: readonly CreateType[] = QUICK_CREATE_TYPES;
  return recent && !base.includes(recent) ? [...base, recent] : base;
}

// Per device and per workspace by design, like the mention recency: the goal
// is a faster next create, not a cross-device preference.
const LAST_CREATE_KEY = "uniwork:documents:last-create-type:";

function readLastCreateType(wsId: string): CreateType | null {
  try {
    const raw = defaultStorage.getItem(`${LAST_CREATE_KEY}${wsId}`);
    return CREATE_TYPES.find((type) => type === raw) ?? null;
  } catch {
    return null;
  }
}

function writeLastCreateType(wsId: string, type: CreateType): void {
  try {
    defaultStorage.setItem(`${LAST_CREATE_KEY}${wsId}`, type);
  } catch {
    // Storage full or disabled: the strip just keeps its fixed pills.
  }
}

/** What the "New" menu offers inside an open folder: folder first, then CREATE_TYPES (FD-D9). */
export const CREATE_MENU_TYPES = ["folder", ...CREATE_TYPES] as const;
export type CreateMenuType = (typeof CREATE_MENU_TYPES)[number];

export interface CreateShareOptions {
  shareWithWorkspace?: boolean;
}

type ParentShareSource = {
  kind?: string | null;
  visibility?: string | null;
  share_scope?: { home_workspace?: boolean } | null;
};

/**
 * True when the parent PAGE already has a grant for its home workspace
 * (`share_scope.home_workspace === true`, or `visibility === "workspace"` when
 * `share_scope` is absent). Under a shared parent, the create toggle is locked
 * on and the client omits `visibility` so the server inherits from the parent.
 * A folder is never a shared parent (UNI-1974): the server starts its children
 * private, so the toggle stays free whatever a legacy folder row still says.
 */
export function isParentWorkspaceShared(parent?: ParentShareSource | null, fallback?: ParentShareSource | null): boolean {
  if ((parent?.kind ?? fallback?.kind) === "folder") return false;
  const shareScope = parent?.share_scope ?? fallback?.share_scope;
  if (shareScope != null) return Boolean(shareScope.home_workspace);
  const visibility = parent?.visibility ?? fallback?.visibility;
  return visibility === "workspace";
}

/**
 * Create one document of a type in the open folder with its default name and
 * open it — no name prompt (user decision 2026-10-12); renaming happens on the
 * document's breadcrumb. A page keeps the "New UniNote" flow; the seven file
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
  const folderKeyRef = useRef<{ title: string; parentId: string | null; key: string } | null>(null);
  const [unavailable, setUnavailable] = useState<ReadonlySet<CreateType>>(new Set());
  const [lastType, setLastType] = useState<CreateType | null>(() => readLastCreateType(wsId));
  const remember = (type: CreateType) => {
    writeLastCreateType(wsId, type);
    setLastType(type);
  };

  const create = async (type: CreateType, parentId: string | null) => {
    try {
      if (type === "page") {
        const doc = await createPage.mutateAsync({
          title: t("documents.page.new_page"),
          ...(parentId ? { parent_id: parentId } : { destination: "my_folder" as const }),
        });
        remember(type);
        onOpen(doc.id);
        return;
      }
      const doc = await createBlank.mutateAsync({
        format: type satisfies BlankDocumentFormat,
        title: t(`documents.home.default_names.${type}`),
        ...(parentId ? { parent_id: parentId } : { destination: "my_folder" as const }),
        idempotencyKey: createSafeId(),
      });
      remember(type);
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
    lastType,
    pending: createPage.isPending || createBlank.isPending,
    folderPending: createFolder.isPending,
  };
}
