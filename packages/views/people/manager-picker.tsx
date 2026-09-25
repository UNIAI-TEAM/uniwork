"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePeople } from "@uniwork/core/people";
import type { Actor, Person } from "@uniwork/core/types/people";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@uniwork/ui/components/ui/combobox";
import { PersonAvatar } from "./person-avatar";

const SEARCH_DEBOUNCE_MS = 250;

interface ManagerOption {
  id: string;
  name: string;
  avatarUrl?: string;
  title?: string;
}

/**
 * Chooses a person's direct manager from the live directory. The search goes
 * to the server, which folds diacritics ("nguyen" finds "Nguyễn"), so the
 * combobox does no filtering of its own — it would drop exactly the matches
 * the server folded in. The person being edited is never offered as their own
 * manager (the server refuses that too). The list pages like the directory:
 * scrolling to its end loads the next page, so a large company is reachable
 * without knowing to search.
 */
export function ManagerPicker({
  id,
  orgSlug,
  personId,
  value,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  orgSlug: string;
  personId: string;
  /** The current manager, as the profile names them; null for none. */
  value: Actor | null;
  onChange: (manager: Actor | null) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(value?.display_name ?? "");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  // While the field still shows the chosen name, list everyone rather than
  // only that one name.
  const search = value && query === value.display_name ? "" : query;
  const { data, isFetching, hasNextPage, isFetchingNextPage, fetchNextPage } = usePeople(orgSlug, {
    q: search,
    status: "active",
  });
  const loadMoreAtEnd = (event: React.UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    if (!hasNextPage || isFetchingNextPage) return;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 48) void fetchNextPage();
  };
  const options = useMemo<ManagerOption[]>(
    () =>
      (data?.pages ?? [])
        .flatMap((page) => page.people)
        .filter((p: Person) => p.user_id !== personId)
        .map((p) => ({ id: p.user_id, name: p.display_name, avatarUrl: p.avatar_url, title: p.title })),
    [data, personId],
  );
  const selected = value ? { id: value.id, name: value.display_name, avatarUrl: value.avatar_url } : null;

  return (
    <Combobox
      items={options}
      filter={null}
      itemToStringLabel={(o: ManagerOption) => o.name}
      itemToStringValue={(o: ManagerOption) => o.id}
      isItemEqualToValue={(a: ManagerOption, b: ManagerOption) => a.id === b.id}
      value={selected}
      inputValue={input}
      onInputValueChange={(text) => setInput(text)}
      onValueChange={(o: ManagerOption | null) => {
        onChange(o ? { id: o.id, kind: "human", display_name: o.name, avatar_url: o.avatarUrl } : null);
        setInput(o?.name ?? "");
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        placeholder={t("people.manager_placeholder")}
        aria-describedby={describedBy}
        disabled={disabled}
        showClear={!!value && !disabled}
      />
      <ComboboxContent>
        <ComboboxEmpty>{isFetching ? t("common.loading") : t("people.manager_empty")}</ComboboxEmpty>
        <ComboboxList onScroll={loadMoreAtEnd}>
          {(o: ManagerOption) => (
            <ComboboxItem key={o.id} value={o}>
              <PersonAvatar id={o.id} name={o.name} avatarUrl={o.avatarUrl} size="xs" />
              <span className="min-w-0 truncate">{o.name}</span>
              {o.title ? <span className="ml-auto truncate pl-2 text-caption text-muted-foreground">{o.title}</span> : null}
            </ComboboxItem>
          )}
        </ComboboxList>
        {isFetchingNextPage ? (
          <p role="status" className="px-3 py-2 text-caption text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : null}
      </ComboboxContent>
    </Combobox>
  );
}
