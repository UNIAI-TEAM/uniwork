"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import {
  isNotAFolderError,
  parseFolderAccessBatchRunning,
  type FolderContentsAccessMode,
} from "@uniwork/core/api/endpoints/documents-folder-contents-access";
import {
  parseDocumentAccessRejected,
  type DocumentAccessRejectedCode,
  type DocumentShareCandidate,
} from "@uniwork/core/api/endpoints/documents-sharing";
import {
  useApplyFolderContentsAccess,
  usePreviewFolderContentsAccess,
} from "@uniwork/core/documents/hooks-folder-contents-access";
import { useDocumentShareCandidates } from "@uniwork/core/documents/hooks-sharing";
import type { DocumentAccessLevel } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useOptionalWorkspace } from "../layout/workspace-context";
import {
  buildItems,
  principalKey,
  rejectedKeys,
  type FolderAccessSummary,
  type PickedPrincipal,
  type WorkspaceRowLevel,
} from "./folder-contents-access-model";
import { FolderAccessPrincipals, useAccessLevelLabel } from "./folder-contents-access-principals";
import { FolderContentsAccessProgress, useFolderAccessToasts } from "./folder-contents-access-progress";
import { FolderContentsAccessSummary } from "./folder-contents-access-summary";
import { ShareCandidatePicker } from "./share-candidate-picker";

const MODES: readonly FolderContentsAccessMode[] = ["merge", "replace"];

/** The folder the dialog changes: its id for the routes, its workspace for the root row. */
export interface FolderAccessTarget {
  id: string;
  title: string;
  workspace_id: string;
}

/** A background batch to keep following after the dialog closes. */
export interface TrackedFolderBatch {
  batchId: string;
  folderId: string;
}

type Stage = "form" | "summary" | "progress";

/**
 * "Chia sẻ các tài liệu bên trong…" (UNI-2244): the bulk mode of the share
 * popup. One access list is written onto every document of the folder's subtree
 * the person manages. Confirm runs a dry run and shows what would change;
 * Apply either answers at once (a toast) or becomes a background batch with a
 * progress bar. Mount it only while a folder is chosen: closing unmounts it, so
 * every open starts from the default Add mode.
 */
