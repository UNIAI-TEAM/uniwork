"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Link2, Search, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { useAdminTrace } from "@uniwork/core/admin";
import { paths } from "@uniwork/core/paths";
import type { AdminTrace } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { shortId } from "../audit/event-presenter";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { PAGE_TOOLBAR } from "../layout/page-header";
import { useNavigation } from "../navigation";
import { formatDateTime } from "./status-badge";

type Source = "audit" | "outbox" | "action";

interface Row {
  id: string;
  source: Source;
  at: string;
  title: string;
  detail: string;
  /** An outbox row that gave up: the one line on a timeline worth finding fast. */
  failed?: boolean;
}

/** One timeline out of the three tables, oldest first. */
function toRows(trace: AdminTrace): Row[] {
  const rows: Row[] = [
    ...trace.audit.map((a) => ({
      id: `audit-${a.id}`,
      source: "audit" as const,
      at: a.occurred_at,
      title: a.action,
      detail: [a.resource_type, a.resource_id ? shortId(a.resource_id) : "", a.actor_kind, a.actor_id ? shortId(a.actor_id) : ""]
        .filter(Boolean)
        .join(" · "),
    })),
    ...trace.outbox.map((o) => ({
      id: `outbox-${o.id}`,
      source: "outbox" as const,
      at: o.created_at,
      title: o.topic,
      detail: [o.status, o.attempts ? `×${o.attempts}` : "", o.last_error].filter(Boolean).join(" · "),
      failed: !!o.dead_at || !!o.last_error,
    })),
    ...trace.actions.map((a) => ({
      id: `action-${a.id}`,
      source: "action" as const,
      at: a.created_at,
      title: a.action,
      detail: [a.target_type, a.target_id ? shortId(a.target_id) : "", a.reason].filter(Boolean).join(" · "),
    })),
  ];
  return rows.sort((x, y) => x.at.localeCompare(y.at));
}

const sourceTone: Record<Source, "secondary" | "outline" | "default"> = {
  audit: "secondary",
  outbox: "outline",
  action: "default",
};

const SOURCES: Source[] = ["audit", "outbox", "action"];

/**
 * /admin/trace — paste a trace id, read what the server kept under it.
 * Deliberately one component and no filter builder (spec §5.4).
 */
export function AdminTraceView() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.trace" });
  const { searchParams, replace, getShareableUrl } = useNavigation();
  const fromUrl = searchParams.get("id") ?? "";
  const [input, setInput] = useState(fromUrl);
  const [traceId, setTraceId] = useState(fromUrl);
  const [hidden, setHidden] = useState<Source[]>([]);
  const trace = useAdminTrace(traceId);

  const lookup = () => {
    const next = input.trim();
    setTraceId(next);
    replace(paths.admin.trace(next || undefined));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareableUrl(paths.admin.trace(traceId)));
      toast.success(t("copied"));
    } catch {
      toast.error(t("copy_failed"));
    }
  };

  const all = trace.data ? toRows(trace.data) : [];
  const rows = all.filter((row) => !hidden.includes(row.source));
  const toggleSource = (source: Source) =>
    setHidden(hidden.includes(source) ? hidden.filter((s) => s !== source) : [...hidden, source]);

  return (
    <>
      <CollectionPageHeader
        icon={Waypoints}
        title={t("title")}
        count={rows.length}
        actions={
          traceId ? (
            <Button size="sm" variant="outline" onClick={() => void copyLink()}>
              <Link2 aria-hidden="true" className="size-3.5" />
              {t("copy_link")}
            </Button>
          ) : undefined
        }
      />
      <form
        className={PAGE_TOOLBAR}
        onSubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("input_label")}
          className="h-8 max-w-md font-mono"
          spellCheck={false}
        />
        <Button type="submit" size="sm" variant="outline">
          <Search aria-hidden="true" className="size-3.5" />
          {t("lookup")}
        </Button>
        {all.length > 0 ? (
          <span className="ml-auto flex items-center gap-1">
            {SOURCES.map((source) => {
              const on = !hidden.includes(source);
              const n = all.filter((row) => row.source === source).length;
              return (
                <Button
                  key={source}
                  type="button"
                  size="sm"
                  variant={on ? "secondary" : "ghost"}
                  aria-pressed={on}
                  className={on ? undefined : "text-muted-foreground"}
                  onClick={() => toggleSource(source)}
                >
                  {t(`source.${source}`)}
                  <span className="ml-1 font-mono text-caption tabular-nums">{n}</span>
                </Button>
              );
            })}
          </span>
        ) : null}
      </form>
      {!traceId ? (
        <CollectionPageState icon={Waypoints} title={t("empty_title")} description={t("empty_description")} role="status" />
      ) : trace.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : trace.isError ? (
        <CollectionPageState
          icon={AlertCircle}
          tone="destructive"
          role="alert"
          title={t("error_title")}
          description={t("error_description")}
          actions={
            <Button variant="outline" onClick={() => void trace.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <CollectionPageState
          icon={Waypoints}
          title={all.length > 0 ? t("all_hidden_title") : t("not_found_title")}
          description={all.length > 0 ? t("all_hidden_description") : t("not_found_description")}
          role="status"
        />
      ) : (
        <ol className="flex flex-col divide-y divide-border px-4">
          {rows.map((row) => (
            <li key={row.id} className={cn("flex items-start gap-3 py-2.5", row.failed && "text-destructive")}>
              <time dateTime={row.at} className="w-44 shrink-0 font-mono text-caption text-muted-foreground">
                {formatDateTime(row.at, i18n.language)}
              </time>
              <Badge variant={sourceTone[row.source]} className="shrink-0">
                {t(`source.${row.source}`)}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-body">{row.title}</span>
                {row.detail ? (
                  <span className={cn("ml-2 text-caption", row.failed ? "text-destructive" : "text-muted-foreground")}>
                    {row.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
