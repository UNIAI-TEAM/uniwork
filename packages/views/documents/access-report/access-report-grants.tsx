"use client";

import { useState } from "react";
import { Building2, ExternalLink, Link2, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuthStore } from "@uniwork/core/auth";
import { useRevokeReportGrant } from "@uniwork/core/documents/hooks-access-report-revoke";
import { DOCUMENT_ACCESS_LEVELS } from "@uniwork/core/types/document";
import type { AccessReportDocument, AccessReportRow } from "@uniwork/core/types/document-access-report";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { initialOf } from "../../chat/chat-initials";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { AppLink } from "../../navigation";
import { formatWhen } from "../document-format";
import { ShareDialog, type ShareDialogTarget } from "../share-dialog";
import { accessLevelLabel, accessSourceLabel, grantKindNote, principalTypeLabel, revokeText } from "./access-report-labels";

const NONE = "—";

// Below sm the column headers are gone, so each value carries its own small caption.
function Caption({ children }: { children: string }) {
  return (
    <span data-caption className="mr-1 font-medium after:content-[':'] sm:hidden">
      {children}
    </span>
  );
}

const TH = "px-3 py-2 text-left text-caption font-medium whitespace-nowrap text-muted-foreground";
const TD = "px-3 py-2 align-middle";
// Below sm a grant is a wrapping block, not a table row: name on its own line, then the
// level and Revoke, then source and dates, so nothing sits behind a hidden scroll.
const TD_STACKED = "max-sm:block max-sm:px-0 max-sm:py-0";

export interface AccessReportGrantsProps {
  wsId: string;
  entry: AccessReportDocument;
  /** The document's display title (the untitled fallback already applied). */
  title: string;
  documentHref?: (documentId: string) => string;
}

/** The name a grant reads under: its principal, "Anyone with the link", or the kind when the account is gone. */
export function grantName(t: ReturnType<typeof useTranslation>["t"], row: AccessReportRow): string {
  const name = row.principal_name?.trim();
  if (name) return name;
  return row.principal_type === "link" ? t("documents.accessReport.anyone_with_link") : principalTypeLabel(t, row.principal_type);
}

function shareLevel(doc: AccessReportDocument["document"]): ShareDialogTarget["my_level"] {
  const level = DOCUMENT_ACCESS_LEVELS.find((l) => l === doc.my_level);
  if (level) return level;
  return doc.my_level || doc.admin_scope ? "" : "manage";
}

/**
 * The share dialog's target, built from the report (the contract's §4 recipe):
 * the report's workspace and organization, no work-product owner, live. Before
 * the server sends `my_level` every listed document is one the reader
 * manages, so that is the level it opens with; a pure admin (admin scope, no
 * level of their own) keeps the dialog's admin-only mode. The dialog's own
 * calls are still gated on the server.
 */
function reportShareTarget(
  doc: AccessReportDocument["document"],
  wsId: string,
  organizationId: string,
  title: string,
): ShareDialogTarget {
  return {
    id: doc.id,
    workspace_id: wsId,
    organization_id: organizationId,
    visibility: doc.visibility === "restricted" ? "restricted" : "workspace",
    owner_kind: null,
    archived_at: null,
    shelved_at: null,
    my_level: shareLevel(doc),
    admin_scope: doc.admin_scope,
    title,
  };
}

/**
 * An open report row: every grant on the document (who, level, the effective
 * level only when it differs, source, granted by and on), Revoke where the
 * server named a target, and the way on to the share dialog and the document.
 * Revoke asks first and waits for the server — the row leaves when the report
 * refetches, never before.
 */
