"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, FunnelX, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentAccessReportPrincipals } from "@uniwork/core/documents/hooks-access-report";
import type { AccessReportFilters, AccessReportPrincipal } from "@uniwork/core/types/document-access-report";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { accessLevelLabel, accessSourceLabel, flagLabel, principalTypeLabel, REPORT_LEVELS } from "./access-report-labels";
import { principalParam } from "./access-report-person-docs";
import { PRINCIPAL_KINDS, REPORT_SCOPES, REPORT_SOURCES, type ReportView } from "./access-report-query";

type TFunction = ReturnType<typeof useTranslation>["t"];

const ALL = "all";
/** A search is sent once typing pauses, so each key press is not a request. */
const SEARCH_DELAY_MS = 300;
const ITEM = "px-2 py-2 pointer-coarse:min-h-11";
const PRINCIPALS_DEFAULT_SORT = { sort: "count", order: "desc" } as const;

/** `?source=` values as the grant rows name them, for the labels the table uses. */
const SOURCE_ROW: Record<(typeof REPORT_SOURCES)[number], { source: string; origin?: string }> = {
  owner: { source: "acl_owner" },
  workspace: { source: "workspace" },
  direct: { source: "share" },
  chat: { source: "share", origin: "chat" },
  link: { source: "link" },
  break_glass: { source: "break_glass" },
};

function scopeLabel(t: TFunction, scope: string): string {
  switch (scope) {
    case "restricted":
      return t("documents.accessReport.scope_private");
    case "workspace":
      return t("documents.accessReport.who_workspace");
    case "organization":
      return t("documents.accessReport.who_organization");
    default:
      return t("documents.accessReport.visibility_other");
  }
}

function kindLabel(t: TFunction, kind: string): string {
  return kind === "home_workspace" ? t("documents.accessReport.who_workspace") : t(`documents.accessReport.kind_${kind}`);
}

/** `?flag=` is the tile's filter; the chip reads like the warning badge it matches. */
function flagChipLabel(t: TFunction, flag: string): string {
  switch (flag) {
    case "public_link":
    case "direct_manage":
      return flagLabel(t, flag);
    default:
      return flagLabel(t, "other_workspace");
  }
}

function principalLabel(t: TFunction, p: Pick<AccessReportPrincipal, "principal_type" | "principal_name">): string {
  const name = p.principal_name?.trim();
  if (name) return name;
  return p.principal_type === "link" ? t("documents.accessReport.anyone_with_link") : principalTypeLabel(t, p.principal_type);
}

export interface AccessReportFiltersBarProps {
  wsId: string;
  folderId: string | undefined;
  view: ReportView;
  filters: AccessReportFilters;
  /** By person only: the kind of principal. */
  kind: string | undefined;
  onFiltersChange: (next: AccessReportFilters) => void;
  onKindChange: (kind: string | undefined) => void;
  onReset: () => void;
}

/**
 * The report filters on one row that wraps (UNI-2039 F2). By document: search,
 * person or group, level, general access, access source, the active tile's chip
 * and "only access that differs from the default". By person: search, type and
 * level. Each change goes to the URL; the server filters, since the list pages.
 */
export function AccessReportFiltersBar({
  wsId,
  folderId,
  view,
  filters,
  kind,
  onFiltersChange,
  onKindChange,
  onReset,
}: AccessReportFiltersBarProps) {
  const { t } = useTranslation();
  const nonDefaultId = useId();
  const levels = filters.levels ?? [];
  const sources = filters.sources ?? [];
  const set = (patch: Partial<AccessReportFilters>) => onFiltersChange({ ...filters, ...patch });
  const documents = view === "documents";
  const active = documents
    ? Boolean(filters.q || filters.principal || levels.length || filters.scope || sources.length || filters.flag || filters.nonDefault)
    : Boolean(filters.q || kind || levels.length);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchField
        label={t(documents ? "documents.accessReport.search_documents" : "documents.accessReport.search_people")}
        value={filters.q ?? ""}
        onCommit={(q) => set({ q: q || undefined })}
      />

      {documents ? (
        <PrincipalFilter wsId={wsId} folderId={folderId} value={filters.principal} onPick={(principal) => set({ principal })} />
      ) : (
        <RadioFilter
          label={t("documents.accessReport.filter_kind")}
          value={kind}
          options={PRINCIPAL_KINDS.map((value) => ({ value, label: kindLabel(t, value) }))}
          onChange={onKindChange}
        />
      )}

      <CheckFilter
        label={t("documents.accessReport.filter_level")}
        values={levels}
        options={REPORT_LEVELS.map((value) => ({ value, label: accessLevelLabel(t, value) }))}
        onChange={(next) => set({ levels: next.length ? next : undefined })}
      />

      {documents ? (
        <>
          <RadioFilter
            label={t("documents.accessReport.filter_scope")}
            value={filters.scope}
            options={REPORT_SCOPES.map((value) => ({ value, label: scopeLabel(t, value) }))}
            onChange={(scope) => set({ scope })}
          />
          <CheckFilter
            label={t("documents.accessReport.filter_source")}
            values={sources}
            options={REPORT_SOURCES.map((value) => ({ value, label: accessSourceLabel(t, SOURCE_ROW[value]) }))}
            onChange={(next) => set({ sources: next.length ? next : undefined })}
          />
          {filters.flag ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1"
              aria-label={t("documents.accessReport.clear_chip", { name: flagChipLabel(t, filters.flag) })}
              onClick={() => set({ flag: undefined })}
            >
              {flagChipLabel(t, filters.flag)}
              <X aria-hidden className="size-3.5" />
            </Button>
          ) : null}
        </>
      ) : null}

      {active ? (
        <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-1">
          <FunnelX aria-hidden className="size-3.5" />
          {t("documents.accessReport.filter_reset")}
        </Button>
      ) : null}

      {documents ? (
        <label htmlFor={nonDefaultId} className="flex items-center gap-2 text-caption text-foreground sm:ml-auto pointer-coarse:min-h-11">
          <Checkbox
            id={nonDefaultId}
            checked={Boolean(filters.nonDefault)}
            onCheckedChange={(on) => set({ nonDefault: on ? true : undefined })}
          />
          {t("documents.accessReport.only_non_default")}
        </label>
      ) : null}
    </div>
  );
}

