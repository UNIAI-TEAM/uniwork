"use client";

import { Building2, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
  SettingsFieldError,
  SettingsList,
  SettingsLoadError,
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
  const { data: departments, isLoading, isError, refetch } = useDepartments(orgSlug);
  const { canManageDepartments } = usePeoplePermissions(orgSlug);
  const canManage = canManageDepartments.allowed;
  const create = useCreateDepartment(orgSlug);
  const update = useUpdateDepartment(orgSlug);
  const archive = useArchiveDepartment(orgSlug);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [parentId, setParentId] = useState(TOP_LEVEL);
  const [nameMissing, setNameMissing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // The target outlives the dialog's open state, so the title keeps the name
  // while the dialog animates out.
  const [archiving, setArchiving] = useState<Department | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const { ordered, roots, children, nested } = useMemo(() => orderTree(departments ?? []), [departments]);
  const childCount = (id: string) => children.get(id) ?? 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    if (!name.trim()) {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }
    create.mutate(
      { name: name.trim(), code: code.trim(), parent_id: parentId === TOP_LEVEL ? "" : parentId },
      {
        onSuccess: () => {
          setName("");
          setNameMissing(false);
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
        setArchiveOpen(false);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsTab title={t("settings.page.tabs.departments")} description={t("departments.description")}>
      <SettingsSection
        title={isLoading || isError || ordered.length === 0 ? null : t("departments.count", { count: ordered.length })}
      >
        {isLoading ? (
          <SettingsSkeletonRows rows={3} />
        ) : isError ? (
          <SettingsCard>
            <SettingsLoadError onRetry={() => void refetch()}>{t("departments.load_error")}</SettingsLoadError>
          </SettingsCard>
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
                nested={nested.has(department.id)}
                canManage={canManage}
                onRename={rename}
                onArchive={(d) => {
                  if (childCount(d.id) > 0) return;
                  setArchiving(d);
                  setArchiveOpen(true);
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
              {/* Name and code share a row; the parent picker takes the full
                  width with its hint, and the button closes the form on its
                  own row, so nothing needs an offset to line up. */}
              <form
                onSubmit={submit}
                noValidate
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start"
              >
                <Field>
                  <FieldLabel htmlFor="department-name">{t("departments.name")}</FieldLabel>
                  <Input
                    ref={nameRef}
                    id="department-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (e.target.value.trim()) setNameMissing(false);
                    }}
                    readOnly={create.isPending}
                    aria-invalid={nameMissing || undefined}
                    aria-describedby={nameMissing ? "department-name-error" : undefined}
                  />
                  {nameMissing ? (
                    <SettingsFieldError id="department-name-error">{t("departments.name_required")}</SettingsFieldError>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="department-code">{t("departments.code_optional")}</FieldLabel>
                  <Input
                    id="department-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    readOnly={create.isPending}
                  />
                </Field>
                <Field className="sm:col-span-2">
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
                <div className="flex sm:col-span-2 sm:justify-end">
                  <Button
                    type="submit"
                    className="w-full sm:w-auto"
                    aria-disabled={create.isPending || undefined}
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
        open={archiveOpen}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setArchiveOpen(false);
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

/**
 * Roots in server order, each followed by its children, in one pass. A
 * department whose parent is not in the list (archived, or not visible to
 * this reader) is appended at the top level rather than dropped, so every
 * department the server returned is drawn and counted.
 */
function orderTree(departments: Department[]): {
  ordered: Department[];
  roots: Department[];
  children: Map<string, number>;
  /** Drawn indented under the parent right above it. */
  nested: Set<string>;
} {
  const ids = new Set(departments.map((d) => d.id));
  const byParent = new Map<string, Department[]>();
  const roots: Department[] = [];
  const orphans: Department[] = [];
  for (const d of departments) {
    if (!d.parent_id) roots.push(d);
    else if (!ids.has(d.parent_id)) orphans.push(d);
    else {
      const siblings = byParent.get(d.parent_id);
      if (siblings) siblings.push(d);
      else byParent.set(d.parent_id, [d]);
    }
  }
  const ordered: Department[] = [];
  const nested = new Set<string>();
  for (const root of roots) {
    ordered.push(root);
    for (const child of byParent.get(root.id) ?? []) {
      ordered.push(child);
      nested.add(child.id);
    }
  }
  ordered.push(...orphans);
  // A child of a child (deeper than the two levels the server allows) would
  // otherwise vanish too; keep it rather than hide data.
  const placed = new Set(ordered.map((d) => d.id));
  for (const d of departments) if (!placed.has(d.id)) ordered.push(d);
  const children = new Map([...byParent].map(([id, list]) => [id, list.length]));
  return { ordered, roots, children, nested };
}