export function AccessReportGrants({ wsId, entry, title, documentHref }: AccessReportGrantsProps) {
  const { t, i18n } = useTranslation();
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const organizationId = useOptionalWorkspace()?.workspace.organization_id ?? "";
  const revoke = useRevokeReportGrant(wsId);
  const [confirming, setConfirming] = useState<AccessReportRow | null>(null);
  const [sharing, setSharing] = useState(false);
  const { document: doc, rows } = entry;

  const confirmRevoke = async () => {
    const row = confirming;
    if (!row?.revoke_target || revoke.isPending) return;
    const name = grantName(t, row);
    try {
      await revoke.mutateAsync({ documentId: doc.id, target: row.revoke_target });
      toast.success(revokeText(t, row.principal_type, "done", name));
    } catch {
      toast.error(t("documents.accessReport.revoke_failed"));
    }
    setConfirming(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* The row above may have cut the name short: here it is whole. */}
      <p title={title} className="break-words font-medium text-foreground">
        {title}
      </p>
      {/* Wide table, own box: on a phone it scrolls here, starting at the first column. */}
      <div className="overflow-x-auto">
      <table aria-label={title} className="w-full border-collapse text-body max-sm:block sm:min-w-[36rem]">
        <thead className="max-sm:sr-only">
          <tr className="border-b border-border">
            <th scope="col" className={TH}>{t("documents.accessReport.col_principal")}</th>
            <th scope="col" className={TH}>{t("documents.accessReport.col_level")}</th>
            <th scope="col" className={TH}>{t("documents.accessReport.col_source")}</th>
            <th scope="col" className={TH}>{t("documents.accessReport.col_granted_by")}</th>
            <th scope="col" className={TH}>{t("documents.accessReport.col_granted_at")}</th>
            <th scope="col" className={TH}>
              <span className="sr-only">{t("documents.accessReport.col_actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((row, index) => {
            const name = grantName(t, row);
            const note = grantKindNote(t, row, wsId, viewerId);
            return (
              <tr
                key={`${row.source}:${row.principal_type}:${row.principal_id}:${row.share_id ?? index}`}
                className={cn(
                  "border-b border-border last:border-b-0 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-2",
                  !row.active && "text-muted-foreground",
                )}
              >
                <td className={cn(TD, TD_STACKED, "max-sm:w-full")}>
                  <span className="flex min-w-0 items-center gap-2">
                    <GrantGlyph type={row.principal_type} name={name} />
                    <span title={name} className="min-w-0 truncate font-medium">
                      {name}
                    </span>
                    {note ? <span className="shrink-0 text-caption text-muted-foreground">{note}</span> : null}
                  </span>
                </td>
                <td className={cn(TD, TD_STACKED, "max-sm:order-1")}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant="secondary">{accessLevelLabel(t, row.level)}</Badge>
                    {row.effective_level !== row.level ? (
                      <span className="text-caption text-muted-foreground">
                        {t("documents.accessReport.effective_note", { level: accessLevelLabel(t, row.effective_level) })}
                      </span>
                    ) : null}
                    {row.active ? null : (
                      <span className="text-caption text-muted-foreground">{t("documents.accessReport.inactive")}</span>
                    )}
                  </span>
                </td>
                <td className={cn(TD, TD_STACKED, "text-muted-foreground max-sm:order-2 max-sm:text-caption")}>
                  <Caption>{t("documents.accessReport.col_source")}</Caption>
                  {accessSourceLabel(t, row)}
                </td>
                <td className={cn(TD, TD_STACKED, "text-muted-foreground max-sm:order-2 max-sm:text-caption")}>
                  <Caption>{t("documents.accessReport.col_granted_by")}</Caption>
                  {row.granted_by_name || NONE}
                </td>
                <td className={cn(TD, TD_STACKED, "whitespace-nowrap text-muted-foreground max-sm:order-2 max-sm:text-caption")}>
                  <Caption>{t("documents.accessReport.col_granted_at")}</Caption>
                  {row.granted_at ? formatWhen(row.granted_at, i18n.language) || NONE : NONE}
                </td>
                <td className={cn(TD, TD_STACKED, "text-right max-sm:order-1 max-sm:ml-auto")}>
                  {row.revoke_target ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      aria-label={revokeText(t, row.principal_type, "label", name)}
                      onClick={() => setConfirming(row)}
                    >
                      {t("documents.accessReport.revoke")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setSharing(true)}>
          <UserPlus aria-hidden className="size-3.5" />
          {t("documents.accessReport.manage_sharing")}
        </Button>
        {documentHref ? (
          <AppLink href={documentHref(doc.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ExternalLink aria-hidden className="size-3.5" />
            {t("documents.accessReport.open_document")}
          </AppLink>
        ) : null}
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => (open ? null : setConfirming(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? revokeText(t, confirming.principal_type, "title", grantName(t, confirming)) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? `${title} · ${accessSourceLabel(t, confirming)} · ${accessLevelLabel(t, confirming.level)}` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              aria-disabled={revoke.isPending || undefined}
              onClick={() => void confirmRevoke()}
            >
              {revoke.isPending ? <Spinner /> : null}
              {t("documents.accessReport.revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {sharing ? (
        <ShareDialog
          open
          onOpenChange={(open) => setSharing(open)}
          wsId={wsId}
          doc={reportShareTarget(doc, wsId, organizationId, title)}
        />
      ) : null}
    </div>
  );
}

function GrantGlyph({ type, name }: { type: string; name: string }) {
  // The name sits beside the glyph, so the avatar is not read a second time.
  if (type === "user") {
    return (
      <span aria-hidden className="flex shrink-0">
        <ActorAvatar name={name} initials={initialOf(name)} size="sm" />
      </span>
    );
  }
  const Icon = type === "organization" ? Building2 : type === "link" ? Link2 : Users;
  return (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </span>
  );
}
