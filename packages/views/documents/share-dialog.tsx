"use client";

import { useMemo, useState } from "react";
import { Building2, Link2, ShieldCheck, UserRound, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { useUpdateDocument } from "@uniwork/core/documents/hooks";
import {
  useDocumentShares,
  useRevokeDocumentShare,
  useShareDocument,
} from "@uniwork/core/documents/hooks-sharing";
import { useOrgMembers, useOrgWorkspaces } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import type {
  Document,
  DocumentAccess,
  DocumentAccessLevel,
  DocumentAccessVia,
} from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { ShareLinksSection } from "./share-links-section";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: Document;
}

const LEVELS: readonly DocumentAccessLevel[] = ["view", "edit", "manage"];
const PRINCIPAL_TYPES = ["user", "workspace", "organization"] as const;
type PrincipalType = (typeof PRINCIPAL_TYPES)[number];
/** The schema keeps nested rows as raw strings; the hook's answer is the source. */
type AccessShare = NonNullable<DocumentAccess["shares"]>[number];

/**
 * `documents.detail` share dialog (C-01 §5.3; G1-08, UNI-682).
 *
 * Three principals (person, workspace, organization) × three levels. The list
 * is the access that actually exists — the caller's own level always, the ACL
 * owner and the live grants only at manage level — and every write is a
 * server round-trip with its own failure state. A public link's raw URL exists
 * in this dialog once: losing it means minting a new one, never rebuilding it
 * from the hash the server keeps.
 *
 * Owned (work-product) documents never open this dialog: their access is
 * delegated through the owning screen, so no control here could be honest.
 */
