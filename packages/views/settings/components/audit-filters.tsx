"use client";

import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronDown, ListFilter, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@uniwork/ui/components/ui/combobox";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { useAuditLabels } from "../../audit/event-presenter";
import { DateField } from "../../common/date-field";
import { SettingsBadge } from "./settings-layout";

/**
 * The actions the UI knows to offer in the filter. The server may write more
 * (a newer release); those still render in the table under their raw name.
 */
const KNOWN_ACTIONS = [
  "auth.login_succeeded", "auth.login_failed", "auth.password_changed",
  "auth.password_reset_requested", "auth.session_revoked",
  "organization.created", "organization.updated", "member.invited", "member.joined",
  "member.removed", "member.role_changed", "workspace.created", "workspace.updated",
  "workspace_member.added", "workspace_member.removed", "workspace_member.role_changed",
  "workspace_agent.added", "agent.created", "agent.updated", "task.created", "task.updated",
  "task.deleted", "task.comment_added", "subscription.changed", "audit.retention_set",
  "audit.export_requested", "webhook.deliver",
];
const KNOWN_RESOURCES = [
  "task", "task_comment", "workspace", "workspace_member", "workspace_agent_member", "organization",
  "organization_member", "invitation", "agent", "user", "session", "subscription", "audit", "webhook",
];

/** Empty strings are dropped by the endpoint, so the filter state can stay flat. */
export const EMPTY_FILTERS = { action: "", actor_id: "", resource_type: "", from: "", to: "" };
export type AuditFilterValues = typeof EMPTY_FILTERS;

interface Member {
  user_id: string;
  display_name: string;
}

/**
 * One compact row above the log. Every control applies as it changes (the
 * free-text actor is debounced by the caller), so there is no submit button
 * to forget. On a phone the row folds behind one line: the reader came for
 * the entries, not the form.
 */
export function AuditFilters({
  filters,
  onChange,
  members,
  fetching,
}: {
  filters: AuditFilterValues;
  onChange: (next: AuditFilterValues) => void;
  members: Member[];
  fetching: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const labels = useAuditLabels();
  const isMobile = useIsMobile();
  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const activeCount = Object.values(filters).filter(Boolean).length;
  const field = (key: keyof AuditFilterValues) => (value: string) => onChange({ ...filters, [key]: value });

  // The trigger's own text is its name: "Từ ngày" while empty, "Từ 12 thg 9" once picked.
  const dateTrigger = (key: "from_value" | "to_value", label: string, selected: boolean) => (
    <>
      <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{selected ? t(`filters.${key}`, { date: label }) : label}</span>
    </>
  );

  return (
    <details
      open={!isMobile}
      className="group rounded-lg border border-border bg-surface md:rounded-none md:border-0 md:bg-transparent"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-body font-medium md:hidden [&::-webkit-details-marker]:hidden">
        <ListFilter aria-hidden className="size-4 text-muted-foreground" />
        {t("filters.legend")}
        {activeCount > 0 ? (
          <SettingsBadge tone="brand">{t("filters.active_count", { count: activeCount })}</SettingsBadge>
        ) : null}
        <ChevronDown
          aria-hidden
          className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div
        role="search"
        aria-label={t("filters.legend")}
        className="flex flex-col gap-2 p-3 md:flex-row md:flex-wrap md:items-center md:p-0"
      >
        <div className="md:w-48">
          <Label htmlFor="audit-action" className="sr-only">{t("filters.action")}</Label>
          <Select
            id="audit-action"
            value={filters.action}
            onValueChange={(v) => field("action")(v ?? "")}
            items={[
              { value: "", label: t("filters.any_action") },
              ...KNOWN_ACTIONS.map((a) => ({ value: a, label: labels.action(a) })),
            ]}
          />
        </div>
        <div className="md:w-44">
          <Label htmlFor="audit-resource" className="sr-only">{t("filters.resource_type")}</Label>
          <Select
            id="audit-resource"
            value={filters.resource_type}
            onValueChange={(v) => field("resource_type")(v ?? "")}
            items={[
              { value: "", label: t("filters.any_resource") },
              ...KNOWN_RESOURCES.map((r) => ({ value: r, label: labels.resource(r) })),
            ]}
          />
        </div>
        <div className="md:w-48">
          <Label htmlFor="audit-actor" className="sr-only">{t("filters.actor")}</Label>
          {/* Free text stays allowed: a pasted id of someone outside this
              workspace is still a valid filter, so typing writes the raw
              text and picking a member writes their id. */}
          <Combobox
            items={members}
            itemToStringLabel={(m) => m.display_name}
            itemToStringValue={(m) => m.user_id}
            value={members.find((m) => m.user_id === filters.actor_id) ?? null}
            inputValue={names.get(filters.actor_id) ?? filters.actor_id}
            onValueChange={(m) => field("actor_id")(m?.user_id ?? "")}
            onInputValueChange={(text, details) => {
              if (details.reason === "input-change" || details.reason === "input-clear" || details.reason === "clear-press") {
                field("actor_id")(text);
              }
            }}
          >
            <ComboboxInput id="audit-actor" className="w-full" placeholder={t("filters.actor_placeholder")} showClear />
            <ComboboxContent>
              <ComboboxEmpty>{t("filters.actor_empty")}</ComboboxEmpty>
              <ComboboxList>
                {(m: Member) => (
                  <ComboboxItem key={m.user_id} value={m}>{m.display_name}</ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <div className="flex gap-2">
          <DateField
            className="md:w-40"
            value={filters.from}
            max={filters.to || undefined}
            placeholder={t("filters.from")}
            renderTrigger={(label, selected) => dateTrigger("from_value", label, selected)}
            onChange={field("from")}
          />
          <DateField
            className="md:w-40"
            value={filters.to}
            min={filters.from || undefined}
            placeholder={t("filters.to")}
            renderTrigger={(label, selected) => dateTrigger("to_value", label, selected)}
            onChange={field("to")}
          />
        </div>
        {activeCount > 0 ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-caption text-muted-foreground md:inline">
              {t("filters.active_count", { count: activeCount })}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
              <X data-icon="inline-start" aria-hidden />
              {t("filters.clear")}
            </Button>
          </div>
        ) : null}
        {/* Always mounted: a live region inserted together with its text is
            not reliably announced, so only its content comes and goes. */}
        <span
          role="status"
          className="inline-flex items-center gap-1.5 text-caption text-muted-foreground md:ml-auto"
        >
          {fetching ? (
            <>
              <Spinner className="size-3" aria-hidden />
              {t("loading")}
            </>
          ) : null}
        </span>
      </div>
    </details>
  );
}
