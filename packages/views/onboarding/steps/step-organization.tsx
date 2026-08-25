"use client";
import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import { useCreateOrganization } from "@uniwork/core/organizations";
import type { Organization } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { isSlugConflict } from "../../workspace/slug";
import { pickerCardClass, RadioCardGroup, RadioMark } from "../components/option-card";
import { StepFooter, StepHeading, STEP_HINT_ID } from "../components/step-shell";
import { SlugFields, useSlugForm } from "../slug-field";

/**
 * Bước 2 — Tổ chức. Chưa thuộc org nào: form tên + slug. Đã thuộc org (resume
 * / new_workspace): card chọn org có sẵn + card "Tạo tổ chức mới" mở rộng.
 * Một CTA ở footer cho cả hai đường.
 */
export function StepOrganization({
  organizations,
  selected,
  onSelected,
  onBusyChange,
}: {
  organizations: Organization[];
  selected: Organization | null;
  onSelected: (org: Organization) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const host = appHost();
  const form = useSlugForm();
  const create = useCreateOrganization();
  const resume = organizations.length > 0;
  // resume: null = chưa chọn gì → CTA disabled. Click lại card đang chọn = bỏ chọn.
  const [pickedId, setPickedId] = useState<string | "create" | null>(selected?.id ?? null);
  const picked = organizations.find((o) => o.id === pickedId) ?? null;

  const isCreating = create.isPending;
  useEffect(() => {
    onBusyChange?.(isCreating);
    return () => onBusyChange?.(false);
  }, [isCreating, onBusyChange]);

  const handleCreate = () => {
    if (!form.canSubmit || isCreating) return;
    create.mutate(
      { name: form.name.trim(), slug: form.slug.trim() },
      {
        onSuccess: (organization) => {
          if (organization) onSelected(organization);
        },
        onError: (err) => {
          if (isSlugConflict(err)) {
            form.setServerError(t("onboarding.step_organization.slug_taken_error"));
            toast.error(t("onboarding.step_organization.slug_conflict_toast"));
            return;
          }
          toast.error(err instanceof Error && err.message ? err.message : t("onboarding.step_workspace.create_failed_toast"));
        },
      },
    );
  };

  const creatingActive = !resume || pickedId === "create";
  let hint: string;
  let label: string;
  let disabled: boolean;
  let onContinue: () => void;
  if (picked) {
    hint = t("onboarding.step_organization.hint_opening", { name: picked.name });
    label = t("onboarding.step_organization.cta_open", { name: picked.name });
    disabled = isCreating;
    onContinue = () => onSelected(picked);
  } else if (creatingActive) {
    if (isCreating) {
      hint = t("onboarding.step_organization.hint_creating_pending", { name: form.name.trim() });
      label = t("onboarding.step_organization.cta_creating");
      disabled = true;
      onContinue = () => {};
    } else if (form.canSubmit) {
      hint = t("onboarding.step_organization.hint_creating", { name: form.name.trim() });
      label = t("onboarding.step_organization.cta_create_named", { name: form.name.trim() });
      disabled = false;
      onContinue = handleCreate;
    } else {
      hint = t("onboarding.step_organization.hint_name_first");
      label = t("onboarding.step_organization.cta_create");
      disabled = true;
      onContinue = () => {};
    }
  } else {
    hint = t("onboarding.step_organization.hint_pick");
    label = t("common.continue");
    disabled = true;
    onContinue = () => {};
  }

  const fields = (
    <SlugFields
      idPrefix="org"
      form={form}
      hostPrefix={`${host}/`}
      withRandom={false}
      disabled={isCreating}
      nameLabel={t("onboarding.step_organization.name_label")}
      namePlaceholder={t("onboarding.step_organization.name_placeholder")}
      urlLabel={t("onboarding.step_organization.url_label")}
      slugPlaceholder={t("onboarding.step_organization.slug_placeholder")}
      onEnter={handleCreate}
      autoFocus={!resume || pickedId === "create"}
    />
  );

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading
          title={
            resume
              ? t("onboarding.step_organization.headline_resume", { name: organizations[0]!.name })
              : t("onboarding.step_organization.headline_first")
          }
          description={resume ? t("onboarding.step_organization.lede_resume") : t("onboarding.step_organization.lede_first")}
        />
        {resume ? (
          <RadioCardGroup label={t("onboarding.step_organization.picker_label")} className="flex flex-col gap-3">
            {organizations.map((o) => (
              <PickerCard
                key={o.id}
                selected={pickedId === o.id}
                onSelect={() => setPickedId((p) => (p === o.id ? null : o.id))}
                title={o.name}
                subtitle={`${host}/${o.slug}`}
                avatar={o.name.slice(0, 1).toUpperCase()}
              />
            ))}
            <CollapsibleCreateCard
              idPrefix="org"
              selected={pickedId === "create"}
              onSelect={() => setPickedId((p) => (p === "create" ? null : "create"))}
              title={t("onboarding.step_organization.create_new_title")}
              subtitle={t("onboarding.step_organization.create_new_subtitle")}
            >
              {fields}
            </CollapsibleCreateCard>
          </RadioCardGroup>
        ) : (
          fields
        )}
      </div>
      <StepFooter hint={hint}>
        <Button size="lg" className="w-full" aria-disabled={disabled || undefined} aria-describedby={STEP_HINT_ID} onClick={onContinue}>
          {label}
        </Button>
      </StepFooter>
    </>
  );
}

export function PickerCard({
  selected,
  onSelect,
  title,
  subtitle,
  avatar,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  avatar: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className={pickerCardClass(selected) + " flex items-center gap-4 px-5 py-4"}>
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-body font-semibold text-inverse">
        {avatar}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-primary">{title}</span>
        <span className="truncate font-mono text-caption text-text-secondary">{subtitle}</span>
      </span>
      <RadioMark selected={selected} />
    </button>
  );
}

export function CollapsibleCreateCard({
  idPrefix,
  selected,
  onSelect,
  title,
  subtitle,
  children,
}: {
  idPrefix: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className={pickerCardClass(selected) + " overflow-hidden"}>
      {/* `aria-expanded` + `aria-controls`: bấm vào đây không chỉ chọn, nó còn
          mở ra một form bên dưới. Không nói ra thì screen reader thông báo "đã
          chọn" và im lặng về phần vừa xuất hiện. */}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-expanded={selected}
        aria-controls={`${idPrefix}-create-panel`}
        onClick={onSelect}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-subtle text-text-secondary">
          <Plus className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-primary">{title}</span>
          <span className="truncate text-caption text-text-secondary">{subtitle}</span>
        </span>
        <RadioMark selected={selected} />
      </button>
      {selected && (
        <div id={`${idPrefix}-create-panel`} className="border-t border-line px-5 py-5">
          {children}
        </div>
      )}
    </div>
  );
}
