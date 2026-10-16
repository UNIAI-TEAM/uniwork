"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Person, Department } from "@uniwork/core/types/people";
import type { PeopleColumnKey, PeopleViewMode } from "@uniwork/core/people/view-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { CollectionPageHeader } from "@uniwork/views/layout/collection-page";
import { MODULE_ICONS } from "@uniwork/views/layout/module-icons";
import { PeopleToolbar, type PeopleFilterState } from "@uniwork/views/people/people-toolbar";
import { PeopleDepartmentBar } from "@uniwork/views/people/people-department-bar";
import { PeopleCards } from "@uniwork/views/people/people-cards";
import { PeopleTable } from "@uniwork/views/people/people-table";
import { PersonAvatar } from "@uniwork/views/people/person-avatar";
import { ProductDemoNavigation } from "./product-demo-navigation";

const DEPARTMENTS: Department[] = ["Product", "Engineering", "Design"].map((name, index) => ({ id: `department-${index}`, name, member_count: 2, sort_order: index }));
const PEOPLE: Person[] = ["Đạt Đặng", "Minh Linh", "Hoàng Anh", "Thanh Ngân", "Lê Tùng", "Nam Nguyễn"].map((display_name, index) => ({ user_id: `demo-person-${index}`, display_name, email: `member${index + 1}@uniwork.example`, org_role: index === 0 ? "owner" : "member", status: "active", title: ["Product manager", "Product designer", "Software engineer"][index % 3]!, department: DEPARTMENTS[index % 3], phone_visible: false, timezone: "Asia/Saigon", is_self: index === 0 }));

export function ProductPeoplePreview({ onChat }: { onChat: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PeopleFilterState>({ departmentId: "", role: "", status: "active" });
  const [mode, setMode] = useState<PeopleViewMode>("cards");
  const [hidden, setHidden] = useState<PeopleColumnKey[]>(["phone", "status"]);
  const [person, setPerson] = useState<Person | null>(null);
  const people = PEOPLE.filter(person => `${person.display_name} ${person.title} ${person.email}`.toLowerCase().includes(search.toLowerCase()) && (!filters.departmentId || person.department?.id === filters.departmentId) && (!filters.role || person.org_role === filters.role) && (filters.status === "all" || !filters.status || person.status === filters.status));
  const shared = { people, total: people.length, hrefFor: (id: string) => `/people/${id}`, hasNextPage: false, isFetchingNextPage: false, onLoadMore: () => {} };
  return <ProductDemoNavigation onOpen={path => setPerson(PEOPLE.find(person => path.endsWith(person.user_id)) ?? null)}><div className="product-current-people">
    <CollectionPageHeader headingAs="h2" icon={MODULE_ICONS.people} tone="pink" title={t("people.title")} count={PEOPLE.length} />
    <PeopleToolbar search={search} onSearchChange={setSearch} matching={search || filters.departmentId || filters.role ? people.length : null} filters={filters} onFiltersChange={setFilters} viewMode={mode} onViewModeChange={setMode} hiddenColumns={hidden} onToggleColumn={key => setHidden(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])} />
    <PeopleDepartmentBar departments={DEPARTMENTS} value={filters.departmentId} onChange={departmentId => setFilters(current => ({ ...current, departmentId }))} />
    <div className="product-current-people-body">{mode === "cards" ? <PeopleCards {...shared} onChat={onChat} /> : <PeopleTable {...shared} hiddenColumns={hidden} />}</div>
    <Dialog open={!!person} onOpenChange={open => { if (!open) setPerson(null); }}><DialogContent><DialogHeader>{person && <PersonAvatar id={person.user_id} name={person.display_name} />}<DialogTitle>{person?.display_name}</DialogTitle><DialogDescription>{person?.title}</DialogDescription></DialogHeader><p>{person?.department?.name}</p><p>{person?.email}</p><Button onClick={() => { setPerson(null); onChat(); }}>{t("nav.chat")}</Button></DialogContent></Dialog>
  </div></ProductDemoNavigation>;
}
