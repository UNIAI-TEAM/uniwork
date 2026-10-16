"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sharePrincipalsNotInOrganization } from "@uniwork/core/documents/errors";
import { useShareDocumentBatch } from "@uniwork/core/documents/hooks-sharing";
import type { DocumentAccessLevel, DocumentShare } from "@uniwork/core/types/document";
import type { OrgMember } from "@uniwork/core/types/people";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@uniwork/ui/components/ui/combobox";
import { InputGroupAddon, InputGroupButton } from "@uniwork/ui/components/ui/input-group";
import { shareErrorMessage } from "./share-dialog-break-glass";

/** The server refuses a batch above this many distinct people (UNI-1641). */
export const SHARE_PEOPLE_MAX = 50;

interface PersonOption {
  id: string;
  name: string;
  email: string;
}

/** Case- and diacritic-insensitive, so "binh" finds "Bình" and "dung" "Dũng". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/**
 * Batch submit for the people picker: one POST for every picked person at one
 * level, all or nothing. A 422 principal_not_in_organization names the
 * refused people (member name, else the id) and keeps the selection so they
 * can be removed; success clears it. Errors go to the dialog's own slot.
 */
export function useSharePeople(
  wsId: string,
  documentId: string,
  nameOf: (userId: string) => string,
  setError: (message: string | null) => void,
) {
  const { t } = useTranslation();
  const batch = useShareDocumentBatch(wsId, documentId);
  const [ids, setIds] = useState<string[]>([]);

  const change = (next: string[]) => {
    setIds(next.slice(0, SHARE_PEOPLE_MAX));
    setError(null);
  };

  const submit = async (level: DocumentAccessLevel) => {
    if (!ids.length || batch.isPending) return;
    setError(null);
    try {
      await batch.mutateAsync({ principal_ids: ids, level });
      setIds([]);
    } catch (err) {
      const refused = sharePrincipalsNotInOrganization(err);
      setError(
        refused?.length
          ? t("documents.share.people_not_in_org", {
              count: refused.length,
              names: refused.map(nameOf).join(", "),
            })
          : shareErrorMessage(err, t) ?? t("documents.share.submit_failed"),
      );
    }
  };

  return { ids, change, submit, isPending: batch.isPending };
}

/**
 * Searchable multi-select of the organization's members for a batch share.
 * Picked people sit below the field as removable chips; the list keeps
 * people who already hold a grant selectable (the server replaces their
 * level) and marks them. At the cap every unpicked row is disabled and the
 * field says why.
 */
export function SharePeoplePicker({
  id,
  members,
  shares,
  alreadySharedUserIds,
  people,
}: {
  id: string;
  members: readonly OrgMember[];
  /** The document's grants; live person grants are marked in the list. */
  shares: readonly Pick<DocumentShare, "principal_type" | "principal_id" | "active">[];
  /** Additional user ids that already hold access (e.g., ACL owner and caller). */
  alreadySharedUserIds?: readonly (string | null | undefined)[];
  people: ReturnType<typeof useSharePeople>;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  /** Name of the person just removed, spoken through the status region until the next pick. */
  const [removed, setRemoved] = useState<string | null>(null);
  const { ids: value, change: onChange, isPending: disabled } = people;
  const sharedIds = useMemo(() => {
    const ids = new Set(shares.filter((r) => r.principal_type === "user" && r.active).map((r) => r.principal_id));
    for (const uid of alreadySharedUserIds ?? []) {
      if (uid) ids.add(uid);
    }
    return ids;
  }, [shares, alreadySharedUserIds]);

  const options = useMemo<PersonOption[]>(
    () => members.map((m) => ({ id: m.user_id, name: m.display_name || m.email, email: m.email })),
    [members],
  );
  const selected = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    return value.map((pid) => byId.get(pid) ?? { id: pid, name: pid, email: "" });
  }, [options, value]);
  const atCap = value.length >= SHARE_PEOPLE_MAX;
  const hintId = `${id}-hint`;
  const removeOne = (o: PersonOption) => {
    setRemoved(o.name);
    onChange(value.filter((pid) => pid !== o.id));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Combobox
        multiple
        items={options}
        value={selected}
        inputValue={input}
        onInputValueChange={(text) => setInput(text)}
        itemToStringLabel={(o: PersonOption) => o.name}
        itemToStringValue={(o: PersonOption) => o.id}
        isItemEqualToValue={(a: PersonOption, b: PersonOption) => a.id === b.id}
        filter={(o: PersonOption, query: string) =>
          fold(`${o.name} ${o.email}`).includes(fold(query.trim()))
        }
        onValueChange={(next: PersonOption[]) => {
          setRemoved(null);
          onChange(next.map((o) => o.id));
          setInput("");
        }}
        disabled={disabled}
      >
        <ComboboxInput
          id={id}
          className="w-full"
          placeholder={t("documents.share.people_placeholder")}
          aria-describedby={hintId}
          disabled={disabled}
          showTrigger={false}
          onKeyDown={(event) => {
            if (event.key !== "Backspace" || input !== "" || !selected.length) return;
            removeOne(selected[selected.length - 1]!);
          }}
        >
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              render={<ComboboxTrigger />}
              aria-label={t("documents.share.people_toggle")}
              className="data-pressed:bg-transparent"
              disabled={disabled}
            />
          </InputGroupAddon>
        </ComboboxInput>
        {/* At least as wide as the field, and wide enough to read a name; never wider than the viewport. */}
        <ComboboxContent className="w-auto min-w-[max(var(--anchor-width),min(22rem,var(--available-width)))]">
          <ComboboxEmpty>{t("documents.share.people_empty")}</ComboboxEmpty>
          <ComboboxList>
            {(o: PersonOption) => (
              <ComboboxItem
                key={o.id}
                value={o}
                disabled={atCap && !value.includes(o.id)}
              >
                {/* The name wraps and is never cut before the email; only the email truncates. */}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words">{o.name}</span>
                  <span className="truncate text-caption text-muted-foreground">{o.email}</span>
                </span>
                {sharedIds.has(o.id) ? (
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {t("documents.share.people_already_shared")}
                  </span>
                ) : null}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p id={hintId} className="text-caption text-muted-foreground">
        {atCap
          ? t("documents.share.people_limit", { max: SHARE_PEOPLE_MAX })
          : t("documents.share.people_selected", { count: value.length })}
      </p>
      {/* Only reaching the cap and a removal are spoken; the count above is read on demand through aria-describedby. */}
      <p role="status" className="sr-only">
        {atCap
          ? t("documents.share.people_limit", { max: SHARE_PEOPLE_MAX })
          : removed
            ? t("documents.share.people_removed", { name: removed })
            : null}
      </p>
      {selected.length ? (
        // Bounded so 50 chips never push Level and Share off screen; the remove buttons are
        // focusable, so the box scrolls to whichever one has focus.
        <ul
          aria-label={t("documents.share.people_chosen")}
          className="flex max-h-28 flex-wrap gap-1 overflow-y-auto overscroll-contain"
        >
          {selected.map((o) => (
            <li key={o.id}>
              <Badge variant="secondary" className="h-6 gap-0.5 pr-0.5">
                <span className="max-w-40 truncate">{o.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("documents.share.people_remove", { name: o.name })}
                  disabled={disabled}
                  onClick={() => removeOne(o)}
                >
                  <X aria-hidden className="size-3" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
