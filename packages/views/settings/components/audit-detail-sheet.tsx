"use client";

import { useTranslation } from "react-i18next";
import type { AuditEvent } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";

/** A change entry as the server writes it: only the fields that moved. */
interface ChangeEntry {
  from?: unknown;
  to?: unknown;
}

function isChangeEntry(value: unknown): value is ChangeEntry {
  return typeof value === "object" && value !== null && ("from" in value || "to" in value);
}

/**
 * Renders a stored value for a reader. `null` is a real value in this log — it
 * is how "the field was cleared" is recorded — so it gets a word rather than
 * an empty cell that reads as a rendering bug.
 */
function Value({ value, empty }: { value: unknown; empty: string }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground italic">{empty}</span>;
  }
  if (typeof value === "object") {
    return <code className="text-caption break-all">{JSON.stringify(value)}</code>;
  }
  return <span className="break-all">{String(value)}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3">
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

export function AuditDetailSheet({
  event,
  onClose,
}: {
  event: AuditEvent | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const changes = Object.entries(event?.changes ?? {});

  return (
    <Sheet open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("detail.title")}</SheetTitle>
          <SheetDescription>{event?.action}</SheetDescription>
        </SheetHeader>
        {event ? (
          <dl className="divide-y divide-border px-4 pb-8">
            <Field label={t("table.time")}>
              {new Date(event.occurred_at).toLocaleString()}
            </Field>
            <Field label={t("table.actor")}>
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(`actor_kind.${event.actor_kind}`, t("actor_kind.unknown"))}</Badge>
                <code className="text-caption break-all">{event.actor_id}</code>
              </span>
            </Field>
            <Field label={t("table.resource")}>
              <code className="text-caption break-all">
                {event.resource_type}/{event.resource_id}
              </code>
            </Field>
            {event.workspace_id ? (
              <Field label={t("detail.workspace")}>
                <code className="text-caption break-all">{event.workspace_id}</code>
              </Field>
            ) : null}
            <Field label={t("table.changes")}>
              {changes.length === 0 ? (
                <span className="text-muted-foreground">{t("table.no_changes")}</span>
              ) : (
                <ul className="grid gap-2">
                  {changes.map(([field, raw]) => (
                    <li key={field} className="grid gap-0.5">
                      <span className="text-caption font-medium">{field}</span>
                      <span className="text-caption text-muted-foreground">
                        {t("detail.from")}:{" "}
                        <Value value={isChangeEntry(raw) ? raw.from : undefined} empty={t("detail.empty")} />
                      </span>
                      <span className="text-caption">
                        {t("detail.to")}:{" "}
                        <Value value={isChangeEntry(raw) ? raw.to : raw} empty={t("detail.empty")} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            {Object.keys(event.metadata ?? {}).length > 0 ? (
              <Field label={t("detail.metadata")}>
                <code className="text-caption break-all">{JSON.stringify(event.metadata)}</code>
              </Field>
            ) : null}
            <Field label={t("detail.correlation")}>
              <code className="text-caption break-all">{event.correlation_id}</code>
              <p className="mt-1 text-caption text-muted-foreground">{t("detail.correlation_hint")}</p>
            </Field>
            {/* The address is absent for an admin by design, and saying so is
                better than a blank row that looks like missing data. */}
            <Field label={t("detail.ip")}>
              {event.ip_address ? (
                <code className="text-caption">{event.ip_address}</code>
              ) : (
                <span className="text-muted-foreground">{t("detail.ip_owner_only")}</span>
              )}
            </Field>
            {event.user_agent ? (
              <Field label={t("detail.user_agent")}>
                <span className="text-caption break-all">{event.user_agent}</span>
              </Field>
            ) : null}
          </dl>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
