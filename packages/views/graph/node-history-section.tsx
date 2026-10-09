"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api/http";
import { useGraphHistory, useGraphUI } from "@uniwork/core/graph";
import { Button } from "@uniwork/ui/components/ui/button";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { useStatusCatalog } from "../tasks/pickers/status-catalog";
import { graphNodeHref, historySentence, historyWhen } from "./graph-labels";

/**
 * "Dòng thời gian": who owned the work, when the deadline moved, where it came
 * from — read from the Work Graph, newest first (C-11 §7). Distinct from the
 * task's "Hoạt động" (audit + comments).
 */
export function NodeHistorySection({ workspaceId, nodeType, nodeId }: { workspaceId: string; nodeType: string; nodeId: string }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const { workspace } = useWorkspace();
  const ui = useGraphUI(workspace.organization_id);
  const query = useGraphHistory(workspaceId, nodeType, nodeId, { enabled: ui === "on" });
  // The status pill's resolver: built-ins read through tasks.status_*, a
  // custom status by its name, archived ones too; same query key, no request.
  const { optionOf } = useStatusCatalog(workspaceId);
  if (ui !== "on") return null;
  const statusName = (key: string) => optionOf(key).label;
  const label = (key: string, vars?: Record<string, string>) => t(key, vars);
  const items = [...(query.data?.items ?? [])].reverse();
  const missing = query.error instanceof ApiError && query.error.status === 404;

  return (
    <section aria-labelledby={headingId} data-testid="graph-history" className="mt-8 space-y-2">
      <h2 id={headingId} className="text-body font-semibold text-foreground">{t("graph.history.title")}</h2>
      {query.isPending ? (
        <p role="status" className="text-caption text-muted-foreground">{t("graph.history.loading")}</p>
      ) : query.isError && !missing ? (
        <div className="space-y-2">
          <p className="text-caption text-muted-foreground">{t("graph.history.error")}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>{t("common.retry")}</Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("graph.history.empty")}</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item, index) => {
            const sentence = historySentence(item, label, statusName, i18n.language);
            // Spec §7: a row opens the entity it names.
            const href = item.node ? graphNodeHref(item.node, workspace.organization_slug, workspace.slug) : null;
            return (
              <li key={`${item.kind}:${item.edge_type || item.fact_type}:${item.valid_from}:${index}`} className="flex flex-wrap items-baseline gap-x-2 text-body">
                {href ? (
                  <AppLink href={href} className="text-foreground underline-offset-4 hover:underline">{sentence}</AppLink>
                ) : (
                  <span className="text-foreground">{sentence}</span>
                )}
                <span className="text-caption text-muted-foreground">{historyWhen(item, label, i18n.language)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
