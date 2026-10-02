import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import type { DesktopLibraryContextResponse } from "../../shared/ipc";

export type PickerGroup = keyof DesktopLibraryContextResponse;
const GROUPS: readonly PickerGroup[] = ["deployments", "accounts", "organizations", "workspaces"];

function PickerIcon({ group, className = "size-5" }: { group: PickerGroup; className?: string }) {
  const paths = {
    deployments: "M4 3h16v7H4zM4 14h16v7H4zM7 6h.01M7 17h.01",
    accounts: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
    organizations: "M5 21V3h14v18M3 21h18M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-6h4v6",
    workspaces: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  };
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[group]} /></svg>;
}

export interface LibraryPickerSelection {
  deploymentId: string;
  accountId: string;
  organizationId: string;
  workspaceId: string;
}

export interface LibraryPickerProps {
  context: DesktopLibraryContextResponse | null;
  error?: boolean;
  onRetry?: () => void;
  onChoose: (selection: LibraryPickerSelection) => void;
}

const GROUP_TO_KEY: Record<PickerGroup, keyof LibraryPickerSelection> = {
  deployments: "deploymentId",
  accounts: "accountId",
  organizations: "organizationId",
  workspaces: "workspaceId",
};

/** The scope the brief requires before any library query runs: deployment,
 * account, organization, then workspace. Nothing here guesses a default --
 * metadata from a previous account never flashes through this screen. */
export function LibraryPicker({ context, error = false, onRetry, onChoose }: LibraryPickerProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [selected, setSelected] = useState<Partial<LibraryPickerSelection>>({});
  useEffect(() => {
    if (!context) return;
    const defaults: Partial<LibraryPickerSelection> = {};
    GROUPS.forEach((group) => {
      const entries = context[group] ?? [];
      if (entries.length === 1) defaults[GROUP_TO_KEY[group]] = entries[0]!.id;
    });
    setSelected(defaults);
  }, [context]);
  const optionsFor = (group: PickerGroup) => (context?.[group] ?? []).filter((entry) => group !== "workspaces" || !entry.organizationId || entry.organizationId === selected.organizationId);
  // A group with a single option is already chosen above; asking again only adds noise.
  const fixed = GROUPS.filter((group) => optionsFor(group).length === 1 && selected[GROUP_TO_KEY[group]] === optionsFor(group)[0]!.id);
  const ready = GROUPS.every((group) => Boolean(selected[GROUP_TO_KEY[group]]));
  const missing = GROUPS.filter((group) => !selected[GROUP_TO_KEY[group]]);
  const choose = (group: PickerGroup, value: string) => {
    if (group === "organizations") {
      const workspaces = context?.workspaces.filter((workspace) => !workspace.organizationId || workspace.organizationId === value) ?? [];
      setSelected((previous) => ({ ...previous, organizationId: value, workspaceId: workspaces.length === 1 ? workspaces[0]!.id : undefined }));
    } else setSelected((previous) => ({ ...previous, [GROUP_TO_KEY[group]]: value }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto p-6" data-desktop-library-picker="true">
      <div className="my-auto flex w-full max-w-xl shrink-0 flex-col gap-6 rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><PickerIcon group="workspaces" /></span><h1 className="text-title font-semibold text-foreground">{t("pickerTitle")}</h1></div>
      {error ? (
        <div className="flex flex-col gap-3" role="alert">
          <p className="text-body text-muted-foreground">{t("contextError")}</p>
          <Button type="button" variant="outline" onClick={onRetry}>{t("retry")}</Button>
        </div>
      ) : !context ? (
        <Skeleton className="h-40 w-full max-w-md" />
      ) : (
        <>
          {fixed.length > 0 ? (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground" data-picker-fixed="true">
              {fixed.map((group) => <div key={group} className="flex items-center gap-2"><PickerIcon group={group} className="size-4 shrink-0" /><dt>{t("pickerSummaryLabel", { group: t(group) })}</dt><dd className="break-words text-foreground">{optionsFor(group)[0]!.name}</dd></div>)}
            </dl>
          ) : null}
          {GROUPS.filter((group) => !fixed.includes(group)).map((group) => {
            const key = GROUP_TO_KEY[group];
            return (
              <section key={group} className="flex flex-col gap-2">
                <h2 className="text-label font-medium text-muted-foreground">{t(group)}</h2>
                <RadioGroup value={selected[key] ?? ""} onValueChange={(value) => choose(group, value)} aria-label={t(group)} className="grid gap-2">
                  {optionsFor(group).map((entry) => <label key={entry.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground transition-colors hover:bg-muted has-[[data-checked]]:border-primary has-[[data-checked]]:bg-accent"><PickerIcon group={group} className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-words">{entry.name}{entry.email ? <span className="block text-caption text-muted-foreground">{entry.email}</span> : null}</span><RadioGroupItem value={entry.id} data-picker-kind={group} data-picker-id={entry.id} /></label>)}
                </RadioGroup>
              </section>
            );
          })}
          <Button
            type="button"
            disabled={!ready}
            onClick={() => ready && onChoose(selected as LibraryPickerSelection)}
          >
            {t("pickerChoose")}
          </Button>
          {!ready ? <p role="status" className="text-caption text-muted-foreground">{t("pickerRequired", { groups: missing.map((group) => t(group)).join(", ") })}</p> : null}
        </>
      )}
      </div>
    </div>
  );
}
