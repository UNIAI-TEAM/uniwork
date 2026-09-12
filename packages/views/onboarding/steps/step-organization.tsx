"use client";
import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
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
 * How a failed create should be reported. Deliberately NOT the server's
 * sentence: `ApiError.message` is filled from the response body, which the Go
 * side writes in hardcoded Vietnamese ("định danh chỉ gồm a-z, 0-9 và dấu gạch
 * ngang (2-40 ký tự)" from `ValidateSlug`), so rendering it shows Vietnamese to
 * an English-locale user. `ApiError.code` is the stable, localizable handle.
 */
export type CreateFailure = "slug_taken" | "slug_invalid" | "unknown";

/**
 * `invalid_request` is what `handlers.mapServiceError` answers for every
 * `service.ValidationError`, and on the org/workspace create endpoints the only
 * validation a user can trip is `ValidateSlug` — the empty-name branch is
 * unreachable because `form.canSubmit` already requires a name. Everything else
 * (entitlement_required, quota_exceeded, subscription_inactive, internal, …) is
 * not fixable in the slug field, so it stays "unknown" and gets the generic
 * translated toast rather than a misleading inline field error.
 */
export function classifyCreateFailure(err: unknown): CreateFailure {
  if (isSlugConflict(err)) return "slug_taken";
  if (errorCode(err) === "invalid_request") return "slug_invalid";
  return "unknown";
}

/**
 * Put the caret where the fix is. The only two failures we render inline are
 * about the slug, and without this the user has to hunt back up the form for a
 * field they cannot see from the footer on a short viewport.
 */
export function focusSlugInput(idPrefix: string) {
  document.getElementById(`${idPrefix}-slug`)?.focus();
}

/**
 * First code point, not first code unit. Names are never slugified, so
 * "🚀 Đội Alpha" is storable, and `name.slice(0, 1)` cuts that emoji's UTF-16
 * surrogate pair in half — the avatar tile renders a replacement character.
 */
export function avatarInitial(name: string): string {
  return ([...name][0] ?? "").toUpperCase();
}

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
          if (organization) {
            onSelected(organization);
            return;
          }
          // A falsy result is a RESOLVED mutation, not a rejected one:
          // `organizations.create()` runs the response through
          // `parseWithFallback(..., null, ...)`, so a drifted payload succeeds
          // with nothing to hand on. Doing nothing here was a dead end at the
          // very first step — the organization DOES exist on the server, the
          // CTA silently snapped back from "Đang tạo…" to "Tạo Unicom", and the
          // second press answered "Định danh tổ chức này đã có người dùng"
          // about the user's own one-second-old organization. Report the
          // failure instead; `useCreateOrganization` invalidates
          // `organizationKeys.list()` on every success, so the refreshed list
          // is what lets the user recover — the organization reappears as a
          // pickable card.
          toast.error(t("onboarding.step_organization.create_failed_toast"));
        },
        onError: (err) => {
          const failure = classifyCreateFailure(err);
          if (failure === "unknown") {
            // No field to attach it to, so the toast is the right surface here.
            toast.error(t("onboarding.step_organization.create_failed_toast"));
            return;
          }
          // Inline only, never inline + toast: `FieldError` renders
          // `role="alert"` and the toast has its own live region, so the pair
          // announced the same fact twice to a screen-reader user and printed
          // it in two places for everyone else. The inline one wins — it is
          // tied to the input and persists while the user fixes it.
          form.setServerError(
            failure === "slug_taken"
              ? t("onboarding.step_organization.slug_taken_error")
              : // Reused across both steps the way `useSlugForm` already reuses
                // this group for its client-side slug errors.
                t("onboarding.step_organization.slug_invalid_error"),
          );
          focusSlugInput("org");
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
    // Reachable, despite appearances: the picker cards stay clickable while a
    // create is in flight, so picking an existing org mid-request lands here
    // with `isCreating` true. The Button below refuses to run `onContinue`
    // while `disabled`, which is what keeps this honest — `aria-disabled` on a
    // button that still fires its handler is exactly what
    // packages/views/test/inactive.ts forbids.
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
      // `hint_name_first` lies whenever the name field is visibly full: a name
      // with no [a-z0-9] (CJK, emoji) slugifies to "", so the user reads "Đặt
      // tên tổ chức để tạo" next to the name they just typed.
      hint = form.name.trim()
        ? t("onboarding.step_organization.hint_slug_needed")
        : t("onboarding.step_organization.hint_name_first");
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
      // Same preview the workspace step carries. Without it this step was the
      // one place the resulting URL existed only inside a truncated pill.
      preview={{
        title: t("onboarding.step_organization.url_preview_label"),
        body: (
          <>
            {t("onboarding.step_organization.url_preview_prefix")}
            <span className="font-mono text-foreground">
              {host}/{form.slug || "…"}
            </span>
            {t("onboarding.step_organization.url_preview_suffix")}
          </>
        ),
      }}
    />
  );

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading
          title={
            // `headline_resume` names one organization. Above a list of three
            // equal cards that arbitrarily privileges the first, so it is used
            // only when there is in fact exactly one to name.
            resume
              ? organizations.length === 1
                ? t("onboarding.step_organization.headline_resume", { name: organizations[0]!.name })
                : t("onboarding.step_organization.headline_resume_many")
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
                avatar={avatarInitial(o.name)}
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
        <Button
          size="lg"
          className="w-full"
          aria-disabled={disabled || undefined}
          aria-describedby={STEP_HINT_ID}
          // `aria-disabled` keeps the button focusable on purpose, so blocking
          // the action in JS is the other half of that contract.
          onClick={() => {
            if (disabled) return;
            onContinue();
          }}
        >
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
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-body font-semibold text-primary-foreground">
        {avatar}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-foreground">{title}</span>
        <span className="truncate font-mono text-caption text-muted-foreground">{subtitle}</span>
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
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- deliberate, see above */}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-expanded={selected}
        aria-controls={`${idPrefix}-create-panel`}
        onClick={onSelect}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Plus className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-foreground">{title}</span>
          <span className="truncate text-caption text-muted-foreground">{subtitle}</span>
        </span>
        <RadioMark selected={selected} />
      </button>
      {selected && (
        <div id={`${idPrefix}-create-panel`} className="border-t border-border px-5 py-5">
          {children}
        </div>
      )}
    </div>
  );
}