export function ShareDialog({ open, onOpenChange, wsId, doc }: ShareDialogProps) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const canManage = doc.my_level === "manage";
  const owned = !!doc.owner_kind;

  const access = useDocumentShares(wsId, doc.id, { enabled: open && canManage && !owned });
  const share = useShareDocument(wsId, doc.id);
  const revokeShare = useRevokeDocumentShare(wsId, doc.id);
  const update = useUpdateDocument(wsId, doc.id);

  const members = useOrgMembers(workspace.organization_slug);
  const orgWorkspaces = useOrgWorkspaces(doc.organization_id);

  const [principalType, setPrincipalType] = useState<PrincipalType>("user");
  const [principalId, setPrincipalId] = useState<string>("");
  const [level, setLevel] = useState<DocumentAccessLevel>("view");
  const [addError, setAddError] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);

  const memberRows = useMemo(
    () => members.data?.pages.flatMap((page) => page.members) ?? [],
    [members.data],
  );

  const memberName = (userId: string) =>
    memberRows.find((m) => m.user_id === userId)?.display_name || userId;
  const workspaceName = (id: string) =>
    orgWorkspaces.data?.find((w) => w.id === id)?.name || id;

  const principalName = (row: AccessShare) => {
    switch (row.principal_type) {
      case "user":
        return memberName(row.principal_id);
      case "workspace":
        return workspaceName(row.principal_id);
      case "organization":
        return workspace.organization_name;
      default:
        return row.principal_id;
    }
  };

  const levelLabel = (value: string | null | undefined) => {
    const key = `documents.share.level_${value ?? ""}`;
    const fallback = t("documents.share.level_view");
    return LEVELS.includes(value as DocumentAccessLevel) ? t(key) : fallback;
  };
  const viaLabel = (via: string | null | undefined) => {
    const key = `documents.share.via_${via ?? ""}`;
    return via ? t(key, { defaultValue: via }) : "";
  };

  const principalItems = useMemo(() => {
    switch (principalType) {
      case "user":
        return memberRows.map((m) => ({
          value: m.user_id,
          label: m.display_name ? `${m.display_name} · ${m.email}` : m.email,
        }));
      case "workspace":
        return (orgWorkspaces.data ?? []).map((w) => ({ value: w.id, label: w.name }));
      default:
        return [{ value: doc.organization_id, label: workspace.organization_name }];
    }
  }, [principalType, memberRows, orgWorkspaces.data, doc.organization_id, workspace.organization_name]);

  const submitShare = async () => {
    if (!principalId || share.isPending) return;
    setAddError(null);
    try {
      await share.mutateAsync({ principal_type: principalType, principal_id: principalId, level });
      setPrincipalId("");
    } catch (err) {
      setAddError(apiErrorMessage(err) ?? t("documents.share.submit_failed"));
    }
  };

  const saveVisibility = async (next: "workspace" | "restricted") => {
    if (update.isPending || next === doc.visibility) return;
    setVisibilityError(null);
    try {
      await update.mutateAsync({ patch: { visibility: next, revision: doc.revision } });
    } catch (err) {
      const cls = classifyDocumentError(err).cls;
      setVisibilityError(
        cls === "conflict"
          ? t("documents.versions.restore_conflict")
          : apiErrorMessage(err) ?? t("documents.share.visibility_failed"),
      );
    }
  };

  const shares = access.data?.shares ?? [];

  // Owned documents have no share surface at all: their access is delegated
  // through the owning work product, and the server refuses every grant route.
  if (owned) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-xl" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("documents.share.title")}</DialogTitle>
          <DialogDescription>{t("documents.share.description")}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 max-h-[65dvh] overflow-y-auto px-4">
          {!canManage ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground">
              {t("documents.share.manage_only")}
            </p>
          ) : access.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : access.isError || !access.data ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
              <p role="alert" className="text-caption text-destructive">
                {t("documents.share.error")}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void access.refetch()}>
                {t("documents.share.retry")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <section aria-labelledby="share-access-title" className="rounded-lg border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <h3 id="share-access-title" className="text-label font-medium text-foreground">
                    {t("documents.share.access_title")}
                  </h3>
                  <span className="text-caption text-muted-foreground">
                    {t("documents.share.my_level", { level: levelLabel(access.data.my_level) })}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {access.data.acl_owner ? (
                    <li className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
                        <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {memberName(access.data.acl_owner.user_id)}
                        </span>
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {t("documents.share.acl_owner")}
                        </span>
                      </span>
                      <span className="shrink-0 text-caption text-muted-foreground">
                        {levelLabel(access.data.acl_owner.level)}
                      </span>
                    </li>
                  ) : null}
                  {shares.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-body text-foreground">
                        {row.principal_type === "user" ? (
                          <UserRound aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : row.principal_type === "workspace" ? (
                          <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <Users aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{principalName(row)}</span>
                        {!row.active ? (
                          <span className="shrink-0 text-caption text-muted-foreground">
                            {t("documents.share.inactive")}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-caption text-muted-foreground">
                          {levelLabel(row.level)}
                          {row.effective_level && row.effective_level !== row.level
                            ? ` · ${t("documents.share.effective", { level: levelLabel(row.effective_level) })}`
                            : ""}
                          {row.effective_via ? ` · ${viaLabel(row.effective_via)}` : ""}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${t("documents.share.revoke")} ${principalName(row)}`}
                          disabled={revokeShare.isPending}
                          aria-busy={(revokeShare.isPending && revokeShare.variables === row.id) || undefined}
                          onClick={() => {
                            setAddError(null);
                            revokeShare.mutate(row.id);
                          }}
                        >
                          {revokeShare.isPending && revokeShare.variables === row.id ? (
                            <Spinner aria-hidden role="presentation" />
                          ) : null}
                          {t("documents.share.revoke")}
                        </Button>
                      </span>
                    </li>
                  ))}
                  {!shares.length && !access.data.acl_owner ? (
                    <li className="px-3 py-2 text-caption text-muted-foreground">
                      {t("documents.share.no_grants")}
                    </li>
                  ) : null}
                </ul>
              </section>

              <section aria-labelledby="share-add-title" className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <h3 id="share-add-title" className="text-label font-medium text-foreground">
                  {t("documents.share.add_title")}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="share-principal-type">{t("documents.share.principal_label")}</Label>
                    <Select
                      items={PRINCIPAL_TYPES.map((value) => ({
                        value,
                        label: t(`documents.share.principal_${value}`),
                      }))}
                      value={principalType}
                      onValueChange={(next) => {
                        const picked = next as PrincipalType;
                        setPrincipalType(picked);
                        setPrincipalId(picked === "organization" ? doc.organization_id : "");
                        setAddError(null);
                      }}
                    >
                      <SelectTrigger id="share-principal-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRINCIPAL_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`documents.share.principal_${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="share-principal-id">{t("documents.share.principal_placeholder")}</Label>
                    <Select
                      items={principalItems}
                      value={principalId || null}
                      onValueChange={(next) => {
                        setPrincipalId(typeof next === "string" ? next : "");
                        setAddError(null);
                      }}
                    >
                      <SelectTrigger id="share-principal-id" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {principalItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="share-level">{t("documents.share.level_label")}</Label>
                    <Select
                      items={LEVELS.map((value) => ({ value, label: levelLabel(value) }))}
                      value={level}
                      onValueChange={(next) => setLevel(next as DocumentAccessLevel)}
                    >
                      <SelectTrigger id="share-level" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEVELS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {levelLabel(value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      className="w-full"
                      disabled={!principalId || share.isPending}
                      aria-busy={share.isPending || undefined}
                      onClick={() => void submitShare()}
                    >
                      {share.isPending ? (
                        <>
                          <Spinner aria-hidden role="presentation" />
                          {t("documents.share.submitting")}
                        </>
                      ) : (
                        <>
                          <Link2 aria-hidden className="size-3.5" />
                          {t("documents.share.submit")}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {addError ? (
                  <p role="alert" className="text-caption text-destructive">
                    {addError}
                  </p>
                ) : null}
              </section>

              <VisibilitySection
                doc={doc}
                pending={update.isPending}
                error={visibilityError}
                onSave={(next) => void saveVisibility(next)}
              />

              <ShareLinksSection
                wsId={wsId}
                doc={doc}
                onOpenSettings={() => push(`${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=documents`)}
                locale={i18n.language}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VisibilitySection({
  doc,
  pending,
  error,
  onSave,
}: {
  doc: Document;
  pending: boolean;
  error: string | null;
  onSave: (next: "workspace" | "restricted") => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<"workspace" | "restricted" | null>(null);
  const current = choice ?? doc.visibility;
  const changed = current !== doc.visibility;

  return (
    <section aria-labelledby="share-visibility-title" className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <h3 id="share-visibility-title" className="text-label font-medium text-foreground">
        {t("documents.share.visibility_title")}
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["workspace", "restricted"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={current === value}
            disabled={pending}
            onClick={() => setChoice(value)}
            className={
              current === value
                ? "rounded-lg border border-primary bg-primary/5 px-3 py-2 text-left"
                : "rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-hover"
            }
          >
            <span className="block text-body font-medium text-foreground">
              {t(`documents.share.visibility_${value}`)}
            </span>
            <span className="block text-caption text-muted-foreground">
              {t(`documents.share.visibility_${value}_hint`)}
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!changed || pending}
          aria-busy={pending || undefined}
          onClick={() => {
            if (current === "workspace" || current === "restricted") onSave(current);
          }}
        >
          {pending ? (
            <>
              <Spinner aria-hidden role="presentation" />
              {t("documents.share.visibility_saving")}
            </>
          ) : (
            t("documents.share.visibility_save")
          )}
        </Button>
      </div>
    </section>
  );
}

