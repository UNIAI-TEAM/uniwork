"use client";

import { Archive, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useArchiveDepartment,
  useCreateDepartment,
  useDepartments,
  useUpdateDepartment,
} from "@uniwork/core/people";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import type { Department } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { useWorkspace } from "../../layout/workspace-context";
import { DepartmentPicker } from "../../people/department-picker";
import { toastApiError } from "../../toast-api-error";
import { SettingsSection, SettingsTab } from "./settings-layout";

/**
 * The organization's structure. The tree is at most two levels deep, so it is
 * drawn as a list with children indented under their parent rather than as a
 * tree control.
 */
export function DepartmentsTab() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const { data: departments, isLoading } = useDepartments(orgSlug);
  const { canManageDepartments } = usePeoplePermissions(orgSlug);
  const create = useCreateDepartment(orgSlug);
  const update = useUpdateDepartment(orgSlug);
  const archive = useArchiveDepartment(orgSlug);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [parentId, setParentId] = useState("");

  const ordered = orderTree(departments ?? []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || create.isPending) return;
    create.mutate(
      { name: name.trim(), code: code.trim(), parent_id: parentId },
      {
        onSuccess: () => {
          setName("");
          setCode("");
          setParentId("");
          toast.success(t("departments.created"));
        },
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const rename = (department: Department, next: string) => {
    if (next.trim() === department.name || !next.trim() || update.isPending) return;
    update.mutate(
      { id: department.id, input: { name: next.trim() } },
      {
        onSuccess: () => toast.success(t("departments.updated")),
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  return (
    <SettingsTab title={t("settings.page.tabs.departments")}>
      <SettingsSection title={t("departments.title")} description={t("departments.description")}>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-body text-muted-foreground">{t("departments.empty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {ordered.map((department) => (
              <li
                key={department.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <div className={department.parent_id ? "min-w-0 pl-6" : "min-w-0"}>
                  {canManageDepartments.allowed ? (
                    <Input
                      aria-label={t("departments.name")}
                      defaultValue={department.name}
                      onBlur={(e) => rename(department, e.target.value)}
                      className="h-8"
                    />
                  ) : (
                    <span className="text-body text-foreground">{department.name}</span>
                  )}
                  <span className="block text-caption text-muted-foreground">
                    {[department.code, t("departments.member_count", { count: department.member_count })]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {canManageDepartments.allowed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={archive.isPending}
                    onClick={() =>
                      archive.mutate(department.id, {
                        onSuccess: () => toast.success(t("departments.archived")),
                        onError: (err) => toastApiError(err, t("common.error")),
                      })
                    }
                  >
                    <Archive aria-hidden="true" className="size-3.5" />
                    {t("departments.archive")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {canManageDepartments.allowed ? (
        <SettingsSection title={t("departments.add_title")}>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor="department-name">{t("departments.name")}</FieldLabel>
              <Input
                id="department-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={create.isPending}
              />
            </Field>
            <Field className="w-32">
              <FieldLabel htmlFor="department-code">{t("departments.code")}</FieldLabel>
              <Input
                id="department-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={create.isPending}
              />
            </Field>
            <Field className="w-48">
              <FieldLabel htmlFor="department-parent">{t("departments.parent")}</FieldLabel>
              <DepartmentPicker
                id="department-parent"
                departments={(departments ?? []).filter((d) => !d.parent_id)}
                value={parentId}
                onValueChange={setParentId}
                disabled={create.isPending}
              />
            </Field>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              <Plus aria-hidden="true" className="size-3.5" />
              {t("departments.add")}
            </Button>
          </form>
        </SettingsSection>
      ) : null}
    </SettingsTab>
  );
}

/** Roots in server order, each followed by its children. */
function orderTree(departments: Department[]): Department[] {
  const roots = departments.filter((d) => !d.parent_id);
  return roots.flatMap((root) => [root, ...departments.filter((d) => d.parent_id === root.id)]);
}
