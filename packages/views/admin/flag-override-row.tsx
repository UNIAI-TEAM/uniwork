"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDeleteFlagOverride, useSetFlagOverride } from "@uniwork/core/admin";
import { apiErrorMessage } from "@uniwork/core/api";
import type { AdminFlag, AdminFlagOverride } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { TableCell, TableRow } from "@uniwork/ui/components/ui/table";
import { ReasonDialog } from "./reason-dialog";

interface FlagOverrideRowProps {
  flag: AdminFlag;
  /** global on /admin/flags, organization on the org detail's Flags tab. */
  scopeType: "global" | "organization";
  scopeId?: string;
  /** Every override in the console, fetched once by the screen above. */
  overrides: AdminFlagOverride[];
  /** Catalogue columns shown only on the full catalogue. */
  full?: boolean;
}

/**
 * One flag with the override for one scope. The switch never flips on its
 * own: it opens the reason dialog and the server's answer is what the row
 * shows next (spec §9: not optimistic). The overrides arrive from the screen,
 * so a catalogue of N flags costs one request, not N.
 */
export function FlagOverrideRow({ flag, scopeType, scopeId = "", overrides, full }: FlagOverrideRowProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.flags" });
  const set = useSetFlagOverride(flag.key);
  const remove = useDeleteFlagOverride(flag.key);
  const [pending, setPending] = useState<"on" | "off" | "remove" | null>(null);
  const override = overrides.find(
    (o) => o.flag_key === flag.key && o.scope_type === scopeType && o.scope_id === scopeId,
  );
  const effective = override ? override.enabled : flag.default;
  const busy = set.isPending || remove.isPending;
  const fail = (err: unknown) => toast.error(apiErrorMessage(err) ?? t("error_write"));

  const submit = async (reason: string) => {
    try {
      if (pending === "remove") {
        await remove.mutateAsync({ scope_type: scopeType, scope_id: scopeId, reason });
        toast.success(t("removed", { key: flag.key }));
      } else if (pending) {
        await set.mutateAsync({ scope_type: scopeType, scope_id: scopeId, enabled: pending === "on", reason });
        toast.success(t("set", { key: flag.key }));
      }
      setPending(null);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-caption">{flag.key}</TableCell>
      <TableCell className="max-w-xs truncate text-muted-foreground" title={flag.description}>
        {flag.description}
      </TableCell>
      {full ? (
        <>
          <TableCell>{flag.default ? t("on") : t("off")}</TableCell>
          <TableCell>{flag.public ? t("yes") : t("no")}</TableCell>
          <TableCell className="font-mono text-caption">{flag.review_at}</TableCell>
          <TableCell className="text-right tabular-nums">{flag.override_count}</TableCell>
        </>
      ) : null}
      <TableCell>
        <span className="flex items-center gap-2">
          <Switch
            checked={effective}
            disabled={busy}
            aria-label={t("toggle_label", { key: flag.key })}
            onCheckedChange={(next) => setPending(next ? "on" : "off")}
          />
          {override ? (
            <>
              <Badge variant="outline">{t("overridden")}</Badge>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setPending("remove")}>
                {t("remove")}
              </Button>
            </>
          ) : null}
        </span>
      </TableCell>
      <ReasonDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending === "remove" ? t("remove_title", { key: flag.key }) : t("override_title", { key: flag.key })}
        description={t(`scope.${scopeType}`)}
        pending={busy}
        onSubmit={(reason) => void submit(reason)}
      />
    </TableRow>
  );
}
