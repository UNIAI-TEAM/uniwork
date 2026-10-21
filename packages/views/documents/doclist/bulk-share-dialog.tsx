"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { DocumentAccessRejectedCode, DocumentShareCandidate } from "@uniwork/core/api/endpoints/documents-sharing";
import { useBulkShareDocuments, type BulkShareLink, type BulkShareResult, type BulkShareWorkspace } from "@uniwork/core/documents/hooks-bulk-share";
import { useDocumentShareCandidates } from "@uniwork/core/documents/hooks-sharing";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { DOCUMENT_ACCESS_LEVELS, type DocumentAccessLevel } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { allowedLevelsForPrincipal, type SelectedShareCandidate } from "../share-add-section";
import { ShareCandidatePicker } from "../share-candidate-picker";
import type { BulkPlan } from "./bulk-actions";

const WORKSPACE_CHOICES: readonly BulkShareWorkspace[] = ["keep", "view", "comment", "edit", "none"];
const LINK_CHOICES: readonly BulkShareLink[] = ["keep", "create", "revoke"];

/** A created link's URL on the app origin, as the single dialog shows it. */
function absoluteUrl(url: string): string {
  try {
    return new URL(url, runtimeConfig().appUrl).toString();
  } catch {
    return url;
  }
}

function CreatedLinks({ links, titles }: { links: BulkShareResult["links"]; titles: ReadonlyMap<string, string> }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const label = t("documents.list.bulk.share.links_created");
  const lines = links.map((link) => ({ ...link, title: titles.get(link.id) || t("documents.detail.untitled"), url: absoluteUrl(link.url) }));
  const copyAll = () => {
    // The row menu's helper: it falls back where the async clipboard is absent, and a failure says so.
    void copyText(lines.map((line) => `${line.title}\t${line.url}`).join("\n")).then((ok) => {
      setCopied(ok);
      if (!ok) toast.error(t("documents.list.menu.link_copy_failed"));
    });
  };
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="text-label font-medium text-foreground">{label}</p>
      <ul aria-label={label} className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
        {lines.map((line) => (
          <li key={line.id} className="flex min-w-0 flex-col">
            <span className="truncate text-caption text-foreground" title={line.title}>
              {line.title}
            </span>
            <span className="break-all font-mono text-caption text-muted-foreground">{line.url}</span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">{t("documents.share.link_url_once")}</p>
      <div>
        <Button type="button" size="sm" onClick={copyAll}>
          {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
          {copied ? t("documents.share.link_copied") : t("documents.list.bulk.share.copy_all")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Chia sẻ on the bulk bar (UNI-2045 W13): the single share dialog's add area
 * (the same picker and levels), its home-workspace row and its link choice,
 * applied the same way to every document of the plan. There is no access
 * list, since it differs per document: the dialog shows only what it will
 * apply. A picked person who already has a direct grant keeps it unless the
 * box says otherwise, the single dialog's default. Created link URLs are
 * shown here once, like the single dialog's.
 */
export function BulkShareDialog({
  wsId,
  plan,
  onOpenChange,
  onApplied,
}: {
  wsId: string;
  /** The share plan, or null when the dialog is closed. */
  plan: BulkPlan | null;
  onOpenChange: (open: boolean) => void;
  /** The batch settled: report it and clear the selection. */
  onApplied: (result: BulkShareResult) => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const open = plan !== null;
  const firstId = plan?.docs[0]?.id ?? "";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<SelectedShareCandidate[]>([]);
  const [level, setLevel] = useState<DocumentAccessLevel>("view");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [workspace, setWorkspace] = useState<BulkShareWorkspace>("keep");
  const [link, setLink] = useState<BulkShareLink>("keep");
  const [expiry, setExpiry] = useState("7");
  const [created, setCreated] = useState<BulkShareResult["links"] | null>(null);
  const share = useBulkShareDocuments(wsId);

  useEffect(() => {
    if (open) return;
    setQuery(""); setDebounced(""); setSelected([]); setLevel("view"); setUpdateExisting(false);
    setWorkspace("keep"); setLink("keep"); setExpiry("7"); setCreated(null);
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebounced(trimmed), trimmed ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  // Candidates come from the first document: the people of the organization
  // are the same for all, but a direct grant is not, so none is shown.
  const candidatesQuery = useDocumentShareCandidates(wsId, firstId, { q: debounced, enabled: open && created === null });
  const serverItems = candidatesQuery.items;
  const candidates = useMemo<DocumentShareCandidate[]>(() => serverItems.map((item) => ({ ...item, direct_level: null })), [serverItems]);
  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected]);

  const levelLabel = (lvl: DocumentAccessLevel | string) =>
    lvl === "manage" ? t("documents.share.level_manage")
    : lvl === "edit" ? t("documents.share.level_edit")
    : lvl === "comment" ? t("documents.share.level_comment")
    : t("documents.share.level_view");
  const effectiveItemLevel = (item: SelectedShareCandidate): DocumentAccessLevel =>
    allowedLevelsForPrincipal(item.candidate.principal_type, item.candidate.is_home_workspace).includes(level) ? level : "edit";
  const workspaceLabel = (choice: BulkShareWorkspace) =>
    choice === "keep" ? t("documents.list.bulk.share.keep")
    : choice === "none" ? t("documents.list.bulk.share.workspace_none")
    : t("documents.list.bulk.share.workspace_level", { level: levelLabel(choice) });
  const linkLabel = (choice: BulkShareLink) => t(`documents.list.bulk.share.link_${choice}`);

  const busy = share.isPending;
  const nothing = selected.length === 0 && workspace === "keep" && link === "keep";
  const blocked = busy || nothing;

  const apply = async () => {
    if (!plan || blocked) return;
    const days = Number.parseInt(expiry, 10);
    const result = await share.mutateAsync({
      docs: plan.docs.map((doc) => ({ id: doc.id, workspace_id: doc.workspace_id })),
      people: selected.map((item) => ({ principal_type: item.candidate.principal_type, principal_id: item.candidate.principal_id, level: effectiveItemLevel(item) })),
      onExisting: updateExisting ? "update" : "keep",
      workspace,
      link,
      expiresInDays: link === "create" && Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : undefined,
    });
    onApplied(result);
    if (result.links.length > 0) setCreated(result.links);
    else onOpenChange(false);
  };

  const count = plan?.docs.length ?? 0;
  const skipped = plan?.skipped.length ?? 0;
  const ids = { input: `${baseId}-input`, listbox: `${baseId}-listbox`, level: `${baseId}-level`, existing: `${baseId}-existing`, workspace: `${baseId}-ws`, link: `${baseId}-link`, expiry: `${baseId}-expiry` };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && busy ? undefined : onOpenChange(next))}>
      <DialogContent closeLabel={t("common.close")} className="max-h-[85vh] overflow-y-auto sm:max-w-lg [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{t("documents.list.bulk.share.title", { count })}</DialogTitle>
          <DialogDescription>
            {t("documents.list.bulk.share.applies_to", { count })}
            {skipped > 0 ? ` ${t("documents.list.bulk.share.skipped_note", { count: skipped })}` : ""}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <CreatedLinks links={created} titles={plan?.titles ?? new Map()} />
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby={`${baseId}-add`} className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-border p-3">
              <h3 id={`${baseId}-add`} className="text-label font-medium text-foreground">
                {t("documents.share.add_title")}
              </h3>
              <ShareCandidatePicker
                inputId={ids.input} listboxId={ids.listbox} query={query} onQueryChange={setQuery}
                selected={selected} selectedKeys={selectedKeys} candidates={candidates}
                hasMore={Boolean(candidatesQuery.hasNextPage)} loadingMore={candidatesQuery.isFetchingNextPage}
                loadMoreError={candidatesQuery.isFetchNextPageError} loadError={candidatesQuery.isError && !candidatesQuery.data}
                onRetry={() => void candidatesQuery.refetch()} onLoadMore={() => void candidatesQuery.fetchNextPage()}
                isLoading={candidatesQuery.isLoading} disabled={busy}
                rejectedByKey={{} as Record<string, DocumentAccessRejectedCode>}
                onSelectCandidate={(candidate) => {
                  const key = `${candidate.principal_type}:${candidate.principal_id}`;
                  if (selectedKeys.has(key)) return;
                  setSelected((prev) => [...prev, { key, candidate, onExisting: "keep" }]);
                  setQuery("");
                }}
                onRemoveCandidate={(key) => setSelected((prev) => prev.filter((item) => item.key !== key))}
                onChangeOnExisting={() => {}}
                effectiveItemLevel={effectiveItemLevel} levelLabel={levelLabel} rejectedReasonLabel={() => t("documents.share.rejected_unknown")}
              />
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex w-40 min-w-0 flex-col gap-1.5">
                  <Label htmlFor={ids.level}>{t("documents.share.level_label")}</Label>
                  <Select value={level} items={DOCUMENT_ACCESS_LEVELS.map((lvl) => ({ value: lvl, label: levelLabel(lvl) }))} onValueChange={(v) => setLevel(v as DocumentAccessLevel)}>
                    <SelectTrigger id={ids.level} className="w-full"><SelectValue className="min-w-0">{levelLabel(level)}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_ACCESS_LEVELS.map((lvl) => <SelectItem key={lvl} value={lvl}>{levelLabel(lvl)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-h-9 min-w-0 items-center gap-2 pointer-coarse:min-h-11">
                  <Checkbox id={ids.existing} checked={updateExisting} onCheckedChange={(checked) => setUpdateExisting(checked === true)} />
                  <Label htmlFor={ids.existing} className="min-w-0 font-normal">{t("documents.list.bulk.share.update_existing")}</Label>
                </div>
              </div>
            </section>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={ids.workspace}>{t("documents.list.bulk.share.workspace_label")}</Label>
                <Select value={workspace} items={WORKSPACE_CHOICES.map((choice) => ({ value: choice, label: workspaceLabel(choice) }))} onValueChange={(v) => setWorkspace(v as BulkShareWorkspace)}>
                  <SelectTrigger id={ids.workspace} className="w-full"><SelectValue className="min-w-0">{workspaceLabel(workspace)}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {WORKSPACE_CHOICES.map((choice) => <SelectItem key={choice} value={choice}>{workspaceLabel(choice)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={ids.link}>{t("documents.list.bulk.share.link_label")}</Label>
                <Select value={link} items={LINK_CHOICES.map((choice) => ({ value: choice, label: linkLabel(choice) }))} onValueChange={(v) => setLink(v as BulkShareLink)}>
                  <SelectTrigger id={ids.link} className="w-full"><SelectValue className="min-w-0">{linkLabel(link)}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {LINK_CHOICES.map((choice) => <SelectItem key={choice} value={choice}>{linkLabel(choice)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {link === "create" ? (
                <div className="flex w-40 min-w-0 flex-col gap-1.5">
                  <Label htmlFor={ids.expiry}>{t("documents.share.link_expiry_label")}</Label>
                  <Input id={ids.expiry} type="number" inputMode="numeric" min={1} max={90} value={expiry} onChange={(event) => setExpiry(event.target.value)} />
                </div>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          {created ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t("documents.list.bulk.share.close")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" aria-disabled={blocked || undefined} aria-busy={busy || undefined} onClick={() => void apply()}>
                {busy ? <><Spinner aria-hidden role="presentation" />{t("documents.share.submitting")}</> : t("documents.share.submit")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
