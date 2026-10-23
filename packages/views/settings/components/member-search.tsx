"use client";

import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";

/** Diacritics and case folded, so "nguyen van an" finds "Nguyễn Văn Ân". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

/** Client-side match over what is already loaded: name or email. */
export function matchesMember(query: string, member: { display_name: string; email: string }): boolean {
  const q = fold(query);
  if (!q) return true;
  return fold(member.display_name).includes(q) || fold(member.email).includes(q);
}

/**
 * Name and email folded once, for a list that is filtered on every keystroke:
 * build it with `useMemo` over the loaded members, then match with
 * `matchesFolded`, so only the query is folded per keystroke.
 */
export function foldMember(member: { display_name: string; email: string }): string {
  return `${fold(member.display_name)}\n${fold(member.email)}`;
}

/** `query` already folded by `fold`; an empty one matches everybody. */
export function matchesFolded(foldedQuery: string, folded: string): boolean {
  return !foldedQuery || folded.includes(foldedQuery);
}

export function MemberSearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative w-full sm:w-64">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={t("settings.members.search")}
        placeholder={t("settings.members.search_placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8"
      />
    </div>
  );
}