export function FolderContentsAccessDialog({
  wsId,
  folder,
  onOpenChange,
  onTrackBatch,
}: {
  wsId: string;
  folder: FolderAccessTarget;
  onOpenChange: (open: boolean) => void;
  /** A background batch started (or was already running): the host keeps polling it after close and says the result. */
  onTrackBatch: (batch: TrackedFolderBatch) => void;
}) {
  const { t } = useTranslation();
  const levelLabel = useAccessLevelLabel();
  const toasts = useFolderAccessToasts();
  const baseId = useId();
  const workspace = useOptionalWorkspace()?.workspace;
  const workspaceName =
    workspace && workspace.id === folder.workspace_id
      ? t("documents.folderAccess.workspace_row", { name: workspace.name })
      : t("documents.folderAccess.workspace_row_unnamed");

  const [stage, setStage] = useState<Stage>("form");
  const [mode, setMode] = useState<FolderContentsAccessMode>("merge");
  const [picked, setPicked] = useState<PickedPrincipal[]>([]);
  const [workspaceLevel, setWorkspaceLevel] = useState<WorkspaceRowLevel>("none");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rejectedByKey, setRejectedByKey] = useState<Record<string, DocumentAccessRejectedCode>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FolderAccessSummary | null>(null);
  const [batch, setBatch] = useState<{ id: string; alreadyRunning: boolean } | null>(null);
  const preview = usePreviewFolderContentsAccess(wsId);
  const apply = useApplyFolderContentsAccess(wsId);
  const busy = preview.isPending || apply.isPending;

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebounced(trimmed), trimmed ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  const candidatesQuery = useDocumentShareCandidates(wsId, folder.id, { q: debounced, enabled: stage === "form" });
  const serverItems = candidatesQuery.items;
  const candidates = useMemo<DocumentShareCandidate[]>(() => serverItems.map((item) => ({ ...item, direct_level: null })), [serverItems]);
  const workspaceKey = principalKey("workspace", folder.workspace_id);
  // In replace mode the workspace root row stands for the home workspace: it is not picked twice.
  const selectedKeys = useMemo(
    () => new Set([...picked.map((p) => p.key), ...(mode === "replace" ? [workspaceKey] : [])]),
    [picked, mode, workspaceKey],
  );

  const items = buildItems(mode, picked, folder.workspace_id, workspaceLevel);
  // Merge needs a principal to add; replace may be empty (it removes whoever is not listed).
  const canReview = mode === "replace" || items.length > 0;

  const changeMode = (next: FolderContentsAccessMode) => {
    if (next === mode) return;
    if (next === "replace") {
      // A picked home workspace moves onto its own row.
      const home = picked.find((p) => p.key === workspaceKey);
      if (home && (home.level === "view" || home.level === "comment" || home.level === "edit")) setWorkspaceLevel(home.level);
      setPicked((prev) => prev.filter((p) => p.key !== workspaceKey));
    }
    setMode(next);
    setRejectedByKey({});
    setFormError(null);
  };

  const showBatch = (id: string, alreadyRunning: boolean) => {
    onTrackBatch({ batchId: id, folderId: folder.id });
    setBatch({ id, alreadyRunning });
    setStage("progress");
  };

  const handleError = (err: unknown, sent: typeof items) => {
    const running = parseFolderAccessBatchRunning(err);
    if (running) {
      showBatch(running.batch_id, true);
      return;
    }
    const rejected = parseDocumentAccessRejected(err);
    if (rejected && rejected.rejected.length > 0) {
      setRejectedByKey(rejectedKeys(sent, rejected.rejected));
      setFormError(t("documents.folderAccess.error_rejected"));
      setStage("form");
      return;
    }
    toast.error(isNotAFolderError(err) ? t("documents.folderAccess.error_not_a_folder") : (apiErrorMessage(err) ?? t("documents.folderAccess.error_generic")));
  };

  const review = async () => {
    if (busy || !canReview) return;
    setRejectedByKey({});
    setFormError(null);
    try {
      const result = await preview.mutateAsync({ folderId: folder.id, input: { mode, items } });
      if (result.kind !== "dry_run") return;
      setSummary({ mode, items, total: result.total, preview: result.preview });
      setStage("summary");
    } catch (err) {
      handleError(err, items);
    }
  };

  const confirm = async () => {
    if (busy || !summary || summary.preview.changed === 0) return;
    try {
      const result = await apply.mutateAsync({ folderId: folder.id, input: { mode: summary.mode, items: summary.items } });
      if (result.kind === "background") {
        showBatch(result.batch_id, false);
      } else if (result.kind === "sync") {
        toasts.applied(result);
        onOpenChange(false);
      }
    } catch (err) {
      handleError(err, summary.items);
    }
  };

  const modeLabel = (value: FolderContentsAccessMode) =>
    value === "replace" ? t("documents.folderAccess.mode_replace") : t("documents.folderAccess.mode_merge");
  const ids = { mode: `${baseId}-mode`, modeHint: `${baseId}-mode-hint`, input: `${baseId}-input`, listbox: `${baseId}-listbox`, principals: `${baseId}-principals` };
  const replacing = summary?.mode === "replace";
  const title = folder.title ? t("documents.folderAccess.title", { title: folder.title }) : t("documents.folderAccess.title_untitled");

  return (
    <Dialog open onOpenChange={(next) => (!next && busy ? undefined : onOpenChange(next))}>
      <DialogContent closeLabel={t("common.close")} className="max-h-[85vh] overflow-y-auto sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription>{t("documents.folderAccess.fixed_sentence")}</DialogDescription>
        </DialogHeader>

        {stage === "form" ? (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={ids.mode}>{t("documents.folderAccess.mode_label")}</Label>
              <Select value={mode} items={MODES.map((value) => ({ value, label: modeLabel(value) }))} onValueChange={(value) => changeMode(value as FolderContentsAccessMode)}>
                <SelectTrigger id={ids.mode} aria-describedby={ids.modeHint} className="w-full">
                  <SelectValue className="min-w-0">{modeLabel(mode)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((value) => (
                    <SelectItem key={value} value={value}>{modeLabel(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id={ids.modeHint} className="text-caption break-words text-muted-foreground">
                {mode === "replace" ? t("documents.folderAccess.mode_replace_hint") : t("documents.folderAccess.mode_merge_hint")}
              </p>
            </div>

            <section aria-labelledby={ids.principals} className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-border p-3">
              <h3 id={ids.principals} className="text-label font-medium text-foreground">{t("documents.folderAccess.principals_title")}</h3>
              <ShareCandidatePicker
                inputId={ids.input} listboxId={ids.listbox} query={query} onQueryChange={setQuery}
                selected={[]} selectedKeys={selectedKeys} candidates={candidates}
                hasMore={Boolean(candidatesQuery.hasNextPage)} loadingMore={candidatesQuery.isFetchingNextPage}
                loadMoreError={candidatesQuery.isFetchNextPageError} loadError={candidatesQuery.isError && !candidatesQuery.data}
                onRetry={() => void candidatesQuery.refetch()} onLoadMore={() => void candidatesQuery.fetchNextPage()}
                isLoading={candidatesQuery.isLoading} disabled={busy}
                rejectedByKey={{}}
                onSelectCandidate={(candidate) => {
                  const key = principalKey(candidate.principal_type, candidate.principal_id);
                  if (selectedKeys.has(key)) return;
                  setPicked((prev) => [...prev, { key, candidate, level: "view" }]);
                  setQuery("");
                }}
                onRemoveCandidate={() => {}}
                onChangeOnExisting={() => {}}
                effectiveItemLevel={() => "view"}
                levelLabel={levelLabel}
                rejectedReasonLabel={() => t("documents.share.rejected_unknown")}
              />
              {picked.length === 0 && mode === "merge" ? (
                <p className="text-caption break-words text-muted-foreground">{t("documents.folderAccess.principals_empty_merge")}</p>
              ) : null}
              {picked.length === 0 && mode === "replace" ? (
                <p className="text-caption break-words text-muted-foreground">{t("documents.folderAccess.principals_empty_replace")}</p>
              ) : null}
              <FolderAccessPrincipals
                mode={mode} picked={picked} workspaceName={workspaceName} workspaceLevel={workspaceLevel}
                rejectedByKey={rejectedByKey} disabled={busy}
                onLevel={(key, level: DocumentAccessLevel) => {
                  setPicked((prev) => prev.map((p) => (p.key === key ? { ...p, level } : p)));
                  setRejectedByKey({});
                }}
                onRemove={(key) => {
                  setPicked((prev) => prev.filter((p) => p.key !== key));
                  setRejectedByKey({});
                }}
                onWorkspaceLevel={setWorkspaceLevel}
              />
            </section>
            {formError ? <p role="alert" className="text-caption break-words text-destructive">{formError}</p> : null}
          </div>
        ) : null}

        {stage === "summary" && summary ? <FolderContentsAccessSummary summary={summary} /> : null}

        {stage === "progress" && batch ? (
          <FolderContentsAccessProgress wsId={wsId} folderId={folder.id} batchId={batch.id} alreadyRunning={batch.alreadyRunning} />
        ) : null}

        <DialogFooter>
          {stage === "form" ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="button" aria-disabled={!canReview || busy || undefined} aria-busy={busy || undefined} onClick={() => void review()}>
                {busy ? <><Spinner aria-hidden role="presentation" />{t("documents.folderAccess.checking")}</> : t("documents.folderAccess.confirm")}
              </Button>
            </>
          ) : null}
          {stage === "summary" ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setStage("form")}>{t("documents.folderAccess.back")}</Button>
              <Button
                type="button"
                variant={replacing ? "destructive" : "default"}
                aria-disabled={!summary || summary.preview.changed === 0 || busy || undefined}
                aria-busy={busy || undefined}
                onClick={() => void confirm()}
              >
                {busy
                  ? <><Spinner aria-hidden role="presentation" />{t("documents.folderAccess.applying")}</>
                  : replacing ? t("documents.folderAccess.apply_replace") : t("documents.folderAccess.apply")}
              </Button>
            </>
          ) : null}
          {stage === "progress" ? (
            <Button type="button" onClick={() => onOpenChange(false)}>{t("documents.folderAccess.progress_close")}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
