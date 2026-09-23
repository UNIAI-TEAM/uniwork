"use client";

import { Building2, Plus } from "lucide-react";
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
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { useWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import { DepartmentRow } from "./department-row";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsEmpty,
  SettingsList,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsTab,
} from "./settings-layout";

/** The Select treats "" as no selection; "top level" is a real choice, so it has its own value. */
const TOP_LEVEL = "__top__";

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
  const canManage = canManageDepartments.allowed;
  const create = useCreateDepartment(orgSlug);
  const update = useUpdateDepartment(orgSlug);
  const archive = useArchiveDepartment(orgSlug);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [parentId, setParentId] = useState(TOP_LEVEL);
  const [archiving, setArchiving] = useState<Department | null>(null);

  const all = departments ?? [];
  const roots = all.filter((d) => !d.parent_id);
  const ordered = orderTree(all);
  const childCount = (id: string) => all.filter((d) => d.parent_id === id).length;
  const ready = name.trim().length > 0 && !create.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    create.mutate(
      { name: name.trim(), code: code.trim(), parent_id: parentId === TOP_LEVEL ? "" : parentId },
      {
        onSuccess: () => {
          setName("");
          setCode("");
          setParentId(TOP_LEVEL);
          toast.success(t("departments.created"));
        },
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const rename = async (department: Department, next: string) => {
    try {
      await update.mutateAsync({ id: department.id, input: { name: next } });
      toast.success(t("departments.updated"));
      return true;
    } catch (err) {
      toastApiError(err, t("common.error"));
      return false;
    }
  };

  const confirmArchive = () => {
    if (!archiving || archive.isPending) return;
    archive.mutate(archiving.id, {
      onSuccess: () => {
        toast.success(t("departments.archived"));
        setArchiving(null);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsTab title={t("settings.page.tabs.departments")} description={t("departments.description")}>
      <SettingsSection title={isLoading || ordered.length === 0 ? null : t("departments.count", { count: ordered.length })}>
        {isLoading ? (
          <SettingsSkeletonRows rows={3} />
        ) : ordered.length === 0 ? (
          <SettingsCard>
            <SettingsEmpty icon={<Building2 />}>
              {canManage ? t("departments.empty_admin") : t("departments.empty_member")}
            </SettingsEmpty>
          </SettingsCard>
        ) : (
          <SettingsList aria-label={t("settings.page.tabs.departments")}>
            {ordered.map((department) => (
              <DepartmentRow
                key={department.id}
                department={department}
                childCount={childCount(department.id)}
                canManage={canManage}
                onRename={rename}
                onArchive={(d) => {
                  if (childCount(d.id) === 0) setArchiving(d);
                }}
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      {canManage ? (
        <SettingsSection title={t("departments.add_title")}>
          <SettingsCard>
            <SettingsCardBody>
              <form
                onSubmit={submit}
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start"
              >
                <Field>
                  <FieldLabel htmlFor="department-name">{t("departments.name")}</FieldLabel>
                  <Input
                    id="department-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    readOnly={create.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="department-code">{t("departments.code")}</FieldLabel>
                  <Input
                    id="department-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    readOnly={create.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="department-parent">{t("departments.parent")}</FieldLabel>
                  <Select
                    id="department-parent"
                    aria-label={t("departments.parent")}
                    value={parentId}
                    disabled={create.isPending || roots.length === 0}
                    onValueChange={(v) => setParentId((v as string) || TOP_LEVEL)}
                    items={[
                      { value: TOP_LEVEL, label: t("departments.parent_none") },
                      ...roots.map((d) => ({ value: d.id, label: d.name })),
                    ]}
                  />
                  <FieldDescription>
                    {roots.length === 0 ? t("departments.parent_hint_empty") : t("departments.parent_hint")}
                  </FieldDescription>
                </Field>
                {/* The label row's height, so the button lines up with the parent picker. */}
                <div className="sm:pt-6">
                  <Button
                    type="submit"
                    className="w-full"
                    aria-disabled={!ready || undefined}
                    aria-busy={create.isPending || undefined}
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    {t("departments.add")}
                  </Button>
                </div>
              </form>
            </SettingsCardBody>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setArchiving(null);
        }}
        title={t("departments.archive_title", { name: archiving?.name })}
        description={
          archiving && archiving.member_count > 0
            ? t("departments.archive_body", { count: archiving.member_count })
            : t("departments.archive_body_empty")
        }
        confirmLabel={t("departments.archive")}
        onConfirm={confirmArchive}
        pending={archive.isPending}
      />
    </SettingsTab>
  );
}

/** Roots in server order, each followed by its children. */
function orderTree(departments: Department[]): Department[] {
  const roots = departments.filter((d) => !d.parent_id);
  return roots.flatMap((root) => [root, ...departments.filter((d) => d.parent_id === root.id)]);
}
