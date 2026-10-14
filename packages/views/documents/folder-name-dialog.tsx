"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FOLDER_TITLE_MAX } from "@uniwork/core/documents/folder-limits";
import { useUpdateDocument } from "@uniwork/core/documents/hooks";
import { useCreateFolder } from "@uniwork/core/documents/hooks-library";
import { documentKeys } from "@uniwork/core/documents/keys";
import { createSafeId } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { documentErrorMessage } from "./document-error-message";
import { loadMoveRevision } from "./document-tree-model";
import { knownDocuments } from "./starred-rows";

export interface FolderNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "rename";
  /** Explicit dialog title; when omitted, derived from `mode`, `parentTitle`, and `root`. */
  title?: string;
  /** Parent folder name for `documents.home.folders.create_sub_title`. */
  parentTitle?: string;
  /** True when creating at the Documents root (`documents.home.folders.create_title_root`). */
  root?: boolean;
  /** Initial folder name (used when renaming). */
  initialName?: string;
  /** Workspace ID when the dialog executes the create/rename mutation directly. */
  wsId?: string;
  /** Parent folder ID for create mode (`null` or omitted = root). */
  parentId?: string | null;
  /** Target folder ID for rename mode. */
  folderId?: string;
  /** Called with the server-verified folder after a successful create or rename. */
  onSuccess?: (folder: { id: string; title: string }) => void;
  /** Custom submit handler; when omitted, `wsId` drives the create/rename request. */
  onSubmit?: (title: string) => Promise<boolean | void> | boolean | void;
  pending?: boolean;
  error?: string | null;
}

/**
 * Shared create / rename folder dialog (addendum §3.6, FD-07 & FD-08):
 * validates blank and >255-character names before any network call, surfaces
 * `409 folder_name_taken` at the field, and toasts only after the server
 * answers with a verifiable folder.
 */
export function FolderNameDialog({
  open,
  onOpenChange,
  mode,
  title,
  parentTitle,
  root = false,
  initialName = "",
  wsId = "",
  parentId = null,
  folderId = "",
  onSuccess,
  onSubmit,
  pending: externalPending = false,
  error: externalError = null,
}: FolderNameDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const createFolder = useCreateFolder(wsId);
  const updateFolder = useUpdateDocument(wsId, folderId);
  const [draft, setDraft] = useState(initialName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<{ title: string; parentId: string | null; key: string } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initialName);
      setFieldError(null);
      keyRef.current = null;
    }
  }, [open, mode, initialName]);

  const isPending = externalPending || busy || createFolder.isPending || updateFolder.isPending;
  const displayError = fieldError ?? externalError;
  const fallbackKey =
    mode === "create" ? "documents.home.folders.create_failed" : "documents.home.folders.rename_failed";

  const dialogTitle =
    title ??
    (mode === "rename"
      ? t("documents.home.folders.rename")
      : parentTitle !== undefined
        ? t("documents.home.folders.create_sub_title", {
            parent: parentTitle || t("documents.detail.untitled"),
          })
        : root
          ? t("documents.home.folders.create_title_root")
          : t("documents.home.folders.create_title"));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    const trimmed = draft.trim().normalize("NFC");
    if (!trimmed) {
      setFieldError(t("documents.home.folders.name_empty"));
      return;
    }
    if ([...trimmed].length > FOLDER_TITLE_MAX) {
      setFieldError(t("documents.home.folders.name_too_long", { max: FOLDER_TITLE_MAX }));
      return;
    }
    setFieldError(null);

    if (onSubmit) {
      setBusy(true);
      try {
        const ok = await onSubmit(trimmed);
        if (ok !== false) onOpenChange(false);
      } catch (err) {
        setFieldError(documentErrorMessage(err, t, fallbackKey));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!wsId) return;
    setBusy(true);
    try {
      if (mode === "create") {
        if (keyRef.current?.title !== trimmed || keyRef.current.parentId !== parentId) {
          keyRef.current = { title: trimmed, parentId, key: createSafeId() };
        }
        const created = await createFolder.mutateAsync({
          title: trimmed,
          ...(parentId ? { parentId } : {}),
          idempotencyKey: keyRef.current.key,
        });
        keyRef.current = null;
        toast.success(t("documents.home.folders.toast.created", { title: created.title }));
        onOpenChange(false);
        onSuccess?.({ id: created.id, title: created.title });
      } else {
        const cached = knownDocuments(
          queryClient.getQueriesData({ queryKey: documentKeys.workspace(wsId) }),
        ).get(folderId)?.revision;
        const revision =
          (await loadMoveRevision(queryClient, wsId, folderId).catch(() => null)) ?? cached;
        if (!revision) {
          setFieldError(t("documents.home.folders.rename_failed"));
          return;
        }
        const updated = await updateFolder.mutateAsync({
          patch: { revision, title: trimmed },
        });
        await queryClient.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
        toast.success(t("documents.home.folders.toast.renamed", { title: updated.title }));
        onOpenChange(false);
        onSuccess?.({ id: updated.id, title: updated.title });
      }
    } catch (err) {
      setFieldError(documentErrorMessage(err, t, fallbackKey));
    } finally {
      setBusy(false);
    }
  };

  const baseId = useId();
  const inputId = `${baseId}-folder-name-input`;
  const errorId = `${baseId}-folder-name-error`;

  return (
    <Dialog open={open} onOpenChange={(next) => (isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isPending} closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>{t("documents.home.folders.rename_label")}</Label>
            <Input
              id={inputId}
              value={draft}
              placeholder={t("documents.home.folders.name_placeholder")}
              aria-invalid={displayError ? true : undefined}
              aria-describedby={displayError ? errorId : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                if (fieldError) setFieldError(null);
              }}
            />
            {displayError ? (
              <p id={errorId} role="alert" className="text-caption text-destructive">
                {displayError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-disabled={isPending || undefined}
              onClick={() => {
                if (!isPending) onOpenChange(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              aria-disabled={isPending || undefined}
              aria-busy={isPending || undefined}
            >
              {isPending ? <Spinner aria-hidden role="presentation" /> : null}
              {t(
                mode === "create"
                  ? "documents.home.folders.create_submit"
                  : "documents.home.folders.rename_submit",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
