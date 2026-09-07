"use client";

import { Download, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { exportPeopleUrl } from "@uniwork/core/api/endpoints/people";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { useDepartments, usePeople } from "@uniwork/core/people";
import type { PeopleFilters } from "@uniwork/core/types/people";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { DepartmentPicker } from "./department-picker";
import { PeopleList } from "./people-list";

const SEARCH_DEBOUNCE_MS = 250;
const ANY = "__any__";

/**
 * The organization's directory. Search is debounced because every keystroke
 * would otherwise become a query key, and the server folds diacritics, so
 * "nguyen van an" finds "Nguyễn Văn Ân".
 */
export function PeopleView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const { push } = useNavigation();
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("active");
  const { canExport } = usePeoplePermissions(orgSlug);
  const { data: departments } = useDepartments(orgSlug);

  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const filters: PeopleFilters = useMemo(
    () => ({ q: query, department_id: departmentId, role, status }),
    [departmentId, query, role, status],
  );
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = usePeople(
    orgSlug,
    filters,
  );
  const people = useMemo(() => (data?.pages ?? []).flatMap((p) => p.people), [data]);
  const totalActive = data?.pages[0]?.total_active ?? 0;
  const filtered = query !== "" || departmentId !== "" || role !== "" || status !== "active";

  const open = (userId: string) => push(paths.workspace(orgSlug, workspace.slug).person(userId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Users}
        title={t("people.title")}
        count={totalActive}
        actions={
          canExport.allowed ? (
            <CollectionPageHeaderAction
              icon={Download}
              label={t("people.export")}
              // The response is a file the browser saves, so this is a plain
              // navigation rather than a fetch: the session cookie travels with
              // it and the bytes never enter the client.
              render={<a href={exportPeopleUrl(orgSlug, runtimeConfig().apiUrl)} download>{t("people.export")}</a>}
            />
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative min-w-48 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("people.search")}
            className="pl-8"
            placeholder={t("people.search_placeholder")}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
          />
        </div>
        <DepartmentPicker
          departments={departments ?? []}
          value={departmentId}
          onValueChange={setDepartmentId}
          ariaLabel={t("people.filter_department")}
        />
        <Select
          aria-label={t("people.filter_role")}
          value={role === "" ? ANY : role}
          onValueChange={(v) => setRole(v === ANY ? "" : ((v as string) ?? ""))}
          items={[
            { value: ANY, label: t("people.role_any") },
            { value: "owner", label: t("people.role_owner") },
            { value: "admin", label: t("people.role_admin") },
            { value: "member", label: t("people.role_member") },
          ]}
        />
        <Select
          aria-label={t("people.filter_status")}
          value={status}
          onValueChange={(v) => setStatus((v as string) ?? "active")}
          items={[
            { value: "active", label: t("people.status_active") },
            { value: "deactivated", label: t("people.status_deactivated") },
            { value: "all", label: t("people.status_all") },
          ]}
        />
      </div>

      {isError ? (
        <CollectionPageState
          icon={Users}
          tone="destructive"
          role="alert"
          title={t("people.error_title")}
          description={t("people.error_description")}
        />
      ) : isLoading ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Spinner />
        </div>
      ) : people.length === 0 ? (
        <CollectionPageState
          icon={Users}
          title={filtered ? t("people.empty_filtered_title") : t("people.empty_title")}
          description={filtered ? t("people.empty_filtered_description") : t("people.empty_description")}
        />
      ) : (
        <PeopleList
          people={people}
          onOpen={open}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
        />
      )}
    </div>
  );
}