function SearchField({ label, value, onCommit }: { label: string; value: string; onCommit: (q: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  // The last query this box committed: the URL echoes it a beat later, and that
  // echo must not overwrite characters typed in between.
  const committed = useRef(value);
  // A change from outside (Clear filters, the back button) replaces what is typed.
  if (value !== seen) {
    setSeen(value);
    if (value !== committed.current && text.trim() !== value) setText(value);
    committed.current = value;
  }
  // The latest callback, so a parent re-render does not restart the pause.
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    const q = text.trim();
    if (q === value) return;
    const timer = setTimeout(() => {
      committed.current = q;
      commit.current(q);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, value]);

  return (
    <div className="relative min-w-0 flex-[1_1_15rem] sm:max-w-80">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        maxLength={100}
        aria-label={label}
        placeholder={label}
        onChange={(event) => setText(event.target.value)}
        className="h-8 pl-8"
      />
    </div>
  );
}

interface Option {
  value: string;
  label: string;
}

const trigger = <Button type="button" variant="toolbar" size="sm" className="gap-1" />;

function CheckFilter({ label, values, options, onChange }: { label: string; values: string[]; options: Option[]; onChange: (next: string[]) => void }) {
  const picked = options.filter((o) => values.includes(o.value));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger}>
        {picked.length > 0 ? `${label}: ${picked.map((o) => o.label).join(", ")}` : label}
        <ChevronDown aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={values.includes(option.value)}
            onCheckedChange={(on) => {
              const next = on ? [...values, option.value] : values.filter((v) => v !== option.value);
              onChange(options.map((o) => o.value).filter((v) => next.includes(v)));
            }}
            className={ITEM}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RadioFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: Option[];
  onChange: (next: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const items = [{ value: ALL, label: t("documents.accessReport.filter_all") }, ...options];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger}>
        {`${label}: ${items.find((item) => item.value === (value || ALL))?.label ?? ""}`}
        <ChevronDown aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuRadioGroup value={value || ALL} onValueChange={(next) => onChange(next === ALL ? undefined : String(next))}>
          {items.map((item) => (
            <DropdownMenuRadioItem key={item.value} value={item.value} className={ITEM}>
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * People, groups and "anyone with the link" who hold access in this scope —
 * the By person list, so a group or a link can be picked too. Names only.
 */
function PrincipalFilter({
  wsId,
  folderId,
  value,
  onPick,
}: {
  wsId: string;
  folderId: string | undefined;
  value: string | undefined;
  onPick: (principal: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const list = useDocumentAccessReportPrincipals(wsId, { folderId, ...PRINCIPALS_DEFAULT_SORT }, { enabled: open || Boolean(value) });
  const principals = list.data?.principals ?? [];
  const label = t("documents.accessReport.filter_principal");
  const current = value ? principals.find((p) => principalParam(p) === value) : undefined;
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? principals.filter((p) => principalLabel(t, p).toLocaleLowerCase().includes(needle)) : principals;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>
        {current ? `${label}: ${principalLabel(t, current)}` : label}
        <ChevronDown aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-2">
        <Input
          type="search"
          value={query}
          aria-label={t("documents.accessReport.search_people")}
          placeholder={t("documents.accessReport.search_people")}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8"
        />
        <div role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
          {list.isPending ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : (
            [{ key: ALL, text: t("documents.accessReport.filter_all"), pick: undefined as string | undefined }, ...shown.map((p) => ({ key: principalParam(p), text: principalLabel(t, p), pick: principalParam(p) }))].map(
              (item) => (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={(value ?? undefined) === item.pick}
                  onClick={() => {
                    onPick(item.pick);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center rounded-md px-2 py-2 text-left text-body hover:bg-muted aria-selected:font-medium pointer-coarse:min-h-11"
                >
                  <span className="min-w-0 truncate">{item.text}</span>
                </button>
              ),
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
