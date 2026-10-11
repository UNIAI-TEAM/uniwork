"use client";

import { useState } from "react";
import { RotateCcwClock, ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentAccessLogs } from "@uniwork/core/documents/hooks-sharing";
import type { Document, DocumentAccessLogList } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { formatWhen } from "./document-format";

export interface AccessLogSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: Document;
}

const ACTIONS = ["", "view", "download", "export", "link_view"] as const;
/** The hook's page rows are the schema's raw rows; the list type is the source. */
type AccessLogRow = DocumentAccessLogList["logs"][number];

/**
 * `documents.detail` access log (C-01 §5.4; G1-08, UNI-682). Manage-only by
 * the server's own rule; the sheet degrades to an explanation when the level
 * drops while it is open. Rows carry the resolved actor when the server has
 * one, and the anonymous/system kinds when it does not — an unnamed human id
 * is never shown as a person.
 */
export function AccessLogSheet({ open, onOpenChange, wsId, doc }: AccessLogSheetProps) {
  const { t, i18n } = useTranslation();
  const canManage = doc.my_level === "manage";
  const [action, setAction] = useState<string>("");
  const logs = useDocumentAccessLogs(wsId, doc.id, {
    enabled: open && canManage,
    action: action ? (action as "view" | "download" | "export" | "link_view") : undefined,
  });
  const rows = logs.data?.pages.flatMap((page) => page.logs) ?? [];

  const actorLabel = (row: AccessLogRow): string => {
    if (row.actor?.display_name) return row.actor.display_name;
    switch (row.actor_kind) {
      case "anonymous":
        return t("documents.accessLog.actor_anonymous");
      case "system":
        return t("documents.accessLog.actor_system");
      case "human":
      case "agent":
        return t("documents.accessLog.actor_unknown");
      default:
        return t("documents.accessLog.actor_unknown");
    }
  };

  const actionLabel = (value: string): string => {
    switch (value) {
      case "view":
      case "download":
      case "export":
      case "link_view":
        return t(`documents.accessLog.action_${value}`);
      default:
        return t("documents.accessLog.action_unknown");
    }
  };

  const viaLabel = (via: string): string => {
    switch (via) {
      case "member":
      case "share":
      case "link":
      case "ai_context":
        return t(`documents.share.via_${via}`);
      default:
        return via;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md" closeLabel={t("common.close")}>
        <SheetHeader>
          <SheetTitle>{t("documents.accessLog.title")}</SheetTitle>
          <SheetDescription>{t("documents.accessLog.description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {!canManage ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground">
              {t("documents.accessLog.manage_only")}
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <ListFilter aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <Select
                  items={ACTIONS.map((value) => ({
                    value: value || "all",
                    label: value ? actionLabel(value) : t("documents.accessLog.filter_all"),
                  }))}
                  value={action || "all"}
                  onValueChange={(next) => setAction(next === "all" ? "" : String(next))}
                >
                  <SelectTrigger aria-label={t("documents.accessLog.filter_label")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((value) => (
                      <SelectItem key={value || "all"} value={value || "all"}>
                        {value ? actionLabel(value) : t("documents.accessLog.filter_all")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {logs.isPending ? (
                <div className="space-y-2" aria-busy="true">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-2/3" />
                </div>
              ) : logs.isError ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <p role="alert" className="text-caption text-destructive">
                    {t("documents.accessLog.error")}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void logs.refetch()}>
                    {t("documents.accessLog.retry")}
                  </Button>
                </div>
              ) : rows.length === 0 ? (
                <p className="px-1 text-caption text-muted-foreground">{t("documents.accessLog.empty")}</p>
              ) : (
                <>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {rows.map((row) => (
                      <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-body text-foreground">{actorLabel(row)}</p>
                          <p className="text-caption text-muted-foreground">
                            {actionLabel(row.action)}
                            {row.via ? ` · ${viaLabel(row.via)}` : ""}
                            {row.version ? ` · ${t("documents.accessLog.version", { no: row.version })}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {formatWhen(row.occurred_at, i18n.language)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {logs.hasNextPage ? (
                    <div className="mt-3 flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={logs.isFetchingNextPage}
                        aria-busy={logs.isFetchingNextPage || undefined}
                        onClick={() => void logs.fetchNextPage()}
                      >
                        {logs.isFetchingNextPage ? (
                          <Spinner aria-hidden role="presentation" />
                        ) : (
                          <RotateCcwClock aria-hidden className="size-3.5" />
                        )}
                        {t("documents.accessLog.load_more")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
